-- 待避・続行の不具合直し（2026-10-30）
-- ・あとを走る列車が、前の列車が駅を出てから1分あけずに着いていた（番線の重なりの見かたとちがっていた）のを直す
-- ・追いつかれるかどうかを、駅に着いてから出るまでの間も見る
-- ・直したあと、鉄道の系統をぜんぶ組みなおす（2回。1分ほど）。10月29日の写しでためしたら、
--   瑠璃急行線の重なり 62本 → 2本、ほかの系統は変わらなかった

create or replace function public._mp_dispatch(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; n int; km real[]; capd boolean[]; capu boolean[]; tr mp_trains; res jsonb; hld jsonb; waits bigint[]; tai_ jsonb; ws text[];
        ta int[]; td int[]; stp boolean[]; ord int[]; e jsonb; p int; q int; x int; a int; b int; kk int; jj int; it int; si int; j int; need int; conf boolean;
        sdir int[] := '{}'; sday date[] := '{}'; snum text[] := '{}'; sarr int[]; sdep int[]; m int := 0; skips int[]; cap boolean[]; H constant int := 60; key text;
        smin int[] := '{}'; smax int[] := '{}'; tmin int; tmax int;
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
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  capu := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both')) >= 2
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  -- ほかの系統の列車（2026-10-28・xwait のとき）：この系統の駅を2つ以上通る列車を、先に決まった列車として入れる（相手の時刻は変えない）。
  --   こちらがゆずるのは、優先番号が小さい列車（同じなら、系統の番号が小さいほう）だけ。通るだけの駅（相手の系統にもある駅）は距離でわりふる
  if coalesce(r.xwait, false) then
    for et in select t.num, t.day, t.sched, ro.id rid2, ro.stops st2, _mp_kprio(ro.own_u, ro.own_c, t.kind) pr
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
      if m = 1 then sarr := array[ta]; sdep := array[td]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; end if;
    end loop;
  end if;
  for tr in select x2.* from mp_trains x2 where x2.route = rid
             order by (x2.day is not null), x2.day, _mp_kprio(r.own_u, r.own_c, x2.kind), x2.dep, x2.id loop
    mypr := _mp_kprio(r.own_u, r.own_c, tr.kind);
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
        if tmin is null or smax[si] is null or smax[si] + H + 30 < tmin or smin[si] > tmax + H then continue; end if;
        if sprio[si] is not null and (sprio[si] > mypr or (sprio[si] = mypr and srid[si] > rid)) then continue; end if;   -- ほかの系統の、ゆずらなくてよい列車
        for kk in 1..n - 1 loop
          a := ord[kk]; b := ord[kk + 1];
          if ta[b] is null or td[a] is null or sarr[si][b] is null or sdep[si][a] is null then continue; end if;
          if td[a] >= sdep[si][a] then
            -- うしろを走る：前の列車のあとを1分あけて（その向きの番線が1つしかない駅では、前の列車が出てから）
            need := greatest(sdep[si][a] + H - td[a], sarr[si][b] + H - ta[b], sdep[si][b] + H - ta[b]);   -- 2026-10-30：前の列車が出てから1分（番線の重なりの見かたと同じ）
            if need > 0 then
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] then j := jj; exit; end if; end loop;
              key := r.stops[ord[j]]::text;
              hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
              tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', true));
              conf := true; exit;
            end if;
          elsif sdep[si][a] < td[a] + H or sarr[si][b] < td[b] + H or sarr[si][a] < td[a] + H then   -- 2026-10-30：着いてから出るまでの間も見る
            -- 前を走るのに追いつかれる。つぎの駅で待避できて、そこまでは追いこされないなら、つぎの駅で
            if sarr[si][b] >= ta[b] and stp[b] and cap[b] and kk + 1 < k1d and sdep[si][a] >= td[a] + H and sarr[si][a] >= td[a] + H then continue; end if;
            j := null; for jj in reverse kk..1 loop if stp[ord[jj]] and (cap[ord[jj]] or jj = k0d) then j := jj; exit; end if; end loop;
            if j is null then
              ws := ws || format('%s に追いつかれます（待避できる駅がありません）', snum[si]); skips := skips || si; conf := true; exit;
            end if;
            need := greatest(sdep[si][ord[j]] + H - td[ord[j]], 1);
            key := r.stops[ord[j]]::text;
            hld := jsonb_set(hld, array[key], to_jsonb(coalesce((hld ->> key)::int, 0) + need));
            if not (r.stops[ord[j]] = any(waits)) and j > k0d then waits := waits || r.stops[ord[j]]; end if;
            tai_ := tai_ || jsonb_build_array(jsonb_build_object('s', r.stops[ord[j]], 'by', snum[si], 'sec', need, 'f', j = k0d));
            conf := true; exit;
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
    if m = 1 then sarr := array[ta]; sdep := array[td]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; end if;
  end loop;
end $$;
do $$
declare r record; pass int;
begin
  for pass in 1..2 loop
    for r in select id from mp_routes where kind = 'rail' order by id loop
      perform _mp_resched(r.id);
    end loop;
  end loop;
end $$;
