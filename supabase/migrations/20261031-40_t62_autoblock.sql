-- 自動閉塞（前の列車のうしろ 30m まで近づける）・駅の通過線（ホームのない番線）・国じゅうの系統の一覧（列車・バスをさがす）。2026-10-31
--   続行・待避の1分（60秒）と、番線の前後30秒のかわりに、列車の長さ＋30m が はなれるまでの秒（加速・速さから）。手元の写しで、最短の間隔が 90秒 → 約56秒（6両・停車30秒）
--   いまある系統のダイヤは、重なり・注意が0のまま（ぜんぶの鉄道の系統を、新しい決まりで組みなおす）
-- 自動閉塞（t62・2026-10-31）：前の列車のうしろ 30m まで近づける。
--   止まっていた列車が動きだして（加速 acc km/h/s）、うしろのはし＋30m が その点をはなれるまでの秒
create or replace function public._mp_clr_stop(len double precision, acc double precision) returns int
language sql immutable as $$ select greatest(8, ceil(sqrt(2 * (coalesce(len, 100) + 30) / greatest(coalesce(acc, 2) / 3.6, 0.15))))::int $$;
--   走っている列車（速さ v m/s）が、ある点を（うしろのはし＋30m）はなれるまでの秒
create or replace function public._mp_clr_pass(len double precision, v double precision) returns int
language sql immutable as $$ select greatest(4, ceil((coalesce(len, 100) + 30) / greatest(coalesce(v, 10), 3)))::int $$;

-- 番線をえらぶ：止まる列車は、通過線（ホームがない）をえらばない
create or replace function public._mp_pick_trk(trk jsonb, dir int, side boolean) returns int
language sql immutable as $$
  select coalesce((select e.k::int from jsonb_array_elements(trk) with ordinality e(v, k)
                    where e.v ->> 'd' in (case when dir = -1 then 'up' else 'down' end, 'both') and coalesce(e.v ->> 'm', 'main') <> 'pass'   -- 通過線には止まらない（t62）
                    order by (e.v ->> 'm' = case when side then 'side' else 'main' end) desc, (e.v ->> 'd' = 'both'),
                             case when side then -e.k else e.k end limit 1), 1)
$$;

create or replace function public._mp_train_times(tr mp_trains, hold jsonb, waits bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare r mp_routes; perf jsonb; n int; ord int[]; i int; k int; t int; arr int; dep int; spec jsonb; sc jsonb := '[]'::jsonb; ws text[] := '{}';
        st mp_stations; lastStop int; run int; trk int; dw int; flen real; stop boolean;
        e jsonb; ci bigint; o mp_ops; cp jsonb; ka int; kb int; cx jsonb := '[]'::jsonb; cw text; nmax int; x jsonb; skipped bigint; k0 int; k1 int;
begin
  select * into r from mp_routes where id = tr.route;
  perf := case when tr.form is not null then _mp_form_perf(tr.form) end;
  n := array_length(r.stops, 1);
  ord := case when tr.dir = 1 then array(select generate_series(1, n)) else array(select generate_series(n, 1, -1)) end;
  dw := r.dwell;
  -- 走る区間（途中始発・途中止まり。2026-10-28）：走る順の k0 番目から k1 番目まで
  k0 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sb, true), n);   -- 環状線：始発は走る順で前の、終着はうしろのほう
  if k0 >= k1 then ws := ws || '始発駅と終着駅の順がちがいます（系統の端から端まで走ります）'::text; k0 := 1; k1 := n; end if;
  if perf is null then ws := ws || '編成が決まっていません（走りません）'::text; end if;
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
        where l.lo >= least(ord[k0], ord[k1]) and l.lo < greatest(ord[k0], ord[k1]) and not (l.v ->> 'e')::boolean) then   -- 走る区間だけ
    ws := ws || '電化していない区間があります（電車は走れません）'::text;
  end if;
  -- 飛行機：滑走路の短い空港には離着陸できない（t54p）
  if perf is not null and r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then
    ws := ws || format('滑走路の短い空港があります（%sm以上いります。飛びません）', perf ->> 'rwy');
  end if;
  -- 連結：つなぐ運用・つなぐ駅と切りはなす駅（走る順の何番目か）
  for e, ci in select z.v, z.o from jsonb_array_elements(coalesce(tr.cpl, '[]'::jsonb)) with ordinality z(v, o) loop
    cw := null; o := null; cp := null;
    select * into o from mp_ops where id = (e ->> 'op')::bigint;
    if o.id is null then cw := '連結する運用が見つかりません';
    elsif r.kind <> 'rail' or o.kind <> 'rail' then cw := 'バスは連結できません';
    elsif o.form is null then cw := format('運用 %s に編成が入っていません', o.num);
    elsif perf is null then cw := 'この列車の編成が決まっていません';
    else
      cp := _mp_form_perf(o.form);
      if cp is null then cw := format('運用 %s に編成が入っていません', o.num); end if;
    end if;
    ka := case when e ->> 'a' is null then k0 else _mp_kpos(r.stops, tr.dir, (e ->> 'a')::bigint, false) end;
    kb := case when e ->> 'b' is null then k1 else _mp_kpos(r.stops, tr.dir, (e ->> 'b')::bigint, true) end;
    if cw is null then
      if ka is null or kb is null then cw := '連結する駅がこの系統にありません';
      elsif ka < k0 or kb > k1 then cw := '連結する駅が、この列車の走る区間にありません';
      elsif ka >= kb then cw := '連結する駅は、切りはなす駅より前にしてください';
      else
        skipped := case when ka > k0 and r.stops[ord[ka]] = any(tr.skip) then r.stops[ord[ka]] when kb < k1 and r.stops[ord[kb]] = any(tr.skip) then r.stops[ord[kb]] end;
        if skipped is not null then cw := format('%s にこの列車は止まりません（連結・切りはなしができません）', (select name from mp_stations where id = skipped)); end if;
      end if;
    end if;
    cx := cx || jsonb_build_array(jsonb_build_object('op', (e ->> 'op')::bigint, 'num', o.num, 'f', o.form,
             'a', case when ka is not null then r.stops[ord[ka]] end, 'b', case when kb is not null then r.stops[ord[kb]] end, 'ka', ka, 'kb', kb,
             'n', (cp ->> 'n')::int, 'len', (cp ->> 'len')::real, 'v', cw is null, 'ok', cw is null, 'w', cw, 'cp', cp));
  end loop;
  -- 両数：駅ごとに足して 16両まで（こえるときは連結しない）
  if exists (select 1 from jsonb_array_elements(cx) c where (c ->> 'v')::boolean) then
    nmax := (select max(coalesce((perf ->> 'n')::int, 0) + coalesce((select sum((c ->> 'n')::int) from jsonb_array_elements(cx) c
                                                   where (c ->> 'v')::boolean and (c ->> 'ka')::int <= kk and kk <= (c ->> 'kb')::int), 0))
             from generate_series(1, n) kk);
    if nmax > 16 then
      cx := (select jsonb_agg(case when (c.v ->> 'v')::boolean then c.v || jsonb_build_object('v', false, 'ok', false, 'w', format('連結すると %s両になります（16両まで）', nmax)) else c.v end order by c.o)
               from jsonb_array_elements(cx) with ordinality c(v, o));
    end if;
  end if;
  -- 性能：いちばん弱い編成にあわせる
  for x in select c from jsonb_array_elements(cx) c where (c ->> 'v')::boolean loop
    perf := perf || jsonb_build_object('acc', least((perf ->> 'acc')::real, coalesce((x -> 'cp' ->> 'acc')::real, (perf ->> 'acc')::real)),
                                       'dec', least(coalesce((perf ->> 'dec')::real, 3.5), coalesce((x -> 'cp' ->> 'dec')::real, 3.5)),
                                       'vmax', least((perf ->> 'vmax')::real, coalesce((x -> 'cp' ->> 'vmax')::real, (perf ->> 'vmax')::real)));
  end loop;
  flen := coalesce((perf ->> 'len')::real, 0);
  t := tr.dep; lastStop := ord[k0];
  for k in k0..k1 loop
    i := ord[k];
    select * into st from mp_stations where id = r.stops[i];
    spec := tr.tt -> (r.stops[i]::text);
    stop := k = k0 or k = k1 or not (r.stops[i] = any(tr.skip));
    trk := coalesce((spec ->> 't')::int, _mp_pick_trk(_mp_sta_trk(st), tr.dir, st.id = any(coalesce(waits, '{}'))));
    if trk > st.tracks then ws := ws || format('%s に %s番線はありません', st.name, trk); trk := st.tracks; end if;
    if stop and r.kind = 'rail' and (_mp_sta_trk(st) -> (trk - 1) ->> 'm') = 'pass' then
      ws := ws || format('%s の %s番線は通過線です（ホームがないので止まれません）', st.name, trk);   -- t62
    end if;
    if k = k0 then
      arr := null; dep := tr.dep + coalesce((hold ->> st.id::text)::int, 0); t := dep;
    else
      if not stop then continue; end if;
      -- 前に止まった駅からここまで（通過駅をまとめて）
      run := _mp_leg_time(r, least(lastStop, i), greatest(lastStop, i), perf);
      arr := t + run;
      if spec ? 'a' then
        if (spec ->> 'a')::int < arr then ws := ws || format('%s 着 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'a')::int), _mp_hms(arr));
        else arr := (spec ->> 'a')::int; end if;
      end if;
      if k = k1 then dep := null;
      else
        dep := arr + dw;
        if spec ? 'd' then
          if (spec ->> 'd')::int < arr + 10 then ws := ws || format('%s 発 %s は早すぎます（いちばん早くて %s）', st.name, _mp_hms((spec ->> 'd')::int), _mp_hms(arr + 10));
          else dep := (spec ->> 'd')::int; end if;
        end if;
        dep := dep + coalesce((hold ->> st.id::text)::int, 0);   -- 待避・続行
      end if;
    end if;
    -- ホームの長さ（連結している編成もふくめて）
    if stop and r.kind = 'rail' then
      flen := coalesce((perf ->> 'len')::real, 0) + coalesce((select sum((c ->> 'len')::real) from jsonb_array_elements(cx) c
                                                              where (c ->> 'v')::boolean and (c ->> 'ka')::int <= k and k <= (c ->> 'kb')::int), 0);
      if flen > st.plat then ws := ws || format('%s のホーム（%sm）より編成（%sm）が長いです', st.name, st.plat, flen); end if;
    end if;
    sc := sc || jsonb_build_array(jsonb_build_array(r.stops[i], arr, dep, trk));
    if dep is not null then t := dep; end if;
    lastStop := i;
  end loop;
  -- 連結の時刻（つなぐ駅を出る時刻・切りはなす駅に着く時刻）
  cx := coalesce((select jsonb_agg((c.v - 'cp' - 'ka' - 'kb') || jsonb_build_object(
          'ta', (select (s.v ->> 2)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'a')::bigint order by s.so limit 1),
          'tb', (select (s.v ->> 1)::int from jsonb_array_elements(sc) with ordinality s(v, so) where (s.v ->> 0)::bigint = (c.v ->> 'b')::bigint order by s.so desc limit 1)) order by c.o)
        from jsonb_array_elements(cx) with ordinality c(v, o)), '[]'::jsonb);
  return jsonb_build_object('sc', sc, 'ws', to_jsonb(ws), 'cx', cx);
end $$;

create or replace function public._mp_dispatch(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; n int; km real[]; capd boolean[]; capu boolean[]; tr mp_trains; res jsonb; hld jsonb; waits bigint[]; tai_ jsonb; ws text[];
        ta int[]; td int[]; stp boolean[]; ord int[]; e jsonb; p int; q int; x int; a int; b int; kk int; jj int; it int; si int; j int; need int; conf boolean;
        sdir int[] := '{}'; sday date[] := '{}'; snum text[] := '{}'; sarr int[]; sdep int[]; m int := 0; skips int[]; cap boolean[]; H constant int := 60; key text;
        smin int[] := '{}'; smax int[] := '{}'; tmin int; tmax int;
        slen real[] := '{}'; sacc real[] := '{}'; sstp boolean[]; mlen real; macc real; pf jsonb; va real; vc real; ga int; gb int; ca int; cb int; gw int; HB constant int := 150;   -- t62：自動閉塞
        sprio int[] := '{}'; srid bigint[] := '{}'; mypr int; et record; kn int; a0 int; a1 int; edir int; eord int[]; estp boolean[]; k0d int; k1d int; kc int;
begin
  select * into r from mp_routes where id = rid;
  n := coalesce(array_length(r.stops, 1), 0);
  if r.kind <> 'rail' or n < 2 then
    for tr in select * from mp_trains where route = rid loop
      res := _mp_train_times(tr, '{}'::jsonb, '{}'::bigint[]);
      update mp_trains set sched = res -> 'sc', warn = nullif(array_to_string(array(select jsonb_array_elements_text(res -> 'ws')), ' / '), ''), cplx = res -> 'cx',
             hold = '{}'::jsonb, tai = '[]'::jsonb where id = tr.id;
    end loop;
    return;
  end if;
  -- 駅の km（系統の駅の順）と、待避できる駅（向きごとに使える番線が2つ以上）
  km := array(select coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q2(l, kq) where kq < o), 0) from generate_series(1, n) o);
  capd := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')   -- 通過線（t62）
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  capu := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  -- ほかの系統の列車（2026-10-28・xwait のとき）：この系統の駅を2つ以上通る列車を、先に決まった列車として入れる（相手の時刻は変えない）。
  --   こちらがゆずるのは、優先番号が小さい列車（同じなら、系統の番号が小さいほう）だけ。通るだけの駅（相手の系統にもある駅）は距離でわりふる
  if coalesce(r.xwait, false) then
    for et in select t.num, t.day, t.sched, ro.id rid2, ro.stops st2, _mp_kprio(ro.own_u, ro.own_c, t.kind) pr, t.form
                from mp_trains t join mp_routes ro on ro.id = t.route
               where ro.id <> rid and ro.kind = 'rail' and ro.stops && r.stops and not t.bad and jsonb_array_length(t.sched) > 1 loop
      ta := array_fill(null::int, array[n]); td := array_fill(null::int, array[n]); estp := array_fill(false, array[n]); kn := 0;
      for e in select v from jsonb_array_elements(et.sched) v loop
        p := array_position(r.stops, (e ->> 0)::bigint);
        if p is null then continue; end if;
        if estp[p] then p := _mp_rpos(r.stops, 1, (e ->> 0)::bigint, true); if estp[p] then continue; end if; end if;   -- 環状線：同じ駅の2回目
        ta[p] := coalesce((e ->> 1)::int, (e ->> 2)::int); td[p] := coalesce((e ->> 2)::int, (e ->> 1)::int); estp[p] := true; kn := kn + 1;
      end loop;
      if kn < 2 then continue; end if;
      a0 := array_position(estp, true); a1 := n + 1 - array_position(array(select estp[g] from generate_series(n, 1, -1) g), true);
      edir := case when td[a0] <= ta[a1] then 1 else -1 end;
      eord := case when edir = -1 then array(select generate_series(n, 1, -1)) else array(select generate_series(1, n)) end;
      for kk in 1..n loop
        x := eord[kk];
        if estp[x] or x < a0 or x > a1 or not (r.stops[x] = any(et.st2)) then continue; end if;
        p := null; q := null;
        for jj in reverse kk - 1..1 loop if estp[eord[jj]] then p := eord[jj]; exit; end if; end loop;
        for jj in kk + 1..n loop if estp[eord[jj]] then q := eord[jj]; exit; end if; end loop;
        if p is null or q is null then continue; end if;
        td[x] := td[p] + round((ta[q] - td[p]) * abs(km[x] - km[p]) / greatest(abs(km[q] - km[p]), 0.001))::int;
        ta[x] := td[x];
      end loop;
      m := m + 1; sdir := sdir || edir; sday := sday || et.day; snum := snum || et.num;
      smin := smin || (select min(v) from unnest(ta || td) v); smax := smax || (select max(v) from unnest(ta || td) v);
      sprio := sprio || et.pr; srid := srid || et.rid2;
      pf := case when et.form is not null then _mp_form_perf(et.form) end; slen := slen || coalesce((pf ->> 'len')::real, 100); sacc := sacc || coalesce((pf ->> 'acc')::real, 2);
      if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[estp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[estp]; end if;
    end loop;
  end if;
  for tr in select x2.* from mp_trains x2 where x2.route = rid
             order by (x2.day is not null), x2.day, _mp_kprio(r.own_u, r.own_c, x2.kind), x2.dep, x2.id loop
    mypr := _mp_kprio(r.own_u, r.own_c, tr.kind);
    pf := case when tr.form is not null then _mp_form_perf(tr.form) end;
    mlen := coalesce((pf ->> 'len')::real, 100) + coalesce((select sum((c ->> 'len')::real) from jsonb_array_elements(coalesce(tr.cplx, '[]'::jsonb)) c where coalesce((c ->> 'v')::boolean, false)), 0);
    macc := coalesce((pf ->> 'acc')::real, 2);
    ord := case when tr.dir = -1 then array(select generate_series(n, 1, -1)) else array(select generate_series(1, n)) end;
    cap := case when tr.dir = -1 then capu else capd end;
    hld := '{}'::jsonb; waits := '{}'; tai_ := '[]'::jsonb; ws := '{}'; skips := '{}';
    for it in 1..16 loop
      res := _mp_train_times(tr, hld, waits);
      -- 駅ごとの時刻（系統の駅の順）：止まる駅は着・発、通過する駅は前後の止まる駅から距離でわりふる
      ta := array_fill(null::int, array[n]); td := array_fill(null::int, array[n]); stp := array_fill(false, array[n]); kc := 1;
      for e in select v from jsonb_array_elements(res -> 'sc') v loop
        while kc <= n and r.stops[ord[kc]] <> (e ->> 0)::bigint loop kc := kc + 1; end loop;   -- 走る順に見る（環状線：同じ駅は前のほうから）
        if kc > n then continue; end if;
        p := ord[kc]; kc := kc + 1;
        ta[p] := coalesce((e ->> 1)::int, (e ->> 2)::int); td[p] := coalesce((e ->> 2)::int, (e ->> 1)::int); stp[p] := true;
      end loop;
      for kk in 1..n loop
        x := ord[kk];
        if stp[x] then continue; end if;
        p := null; q := null;
        for jj in reverse kk - 1..1 loop if stp[ord[jj]] then p := ord[jj]; exit; end if; end loop;
        for jj in kk + 1..n loop if stp[ord[jj]] then q := ord[jj]; exit; end if; end loop;
        if p is null or q is null then continue; end if;
        td[x] := td[p] + round((ta[q] - td[p]) * abs(km[x] - km[p]) / greatest(abs(km[q] - km[p]), 0.001))::int;
        ta[x] := td[x];
      end loop;
      -- 先に決めた同じ向きの列車と、となりの駅のあいだごとに見る
      --   （2026-10-28）時刻の幅（いちばん早い〜おそい）が1分半以上はなれている列車は、どの区間でもぶつからないので見ない（結果は前と同じ。本数の2乗で重かった）
      tmin := (select min(v) from unnest(ta || td) v); tmax := (select max(v) from unnest(ta || td) v);
      -- 走る区間の、はじめとおわりの駅（走る順の何番目か。途中始発・途中止まり）
      k0d := coalesce((select min(kq) from generate_series(1, n) kq where stp[ord[kq]]), 1); k1d := coalesce((select max(kq) from generate_series(1, n) kq where stp[ord[kq]]), n);
      conf := false;
      for si in 1..m loop
        if sdir[si] <> tr.dir or si = any(skips) then continue; end if;
        if tr.day is null and sday[si] is not null then continue; end if;
        if tr.day is not null and sday[si] is not null and sday[si] <> tr.day then continue; end if;
        if tmin is null or smax[si] is null or smax[si] + HB + 30 < tmin or smin[si] > tmax + HB then continue; end if;
        if sprio[si] is not null and (sprio[si] > mypr or (sprio[si] = mypr and srid[si] > rid)) then continue; end if;   -- ほかの系統の、ゆずらなくてよい列車
        for kk in 1..n - 1 loop
          a := ord[kk]; b := ord[kk + 1];
          if ta[b] is null or td[a] is null or sarr[si][b] is null or sdep[si][a] is null then continue; end if;
          if td[a] >= sdep[si][a] then
            -- うしろを走る（自動閉塞・t62）：前の列車のうしろ 30m まで。a を出るとき・b に入るときに、前の列車が（長さ＋30m）はなれている。
            --   b に前の列車が止まっていて、同じ番線に入るとき（こちらも b に止まる・こちらは通過でも、その向きに通れる番線がほかにない）は、前の列車が b を出てから
            va := abs(km[b] - km[a]) / greatest(sarr[si][b] - sdep[si][a], 1);   -- 前の列車の、この区間の平均の速さ（m/s）
            ga := case when sstp[si][a] then _mp_clr_stop(slen[si], sacc[si]) else _mp_clr_pass(slen[si], va) end;
            gb := _mp_clr_pass(slen[si], va * 0.6);
            need := greatest(sdep[si][a] + ga - td[a], sarr[si][b] + gb - ta[b]);
            if sstp[si][b] and (stp[b] or not cap[b]) then need := greatest(need, sdep[si][b] + _mp_clr_stop(slen[si], sacc[si]) - ta[b]); end if;
            if need > 0 then
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] then j := jj; exit; end if; end loop;
              key := r.stops[ord[j]]::text;
              hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
              tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', true));
              conf := true; exit;
            end if;
          else
            -- 前を走る：うしろの列車（si）に追いつかれないか（こちらが a・b を出て、長さ＋30m はなれるまでに、si が来ない）
            vc := abs(km[b] - km[a]) / greatest(ta[b] - td[a], 1);
            ca := case when stp[a] then _mp_clr_stop(mlen, macc) else _mp_clr_pass(mlen, vc) end;
            cb := case when stp[b] then _mp_clr_stop(mlen, macc) else _mp_clr_pass(mlen, vc) end;
            if sdep[si][a] < td[a] + ca or sarr[si][b] < td[b] + cb or sarr[si][a] < td[a] + ca then
              -- 追いつかれる。つぎの駅で待避できて、そこまでは追いこされないなら、つぎの駅で
              if sarr[si][b] >= ta[b] + _mp_clr_pass(mlen, vc * 0.6) and stp[b] and cap[b] and kk + 1 < k1d and sdep[si][a] >= td[a] + ca and sarr[si][a] >= td[a] + ca then continue; end if;
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] and (cap[ord[jj]] or jj = k0d) then j := jj; exit; end if; end loop;
              if j is null then
                ws := ws || format('%s に追いつかれます（待避できる駅がありません）', snum[si]); skips := skips || si; conf := true; exit;
              end if;
              -- 待避する駅で、うしろの列車が出て（通って）、その長さ＋30m はなれてから出る
              gw := case when sstp[si][ord[j]] then _mp_clr_stop(slen[si], sacc[si])
                         when j < n and sarr[si][ord[j + 1]] is not null then _mp_clr_pass(slen[si], abs(km[ord[j + 1]] - km[ord[j]]) / greatest(sarr[si][ord[j + 1]] - sdep[si][ord[j]], 1))
                         else _mp_clr_pass(slen[si], null) end;
              need := greatest(sdep[si][ord[j]] + gw - td[ord[j]], 1);
              key := r.stops[ord[j]]::text;
              hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
              if not (r.stops[ord[j]] = any(waits)) and j > k0d then waits := waits || r.stops[ord[j]]; end if;
              tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', j = k0d));
              conf := true; exit;
            end if;
          end if;
        end loop;
        if conf then exit; end if;
      end loop;
      if not conf then exit; end if;
      if it = 16 then ws := ws || '待避・続行がおさまりません（時刻を見なおしてください）'::text; end if;
    end loop;
    -- 駅ごとにまとめる（待避：f = false・続行と始発でおそく出る：f = true）
    tai_ := coalesce((select jsonb_agg(jsonb_build_object('s', z.s, 'by', z.bys, 'sec', z.sec, 'f', z.f) order by z.o)
                       from (select (v ->> 's')::bigint s, (v ->> 'f')::boolean f, sum((v ->> 'sec')::int) sec, jsonb_agg(distinct v ->> 'by') bys, min(o) o
                               from jsonb_array_elements(tai_) with ordinality w(v, o) group by 1, 2) z), '[]'::jsonb);
    update mp_trains set sched = res -> 'sc', cplx = res -> 'cx', hold = hld, tai = tai_,
           warn = nullif(array_to_string(array(select jsonb_array_elements_text(res -> 'ws')) || ws, ' / '), '') where id = tr.id;
    -- 決まった列車にくわえる
    m := m + 1; sdir := sdir || tr.dir; sday := sday || tr.day; snum := snum || tr.num; smin := smin || tmin; smax := smax || tmax; sprio := sprio || null::int; srid := srid || rid;
    slen := slen || mlen; sacc := sacc || macc;
    if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[stp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[stp]; end if;
  end loop;
end $$;

create or replace function public._mp_resched(rid bigint) returns void
language plpgsql set search_path = public as $$
declare tr mp_trains; a record; b record; r mp_routes; w text; fid bigint; lsta bigint; lt int; lnum text; dd date; ldated bigint; ldci int; pass int;
begin
  perform _mp_dispatch(rid);   -- 時刻（待避・続行もふくめて）
  select * into r from mp_routes where id = rid;
  -- 番線：同じ駅・同じ番線に、重なる（t62：自動閉塞。前の列車が出て、長さ＋30m はなれるまで。前は前後30秒ずつ）
  --   （2026-10-28）前は列車の組ごとに sched をひらいていて「本数の2乗×駅数の2乗」かかり、列車をまとめて足すと8秒の制限をこえていた。
  --   いまは駅ごとの発着を1回だけ表にして、駅・番線でつなぐ。注意書きも、列車ごとにまとめて1回で書く（中身は前と同じ）
  --   さらに10分ごとの枠（bk）でもつなぐ：重なる2つは、両方の最初の枠のおそいほう（greatest(p)）で1回だけ出会う
  with pf as materialized (   -- 編成ごとの「出てから はなれるまで」の秒
    select f.form, _mp_clr_stop((q.p ->> 'len')::real, (q.p ->> 'acc')::real) clr
      from (select distinct t.form from mp_trains t where t.route in (select id from mp_routes where stops && r.stops) and t.form is not null) f,
           lateral (select _mp_form_perf(f.form) p) q),
  st as materialized (
    select z.*, floor(least(z.ta, z.td + z.clr) / 600.0)::int p, floor(greatest(z.ta, z.td + z.clr) / 600.0)::int q from (
      select t.id, t.route, t.num, t.day, s.v ->> 0 sta, s.v ->> 3 trk,
             coalesce((s.v ->> 1)::int, (s.v ->> 2)::int) ta, coalesce((s.v ->> 2)::int, (s.v ->> 1)::int) td,
             coalesce((select pf.clr from pf where pf.form = t.form), _mp_clr_stop(null, null)) clr
        from mp_trains t cross join lateral jsonb_array_elements(t.sched) s(v)
       where t.route in (select id from mp_routes where stops && r.stops) and s.v ->> 0 is not null and s.v ->> 3 is not null) z),
  sb as materialized (select st.*, w10.bk from st cross join lateral generate_series(st.p, st.q) w10(bk)),
  c as materialized (
    select t1.id i1, t2.id i2, t1.num n1, t2.num n2, t1.trk, (select name from mp_stations where id = t1.sta::bigint) sn
      from sb t1 join sb t2 on t2.sta = t1.sta and t2.trk = t1.trk and t2.bk = t1.bk and t1.id < t2.id
     where t1.bk = greatest(t1.p, t2.p)
       and (t1.route = rid or t2.route = rid)
       and (t1.day is null or t2.day is null or t1.day = t2.day)
       and t1.ta < t2.td + t2.clr and t2.ta < t1.td + t1.clr),
  g as (
    select z.id, string_agg(z.m, ' / ') m from (
      select c.i1 id, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n2) m from c
      union all select c.i2, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n1) from c) z group by z.id)
  update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id and t.route = rid;
  -- 単線：となりの駅のあいだ（単線のある区間）に、反対向きの列車が同じ時刻にいる（となりの駅は lead で1回ずつ）
  if r.kind = 'rail' then
    with x as materialized (
      select z.id, z.dir, z.day, z.num, z.sa, z.sb, z.d, z.a from (
        select t.id, t.dir, t.day, t.num, (e.v ->> 0)::bigint sa, (lead(e.v) over w ->> 0)::bigint sb, (e.v ->> 2)::int d, (lead(e.v) over w ->> 1)::int a, lead(e.v) over w nx
          from mp_trains t, jsonb_array_elements(t.sched) with ordinality e(v, o)
         where t.route = rid and t.dir in (1, -1)
        window w as (partition by t.id order by e.o)) z
       where z.nx is not null),
    c as materialized (
      select x1.id i1, x2.id i2, x1.num n1, x2.num n2, x1.sa, x1.sb
        from x x1 join x x2 on x2.sa = x1.sb and x2.sb = x1.sa
       where x1.dir = 1 and x2.dir = -1
         and x1.d < x2.a and x2.d < x1.a and (x1.day is null or x2.day is null or x1.day = x2.day)
         and exists (select 1 from generate_series(array_position(r.stops, x1.sa),
                       (select min(z.o) from unnest(r.stops) with ordinality z(s, o) where z.s = x1.sb and z.o > array_position(r.stops, x1.sa))::int - 1) k
                      where (r.legs -> (k - 1) ->> 's')::boolean)),
    g as (
      select z.id, string_agg(z.m, ' / ') m from (
        select c.i1 id, format('単線の区間（%s〜%s）で %s とすれちがえません', (select s.name from mp_stations s where s.id = c.sa), (select s.name from mp_stations s where s.id = c.sb), c.n2) m from c
        union all select c.i2, format('単線の区間で %s とすれちがえません', c.n1) from c) z group by z.id)
    update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id;
  end if;
  update mp_trains set bad = true where route = rid and form is null;
  -- 編成のつながり：編成ごとに時刻の順に見て、前に走る列車の終点から2分以上あけて出られる列車だけが走る（走れない列車は bad）
  --   連結（cplx）も、その編成の走りとして見る（つなぐ駅を出てから、切りはなす駅に着くまで）。まにあわない連結は、つながない（ok = false）
  --   連結する列車が走るかどうかは、ほかの編成の結果で決まるので、2回まわす
  for pass in 1..2 loop
    for fid in select z.f from (select distinct form f from mp_trains where route = rid and form is not null
                                union select distinct (c ->> 'f')::bigint from mp_trains t, jsonb_array_elements(t.cplx) c where t.route = rid and (c ->> 'v')::boolean) z
                order by z.f loop
      -- 毎日の列車
      lsta := null; lt := null; lnum := null;
      for a in select * from _mp_form_runs(fid) x where x.day is null order by x.ft, x.tid, x.ci loop
        if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
        w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0);
        perform _mp_run_mark(a.tid, a.ci, w);
        if w is null then lsta := a.es; lt := a.et; lnum := a.num; end if;
      end loop;
      -- 臨時列車：その日の毎日の列車とあわせて見る。臨時列車のせいで毎日の列車がまにあわなくなるときは、臨時列車のほうが走れない（連結しない）
      for dd in select distinct x.day from _mp_form_runs(fid) x where x.day is not null loop
        lsta := null; lt := null; lnum := null; ldated := null; ldci := null;
        for a in select * from _mp_form_runs(fid) x where x.day is null or x.day = dd order by x.ft, x.tid, x.ci loop
          if a.day is null and not a.ok then continue; end if;   -- 毎日の走りで走れないもの（つながないもの）は、とばす
          if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
          w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0);
          if a.day is not null then
            perform _mp_run_mark(a.tid, a.ci, w);
            if w is null then lsta := a.es; lt := a.et; lnum := a.num; ldated := a.tid; ldci := a.ci; end if;
          else
            if w is not null and ldated is not null then
              perform _mp_run_mark(ldated, ldci, format(case when ldci > 0 then 'この臨時列車のあと、%s にまにあいません（連結しません）'
                                                             else '【編成】この臨時列車のあと、%s にまにあいません（走れません）' end, a.num));
            end if;
            lsta := a.es; lt := a.et; lnum := a.num; ldated := null;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  if r.kind = 'air' then perform _mp_slot_mark(); end if;   -- 発着口（t57）：出る空港・1時間ごとに、持っている発着口の数まで
end $$;

create or replace function public.mp_sta_trk_set(p_sta bigint, p_trk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; v jsonb; nv jsonb := '[]'::jsonb; rr bigint;
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_sta for update;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  if p_trk is not null then
    if jsonb_typeof(p_trk) <> 'array' or jsonb_array_length(p_trk) <> greatest(st.tracks, 1) then raise exception '番線の数があっていません'; end if;
    for v in select x from jsonb_array_elements(p_trk) x loop
      if not (v ->> 'd' in ('down', 'up', 'both') and v ->> 'm' in ('main', 'side', 'pass')) then raise exception '番線の使いかたがちがいます'; end if;   -- pass：通過線（t62）
      nv := nv || jsonb_build_array(jsonb_build_object('d', v ->> 'd', 'm', v ->> 'm'));
    end loop;
    -- 止まる列車のために、下り・上りそれぞれ、ホームのある番線（通過線でない）がいる
    if not exists (select 1 from jsonb_array_elements(nv) v where v ->> 'd' in ('down', 'both') and v ->> 'm' <> 'pass') then raise exception '下りの列車が止まれる番線（ホームのある番線）がありません'; end if;
    if not exists (select 1 from jsonb_array_elements(nv) v where v ->> 'd' in ('up', 'both') and v ->> 'm' <> 'pass') then raise exception '上りの列車が止まれる番線（ホームのある番線）がありません'; end if;
  end if;
  update mp_stations set trk = case when p_trk is null then null else nv end where id = p_sta;
  for rr in select r.id from mp_routes r where p_sta = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_sta, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'trk', (select _mp_sta_trk(s) from mp_stations s where s.id = p_sta));
end $$;

-- 国じゅうの系統（t62：列車・バスをさがす）。走っている系統の番号・種類・名前・色・列車の数
create or replace function public.mp_routes_pub() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'n', q.n) order by r.id), '[]'::jsonb)
            from mp_routes r join lateral (select count(*) n from mp_trains t where t.route = r.id and not t.bad) q on q.n > 0
           where r.ok);
end $$;
grant execute on function public.mp_routes_pub() to authenticated;

alter function public.mp_sta_trk_set(bigint, jsonb) set statement_timeout = '20s';
revoke all on function public._mp_clr_stop(double precision, double precision) from public, anon, authenticated;
revoke all on function public._mp_clr_pass(double precision, double precision) from public, anon, authenticated;   -- 時刻を組みなおす操作は20秒まで（schema.sql のとおり）
revoke all on function public.mp_routes_pub() from public, anon;
grant execute on function public.mp_routes_pub() to authenticated;

-- ぜんぶの鉄道の系統を、新しい決まりで組みなおす
do $$
declare x record; n int := 0; w int;
begin
  for x in select id from mp_routes where kind = 'rail' order by id loop
    perform _mp_resched(x.id); n := n + 1;
  end loop;
  select count(*) into w from mp_trains t join mp_routes ro on ro.id = t.route where ro.kind = 'rail' and t.warn is not null;
  raise warning '自動閉塞：鉄道の系統 % を組みなおしました（注意のある列車 %本）', n, w;
end $$;
