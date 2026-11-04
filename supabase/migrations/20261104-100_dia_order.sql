-- ダイヤの運転整理：列車ごと・まとめて「○○駅で打ち切り」「同じ系統の先の駅まで延長運転」「○○駅から運転」「始発を延ばす」「臨時停車」「通過」「時刻をずらす」「運休」を指示する
--   毎日（ふだんのダイヤの列車を変える）か、日をきめて（31日まで・60日先まで・曜日もえらべる）。日をきめると、その日だけ走る「運転整理の列車」をつくり、もとの列車は その日は走らない
--   臨時列車・運転整理の列車は、その日は走らない列車にゆずらない（待避・続行・番線と単線のかさなり）。運転整理の列車は、編成のつながりを見ない（もとの列車の走りとみる）
--   どれも ダイヤの「↶ 取り消す」でもどせる。「↶ 取り消す」で、運行の操作で決めた運休が消えていたのも直す

alter table public.mp_trains add column if not exists orig bigint references public.mp_trains(id) on delete cascade;   -- 運転整理の列車（DB の更新100）：この日（day）だけ、毎日の列車 orig のかわりに走る
alter table public.mp_trains add column if not exists ordj jsonb;   -- 運転整理の指示 [{k, s, m}]（orig のある列車。重ねた順）
create index if not exists mp_trains_orig on public.mp_trains (orig, day) where orig is not null;
alter table public.mp_dia_hist add column if not exists cx jsonb;   -- 運転整理の運休（DB の更新100）：[[列車, 日], …]。null は前の形（運休なし）
alter table public.mp_cxl add column if not exists ordk text check (ordk in ('v', 'x'));   -- 運転整理（DB の更新100）：v その日は運転整理の列車が かわりに走る・x 運休。null は運行の操作で決めた運休
create index if not exists mp_cxl_ord on public.mp_cxl (route, day) where ordk is not null;

-- 運転整理の列車（DB の更新100）：できたら、もとの列車は その日は走らない（mp_cxl の v。その日の運転整理の運休 x はやめる）。消えたら もとの列車が走る。日・もとの列車が変わったら つけかえる
create or replace function public._mp_ord_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.orig is not null and old.day is not null then
    delete from mp_cxl where train = old.orig and day = old.day and ordk = 'v';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.orig is not null and new.day is not null then
    delete from mp_cxl where train = new.orig and day = new.day and ordk = 'x';
    if not exists (select 1 from mp_cxl where train = new.orig and day = new.day and ordk = 'v') then
      insert into mp_cxl(train, day, route, own_u, own_c, ordk)
      select new.orig, new.day, new.route, ro.own_u, ro.own_c, 'v' from mp_routes ro where ro.id = new.route;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists mp_trains_ord_i on public.mp_trains;
create trigger mp_trains_ord_i after insert on public.mp_trains for each row when (new.orig is not null) execute function public._mp_ord_trg();
drop trigger if exists mp_trains_ord_u on public.mp_trains;
create trigger mp_trains_ord_u after update of orig, day on public.mp_trains for each row when (old.orig is distinct from new.orig or old.day is distinct from new.day) execute function public._mp_ord_trg();
drop trigger if exists mp_trains_ord_d on public.mp_trains;
create trigger mp_trains_ord_d after delete on public.mp_trains for each row when (old.orig is not null) execute function public._mp_ord_trg();

create or replace function public._mp_dispatch(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; n int; km real[]; capd boolean[]; capu boolean[]; tr mp_trains; res jsonb; hld jsonb; waits bigint[]; tai_ jsonb; ws text[];
        ta int[]; td int[]; stp boolean[]; ord int[]; e jsonb; p int; q int; x int; a int; b int; kk int; jj int; it int; si int; j int; need int; conf boolean;
        sdir int[] := '{}'; sday date[] := '{}'; snum text[] := '{}'; sarr int[]; sdep int[]; m int := 0; skips int[]; cap boolean[]; H constant int := 60; key text;
        smin int[] := '{}'; smax int[] := '{}'; tmin int; tmax int;
        slen real[] := '{}'; sacc real[] := '{}'; sstp boolean[]; mlen real; macc real; pf jsonb; va real; vc real; ga int; gb int; ca int; cb int; gw int; HB constant int := 150;   -- t62：自動閉塞
        lsg int[]; lv int;   -- 信号の段（駅と駅のあいだごと。DB の更新85）
        lq boolean[]; sexp boolean[] := '{}'; myx boolean;   -- 複々線（DB の更新86）：駅と駅のあいだが複々線か・急行線を走る列車か（優先番号 3 まで）
        sprio int[] := '{}'; srid bigint[] := '{}'; mypr int; et record; kn int; a0 int; a1 int; edir int; eord int[]; estp boolean[]; k0d int; k1d int; kc int;
        stid bigint[] := '{}'; xcs jsonb;   -- 決まった列車の id・その日は走らない列車（運転整理。DB の更新100）
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
  -- 運転整理（DB の更新100）：その日は走らない列車（運転整理の列車が かわりに走る・運休）。臨時列車は、その日の それらの列車にはゆずらない
  xcs := coalesce((select jsonb_object_agg(zc.train::text || ':' || zc.day::text, true) from mp_cxl zc
                    where zc.ordk is not null and zc.day >= _mp_today() - 1
                      and (zc.route = rid or (coalesce(r.xwait, false) and zc.route in (select ro.id from mp_routes ro where ro.stops && r.stops)))), '{}'::jsonb);
  -- 駅の km（系統の駅の順）と、待避できる駅（向きごとに使える番線が2つ以上）
  km := array(select coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q2(l, kq) where kq < o), 0) from generate_series(1, n) o);
  lsg := _mp_leg_sig(r.legs);   -- 信号の段（DB の更新85）
  lq := _mp_leg_quad(r.legs);   -- 複々線（DB の更新86）
  capd := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('down', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')   -- 通過線（t62）
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  capu := array(select (select count(*) from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both')) >= 2
                   and exists (select 1 from jsonb_array_elements(_mp_sta_trk(s)) v where v ->> 'd' in ('up', 'both') and coalesce(v ->> 'm', 'main') <> 'pass')
                  from unnest(r.stops) with ordinality z(id, o) join mp_stations s on s.id = z.id order by z.o);
  -- ほかの系統の列車（2026-10-28・xwait のとき）：この系統の駅を2つ以上通る列車を、先に決まった列車として入れる（相手の時刻は変えない）。
  --   こちらがゆずるのは、優先番号が小さい列車（同じなら、系統の番号が小さいほう）だけ。通るだけの駅（相手の系統にもある駅）は距離でわりふる
  if coalesce(r.xwait, false) then
    for et in select t.id tid, t.num, t.day, t.sched, ro.id rid2, ro.stops st2, _mp_kprio(ro.own_u, ro.own_c, t.kind) pr, t.form
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
      m := m + 1; sdir := sdir || edir; sday := sday || et.day; snum := snum || et.num; stid := stid || et.tid;
      smin := smin || (select min(v) from unnest(ta || td) v); smax := smax || (select max(v) from unnest(ta || td) v);
      sprio := sprio || et.pr; srid := srid || et.rid2; sexp := sexp || (et.pr <= 3);
      pf := case when et.form is not null then _mp_form_perf(et.form) end; slen := slen || coalesce((pf ->> 'len')::real, 100); sacc := sacc || coalesce((pf ->> 'acc')::real, 2);
      if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[estp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[estp]; end if;
    end loop;
  end if;
  for tr in select x2.* from mp_trains x2 where x2.route = rid
             order by (x2.day is not null), x2.day, _mp_kprio(r.own_u, r.own_c, x2.kind), x2.dep, x2.id loop
    mypr := _mp_kprio(r.own_u, r.own_c, tr.kind);
    myx := mypr <= 3;   -- 急行線を走る（複々線のところ。DB の更新86）
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
        if tr.day is not null and xcs ? (stid[si]::text || ':' || tr.day::text) then continue; end if;   -- その日は走らない列車（運転整理。DB の更新100）
        if sprio[si] is not null and (sprio[si] > mypr or (sprio[si] = mypr and srid[si] > rid)) then continue; end if;   -- ほかの系統の、ゆずらなくてよい列車
        for kk in 1..n - 1 loop
          a := ord[kk]; b := ord[kk + 1];
          if ta[b] is null or td[a] is null or sarr[si][b] is null or sdep[si][a] is null then continue; end if;
          if coalesce(lq[least(a, b)], false) and sexp[si] is distinct from myx then continue; end if;   -- 複々線：急行線と緩行線は べつの線路なので、追いこし・追いこされを見ない（DB の更新86）
          if td[a] >= sdep[si][a] then
            -- うしろを走る（自動閉塞・t62）：前の列車のうしろ 30m まで。a を出るとき・b に入るときに、前の列車が（長さ＋30m）はなれている。
            --   b に前の列車が止まっていて、同じ番線に入るとき（こちらも b に止まる・こちらは通過でも、その向きに通れる番線がほかにない）は、前の列車が b を出てから
            va := abs(km[b] - km[a]) / greatest(sarr[si][b] - sdep[si][a], 1);   -- 前の列車の、この区間の平均の速さ（m/s）
            lv := coalesce(lsg[least(a, b)], 0);   -- この区間の信号の段（DB の更新85）
            ga := case when sstp[si][a] then _mp_clr_stop2(slen[si], sacc[si], lv) else _mp_clr_pass2(slen[si], va, lv) end;
            gb := _mp_clr_pass2(slen[si], va * case lv when 2 then 0.9 when 1 then 0.75 else 0.6 end, lv);   -- 信号が強いほど、b のあたりでも速いまま つめられる
            need := greatest(sdep[si][a] + ga - td[a], sarr[si][b] + gb - ta[b]);
            if sstp[si][b] and (stp[b] or not cap[b]) then need := greatest(need, sdep[si][b] + _mp_clr_stop2(slen[si], sacc[si], lv) - ta[b]); end if;
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
            lv := coalesce(lsg[least(a, b)], 0);   -- この区間の信号の段（DB の更新85）
            ca := case when stp[a] then _mp_clr_stop2(mlen, macc, lv) else _mp_clr_pass2(mlen, vc, lv) end;
            cb := case when stp[b] then _mp_clr_stop2(mlen, macc, lv) else _mp_clr_pass2(mlen, vc, lv) end;
            if sdep[si][a] < td[a] + ca or sarr[si][b] < td[b] + cb or sarr[si][a] < td[a] + ca then
              -- 追いつかれる。つぎの駅で待避できて、そこまでは追いこされないなら、つぎの駅で
              if sarr[si][b] >= ta[b] + _mp_clr_pass2(mlen, vc * case lv when 2 then 0.9 when 1 then 0.75 else 0.6 end, lv) and stp[b] and cap[b] and kk + 1 < k1d and sdep[si][a] >= td[a] + ca and sarr[si][a] >= td[a] + ca then continue; end if;
              j := null; for jj in reverse kk..1 loop if stp[ord[jj]] and (cap[ord[jj]] or jj = k0d) then j := jj; exit; end if; end loop;
              if j is null then
                ws := ws || format('%s に追いつかれます（待避できる駅がありません）', snum[si]); skips := skips || si; conf := true; exit;
              end if;
              -- 待避する駅で、うしろの列車が出て（通って）、その長さ＋30m はなれてから出る
              lv := coalesce(case when j < n then lsg[least(ord[j], ord[j + 1])] end, case when j > 1 then lsg[least(ord[j], ord[j - 1])] end, 0);   -- 待避する駅の先の信号の段（DB の更新85）
              gw := case when sstp[si][ord[j]] then _mp_clr_stop2(slen[si], sacc[si], lv)
                         when j < n and sarr[si][ord[j + 1]] is not null then _mp_clr_pass2(slen[si], abs(km[ord[j + 1]] - km[ord[j]]) / greatest(sarr[si][ord[j + 1]] - sdep[si][ord[j]], 1), lv)
                         else _mp_clr_pass2(slen[si], null, lv) end;
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
    m := m + 1; sdir := sdir || tr.dir; sday := sday || tr.day; snum := snum || tr.num; stid := stid || tr.id; smin := smin || tmin; smax := smax || tmax; sprio := sprio || null::int; srid := srid || rid; sexp := sexp || myx;
    slen := slen || mlen; sacc := sacc || macc;
    if m = 1 then sarr := array[ta]; sdep := array[td]; sstp := array[stp]; else sarr := sarr || array[ta]; sdep := sdep || array[td]; sstp := sstp || array[stp]; end if;
  end loop;
end $$;
create or replace function public._mp_resched(rid bigint) returns void
language plpgsql set search_path = public as $$
declare tr mp_trains; a record; b record; r mp_routes; w text; fid bigint; lsta bigint; lt int; lnum text; dd date; ldated bigint; ldci int; pass int;
        sk jsonb; wl real; cl real; sr jsonb; stw boolean;   -- 蒸気機関車の補給（DB の更新78）
begin
  perform _mp_li_put(rid);   -- 駅と駅のあいだごとの 複々線・電化方式・デッドセクション を1回だけ（DB の更新88）
  perform _mp_dispatch(rid);   -- 時刻（待避・続行もふくめて）
  perform set_config('mp.li_r', '', true);
  select * into r from mp_routes where id = rid;
  -- 番線：同じ駅・同じ番線に、重なる（t62：自動閉塞。前の列車が出て、長さ＋30m はなれるまで。前は前後30秒ずつ。駅の線の信号が強ければ 20m・10m。DB の更新85）
  --   （2026-10-28）前は列車の組ごとに sched をひらいていて「本数の2乗×駅数の2乗」かかり、列車をまとめて足すと8秒の制限をこえていた。
  --   いまは駅ごとの発着を1回だけ表にして、駅・番線でつなぐ。注意書きも、列車ごとにまとめて1回で書く（中身は前と同じ）
  --   さらに10分ごとの枠（bk）でもつなぐ：重なる2つは、両方の最初の枠のおそいほう（greatest(p)）で1回だけ出会う
  --   （DB の更新88）この系統の列車が使う 駅・番線 の発着だけを見る（かさなるのは 同じ駅・同じ番線だけなので、中身は前と同じ）
  with rk as materialized (
    select distinct s.v ->> 0 sta, s.v ->> 3 trk from mp_trains t cross join lateral jsonb_array_elements(t.sched) s(v)
     where t.route = rid and s.v ->> 0 is not null and s.v ->> 3 is not null),
  ev as materialized (
    select t.id, t.route, t.num, t.day, t.form, s.v ->> 0 sta, s.v ->> 3 trk,
           coalesce((s.v ->> 1)::int, (s.v ->> 2)::int) ta, coalesce((s.v ->> 2)::int, (s.v ->> 1)::int) td
      from mp_trains t cross join lateral jsonb_array_elements(t.sched) s(v)
     where t.route in (select id from mp_routes where stops && r.stops) and s.v ->> 0 is not null and s.v ->> 3 is not null
       and (s.v ->> 0, s.v ->> 3) in (select rk.sta, rk.trk from rk)),
  pf as materialized (   -- 編成ごとの長さ・加速（「出てから はなれるまで」の秒は、駅の信号の段で）
    select f.form, (q.p ->> 'len')::real len, (q.p ->> 'acc')::real acc
      from (select distinct ev.form from ev where ev.form is not null) f,
           lateral (select _mp_form_perf(f.form) p) q),
  sl as materialized (   -- 駅の線の信号の段（DB の更新85）
    select s2.id, coalesce(sg.sig, 0)::int lv from mp_stations s2 left join mp_segs sg on sg.id = s2.seg
     where s2.id in (select unnest(ro.stops) from mp_routes ro where ro.stops && r.stops) and s2.id in (select distinct ev.sta::bigint from ev)),
  xc as materialized (   -- 運転整理（DB の更新100）：その日は走らない列車（運転整理の列車が かわりに走る・運休）とは かさなりを見ない
    select zc.train::text || ':' || zc.day::text k from mp_cxl zc where zc.ordk is not null and zc.day >= _mp_today() - 1 and zc.route in (select ro.id from mp_routes ro where ro.stops && r.stops)),
  st as materialized (
    select z.*, floor(least(z.ta, z.td + z.clr) / 600.0)::int p, floor(greatest(z.ta, z.td + z.clr) / 600.0)::int q from (
      select ev.id, ev.route, ev.num, ev.day, ev.sta, ev.trk, ev.ta, ev.td,
             _mp_clr_stop2((select pf.len from pf where pf.form = ev.form), (select pf.acc from pf where pf.form = ev.form), coalesce((select sl.lv from sl where sl.id = ev.sta::bigint), 0)) clr
        from ev) z),
  sb as materialized (select st.*, w10.bk from st cross join lateral generate_series(st.p, st.q) w10(bk)),
  c as materialized (
    select t1.id i1, t2.id i2, t1.num n1, t2.num n2, t1.trk, (select name from mp_stations where id = t1.sta::bigint) sn
      from sb t1 join sb t2 on t2.sta = t1.sta and t2.trk = t1.trk and t2.bk = t1.bk and t1.id < t2.id
     where t1.bk = greatest(t1.p, t2.p)
       and (t1.route = rid or t2.route = rid)
       and (t1.day is null or t2.day is null or t1.day = t2.day)
       and not (coalesce(t1.day, t2.day) is not null and (t1.id::text || ':' || coalesce(t1.day, t2.day)::text in (select xc.k from xc) or t2.id::text || ':' || coalesce(t1.day, t2.day)::text in (select xc.k from xc)))
       and t1.ta < t2.td + t2.clr and t2.ta < t1.td + t1.clr),
  g as (
    select z.id, string_agg(z.m, ' / ') m from (
      select c.i1 id, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n2) m from c
      union all select c.i2, format('%s %s番線で %s とかさなります', c.sn, c.trk, c.n1) from c) z group by z.id)
  update mp_trains t set warn = concat_ws(' / ', t.warn, g.m) from g where t.id = g.id and t.route = rid;
  -- 単線：となりの駅のあいだ（単線のある区間）に、反対向きの列車が同じ時刻にいる（となりの駅は lead で1回ずつ）
  if r.kind = 'rail' then
    with xc2 as materialized (select zc.train::text || ':' || zc.day::text k from mp_cxl zc where zc.ordk is not null and zc.route = rid and zc.day >= _mp_today() - 1),   -- 運転整理（DB の更新100）
    x as materialized (
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
         and not (coalesce(x1.day, x2.day) is not null and (x1.id::text || ':' || coalesce(x1.day, x2.day)::text in (select xc2.k from xc2) or x2.id::text || ':' || coalesce(x1.day, x2.day)::text in (select xc2.k from xc2)))
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
      sk := _mp_form_steam(fid); wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車（DB の更新78）：1日のはじめは水も石炭も満タン
      for a in select * from _mp_form_runs(fid) x where x.day is null order by x.ft, x.tid, x.ci loop
        if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
        w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0);
        if w is null and sk is not null then   -- 補給（DB の更新78）：止まる駅の給水・給炭で、駅のあいだを走りきれるか
          sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
          w := sr ->> 'w';
          if w is null then wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real;
          elsif a.ci > 0 then w := replace(w, '【補給】', '') || '（連結しません）'; end if;
        end if;
        perform _mp_run_mark(a.tid, a.ci, w);
        if w is null then lsta := a.es; lt := a.et; lnum := a.num; end if;
      end loop;
      -- 臨時列車：その日の毎日の列車とあわせて見る。臨時列車のせいで毎日の列車がまにあわなくなるときは、臨時列車のほうが走れない（連結しない）
      for dd in select distinct x.day from _mp_form_runs(fid) x where x.day is not null loop
        lsta := null; lt := null; lnum := null; ldated := null; ldci := null;
        wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車：その日のはじめは満タン（DB の更新78）
        for a in select * from _mp_form_runs(fid) x where x.day is null or x.day = dd order by x.ft, x.tid, x.ci loop
          if a.day is null and not a.ok then continue; end if;   -- 毎日の走りで走れないもの（つながないもの）は、とばす
          if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
          -- 運転整理（DB の更新100）：運転整理の列車は、編成のつながりを見ない（その日の もとの列車の走りとみる）。運転整理で運休にした列車は 走らない
          if a.day is not null and exists (select 1 from mp_trains zv where zv.id = a.tid and zv.orig is not null) then perform _mp_run_mark(a.tid, a.ci, null); continue; end if;
          if exists (select 1 from mp_cxl zc where zc.train = a.tid and zc.day = dd and zc.ordk = 'x') then
            if a.day is not null then perform _mp_run_mark(a.tid, a.ci, null); end if;
            continue;
          end if;
          w := _mp_run_check(lsta, lt, lnum, a.fs, a.ft, a.ci > 0); stw := false;
          if w is null and sk is not null then   -- 補給（DB の更新78）
            sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
            if sr ->> 'w' is not null then
              stw := true;
              w := case when a.day is not null and a.ci > 0 then replace(sr ->> 'w', '【補給】', '') || '（連結しません）' else sr ->> 'w' end;
            else wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real; end if;
          end if;
          if a.day is not null then
            perform _mp_run_mark(a.tid, a.ci, w);
            if w is null then lsta := a.es; lt := a.et; lnum := a.num; ldated := a.tid; ldci := a.ci; end if;
          else
            if w is not null and ldated is not null then
              perform _mp_run_mark(ldated, ldci, format(case when ldci > 0 then case when stw then 'この臨時列車のあと、%s の水か石炭がたりなくなります（連結しません）' else 'この臨時列車のあと、%s にまにあいません（連結しません）' end
                                                             else case when stw then '【補給】この臨時列車のあと、%s の水か石炭がたりなくなります（走れません）' else '【編成】この臨時列車のあと、%s にまにあいません（走れません）' end end, a.num));
            end if;
            lsta := a.es; lt := a.et; lnum := a.num; ldated := null;
            if stw then wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real; end if;   -- 毎日の列車は走るので、そのあとは ふだんどおりに（満タンとみる）
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  if r.kind = 'air' then perform _mp_slot_mark(); end if;   -- 発着口（t57）：出る空港・1時間ごとに、持っている発着口の数まで
end $$;
create or replace function public._mp_dia_snap(rid bigint, what text) returns void
language plpgsql set search_path = public as $$
begin
  insert into mp_dia_hist(route, what, trains, cx)
  values (rid, left(what, 80), coalesce((select jsonb_agg(to_jsonb(t) - 'sched' - 'warn' - 'bad' - 'cplx' - 'hold' - 'tai' - 'noslot' order by t.id) from mp_trains t where t.route = rid), '[]'::jsonb),
          coalesce((select jsonb_agg(jsonb_build_array(c.train, c.day) order by c.id) from mp_cxl c where c.route = rid and c.ordk = 'x' and c.day >= _mp_today()), '[]'::jsonb));   -- 運転整理の運休（DB の更新100）
  delete from mp_dia_hist h where h.route = rid and h.id not in (select x.id from mp_dia_hist x where x.route = rid order by x.id desc limit 20);
end $$;
create or replace function public.mp_dia_undo(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); r mp_routes; h mp_dia_hist; j jsonb; t mp_trains; n int := 0; kc mp_cxl[];
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route for update;
  if not found or not _mp_mine(u, r.own_u, r.own_c) then raise exception '系統が見つかりません'; end if;
  select * into h from mp_dia_hist where route = p_route order by id desc limit 1;
  if not found then raise exception 'もどせる操作がありません'; end if;
  -- 運行の操作で決めた運休（DB の更新60）は そのまま（前は 列車を入れなおすときに いっしょに消えていた。DB の更新100）
  kc := array(select c from mp_cxl c join mp_trains x on x.id = c.train where x.route = p_route and c.ordk is null);
  delete from mp_trains where route = p_route;
  for j in select * from jsonb_array_elements(h.trains) loop
    t := jsonb_populate_record(null::mp_trains, j || jsonb_build_object('route', p_route, 'sched', '[]'::jsonb, 'bad', false, 'cplx', '[]'::jsonb, 'hold', '{}'::jsonb, 'tai', '[]'::jsonb));
    if t.day is not null and t.day < _mp_today() then continue; end if;   -- 過ぎた臨時列車はもどさない
    -- もうない運用・駅ははずす。編成は運用の編成
    if t.op is not null and not exists (select 1 from mp_ops o where o.id = t.op and o.own_u is not distinct from r.own_u and o.own_c is not distinct from r.own_c) then t.op := null; end if;
    t.form := (select o.form from mp_ops o where o.id = t.op);
    t.skip := coalesce(array(select x from unnest(t.skip) x where x = any(r.stops)), '{}');
    t.cpl := coalesce((select jsonb_agg(c.v order by c.o) from jsonb_array_elements(coalesce(t.cpl, '[]'::jsonb)) with ordinality c(v, o)
                        where exists (select 1 from mp_ops o where o.id = (c.v ->> 'op')::bigint and o.own_u is not distinct from r.own_u and o.own_c is not distinct from r.own_c
                                         and o.kind = 'rail' and o.id is distinct from t.op)), '[]'::jsonb);
    insert into mp_trains select t.*;
    n := n + 1;
  end loop;
  insert into mp_cxl select x.* from unnest(kc) x where exists (select 1 from mp_trains y where y.id = x.train);
  -- 運転整理の運休（DB の更新100）は、もどす前のようすに（運転整理の列車の分は、列車を入れたときに）
  insert into mp_cxl(train, day, route, own_u, own_c, by_u, ordk)
  select (e ->> 0)::bigint, (e ->> 1)::date, p_route, r.own_u, r.own_c, u, 'x'
    from jsonb_array_elements(coalesce(h.cx, '[]'::jsonb)) e
   where (e ->> 1)::date >= _mp_today() and exists (select 1 from mp_trains y where y.id = (e ->> 0)::bigint)
     and not exists (select 1 from mp_cxl c where c.train = (e ->> 0)::bigint and c.day = (e ->> 1)::date);
  delete from mp_dia_hist where id = h.id;
  perform _mp_resched(p_route);
  perform _mp_chg('route', p_route, 'set', null);
  return jsonb_build_object('what', h.what, 'n', n, 'left', (select count(*) from mp_dia_hist where route = p_route));
end $$;
create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean;
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'mine', mine, 'ok', r.ok, 'why', r.why, 'dwell', r.dwell,
    'owner', _mp_pname(r.own_u, r.own_c, false), 'timing', to_jsonb(r.timing), 'last', r.last, 'xwait', r.xwait,
    -- 支線（DB の更新70）：本線と、この系統から分かれる支線（jct：分かれる駅）
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'jct', (select coalesce(jsonb_agg(distinct s.name), '[]'::jsonb) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid
                       where z.sid = any(p.stops) and (not (r.stops[z.o - 1] = any(p.stops)) or not (r.stops[z.o + 1] = any(p.stops))))) from mp_routes p where p.id = r.parent),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'color', b.color, 'jct', (select coalesce(jsonb_agg(distinct s.name), '[]'::jsonb) from unnest(b.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid
                       where z.sid = any(r.stops) and (not (b.stops[z.o - 1] = any(r.stops)) or not (b.stops[z.o + 1] = any(r.stops))))) order by b.id), '[]'::jsonb)
                   from mp_routes b where b.parent = r.id),
    'undo', case when mine then (select jsonb_build_object('what', h.what, 'at', h.at, 'n', (select count(*) from mp_dia_hist x where x.route = r.id))
                                   from mp_dia_hist h where h.route = r.id order by h.id desc limit 1) end,
    -- 列車に入れられる運用（持ち主の、同じ種類の運用）
    'ops', case when mine then (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num, 'form', o.form, 'fname', f.name,
                                   'n', (select count(*) from mp_cars c where c.form = o.form)) order by o.num), '[]'::jsonb)
                                  from mp_ops o left join mp_forms f on f.id = o.form
                                 where o.own_u is not distinct from r.own_u and o.own_c is not distinct from r.own_c and o.kind = r.kind) end,
    'today', _mp_today(), 'ord', true,   -- 運転整理（DB の更新100）
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y) order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats,
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'fser', fi.ser, 'fn', fi.n,   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 3, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi),
                         'det', case when q.zi is not null and z.det is not null then (z.det ->> r.id::text)::float8 end) order by r.id), '[]'::jsonb)   -- 区間（DB の更新60）・迂回の速さ（DB の更新82）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide, 'ori', z.ori, 'det', z.det is not null,
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
            where c.ordk is null and ((c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours'))));   -- 運転整理の分は mp_dia で（DB の更新100）
end $$;
create or replace function public.mp_cxl_add(p_train bigint, p_day date, p_form bigint, p_hours real, p_unko bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; tr record; f mp_forms; z mp_unko; today date := (now() at time zone 'Asia/Tokyo')::date; cid bigint; t1 timestamptz;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if (p_train is null) = (p_form is null) then raise exception '列車か編成をえらんでください'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  -- おわったものは かたづける（この名義の）
  delete from mp_cxl c where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc
     and ((c.day is not null and c.day < today - 1) or (c.t1 is not null and c.t1 < now() - interval '1 day'));
  if (select count(*) from mp_cxl c where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc and c.ordk is null) >= 300 then   -- 運転整理の分は数えない（DB の更新100）
    raise exception '運休にしている列車が多すぎます（300まで。運休をやめてから）';
  end if;
  if p_unko is not null then
    select * into z from mp_unko where id = p_unko;
    if not found then raise exception '運行情報が見つかりません'; end if;
  end if;
  if p_train is not null then
    select t.id, t.route, t.day, ro.own_u, ro.own_c into tr from mp_trains t join mp_routes ro on ro.id = t.route where t.id = p_train;
    if not found or not (tr.own_u is not distinct from pa.pu and tr.own_c is not distinct from pa.pc) or pa.gv is distinct from (tr.own_u is null and tr.own_c is null) then
      raise exception 'この名義の列車ではありません（名義を切りかえてください）';
    end if;
    if p_day is null or p_day < today - 1 or p_day > today + 1 then raise exception '運休にできるのは、きのう・きょう・あしたの列車です'; end if;
    if tr.day is not null and tr.day <> p_day then raise exception 'この臨時列車は、その日は走りません'; end if;
    if exists (select 1 from mp_cxl where train = p_train and day = p_day) then raise exception 'もう運休にしています'; end if;
    insert into mp_cxl(train, day, route, unko, own_u, own_c, by_u) values (p_train, p_day, tr.route, p_unko, pa.pu, pa.pc, u) returning id into cid;
  else
    select * into f from mp_forms where id = p_form;
    if not found or not (f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc) or pa.gv is distinct from (f.own_u is null and f.own_c is null) then
      raise exception 'この名義の編成ではありません（名義を切りかえてください）';
    end if;
    if p_hours is null and p_unko is null then raise exception '何時間か、えらんでください'; end if;
    if p_hours is not null and (p_hours < 0.25 or p_hours > 48) then raise exception '15分〜48時間にしてください'; end if;
    if p_hours is null and z.st = 'done' then raise exception 'この乱れは、もうおわっています'; end if;
    t1 := case when p_hours is not null then now() + make_interval(secs => round(p_hours * 3600)::int) end;
    if exists (select 1 from mp_cxl c left join mp_unko x on x.id = c.unko where c.form = p_form
                and coalesce(c.t1, case when x.st = 'done' then greatest(x.t_end, x.t0 + make_interval(secs => x.dur)) end, 'infinity'::timestamptz) > now()) then
      raise exception 'この編成は、もう運休にしています（やめてから、もう一度）';
    end if;
    insert into mp_cxl(form, t0, t1, unko, own_u, own_c, by_u) values (p_form, now(), t1, case when p_hours is null then p_unko end, pa.pu, pa.pc, u) returning id into cid;
  end if;
  return jsonb_build_object('id', cid);
end $$;
create or replace function public.mp_cxl_del(p_id bigint, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; c mp_cxl;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into c from mp_cxl where id = p_id for update;
  if not found or not (c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc) or pa.gv is distinct from (c.own_u is null and c.own_c is null) then
    raise exception '運休が見つかりません（名義を切りかえてください）';
  end if;
  if c.ordk is not null then raise exception 'ダイヤの運転整理で決めた運休です（系統のダイヤの「運転整理」で消してください）'; end if;   -- DB の更新100
  if c.form is not null then update mp_cxl set t1 = now(), unko = null where id = p_id;
  else delete from mp_cxl where id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.mp_train_save(p_id bigint, p_route bigint, p_dir int, p_num text, p_kind text, p_dep int, p_form bigint, p_tt jsonb, p_skip bigint[], p_as text,
                                                p_op bigint default null, p_day date default null, p_cpl jsonb default null, p_sa bigint default null, p_sb bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; tid bigint; f mp_forms; tt_ jsonb := '{}'::jsonb; k text; v jsonb; n int; o mp_ops; oid_ bigint; fid bigint;
        cpl_ jsonb; e jsonb; co mp_ops; ns int; ia int; ib int; ka int; kb int; sa_ bigint; sb_ bigint; k0 int; k1 int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_dep < 0 or p_dep >= 86400 then raise exception '時刻がちがいます'; end if;
  if trim(coalesce(p_num, '')) = '' then raise exception '列車番号をつけてください'; end if;
  perform _mp_day_ok(p_day);
  -- 運転整理（DB の更新100）：運転整理の列車は 走る日を変えない。日をきめた運転整理のある毎日の列車は、臨時列車にしない
  if p_id is not null then
    if exists (select 1 from mp_trains x where x.id = p_id and x.orig is not null and x.day is distinct from p_day) then raise exception '運転整理の列車は、走る日を変えられません（運転整理を消してから、もう一度）'; end if;
    if p_day is not null and exists (select 1 from mp_trains x where x.orig = p_id) then raise exception 'この列車には、日をきめた運転整理があります（臨時列車にするなら、先に運転整理を消してください）'; end if;
  end if;
  if p_op is not null then
    select * into o from mp_ops where id = p_op and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    if not found then raise exception '運用が見つかりません'; end if;
    if o.kind <> r.kind then raise exception '%', case when r.kind = 'rail' then 'バスの運用は、鉄道の系統には入れられません' else '鉄道の運用は、バスの系統には入れられません' end; end if;
    oid_ := o.id; fid := o.form;
  elsif p_form is not null then
    select * into f from mp_forms where id = p_form and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
    if not found then raise exception '編成が見つかりません'; end if;
    if (_mp_form_perf(p_form) ->> 'rail')::boolean <> (r.kind = 'rail') then raise exception '%', case when r.kind = 'rail' then '鉄道の系統にはバスを使えません' else 'バスの系統には電車を使えません' end; end if;
    oid_ := _mp_op_of_form(p_form); fid := p_form;
  end if;
  -- 連結：同じ名義の鉄道の運用（この列車の運用とはちがう）。つなぐ駅は切りはなす駅より前（走る順）
  if p_cpl is not null then
    if jsonb_typeof(p_cpl) <> 'array' then raise exception '連結の形がちがいます'; end if;
    if jsonb_array_length(p_cpl) > 0 and r.kind <> 'rail' then raise exception 'バスは連結できません'; end if;
    if jsonb_array_length(p_cpl) > 3 then raise exception '連結できるのは3つの運用までです'; end if;
    cpl_ := '[]'::jsonb; ns := array_length(r.stops, 1);
    for e in select x from jsonb_array_elements(p_cpl) x loop
      co := null;
      select * into co from mp_ops where id = (e ->> 'op')::bigint and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc and kind = 'rail';
      if co.id is null then raise exception '連結する運用が見つかりません'; end if;
      if co.id = oid_ then raise exception '連結する運用が、この列車の運用と同じです'; end if;
      if cpl_ @> jsonb_build_array(jsonb_build_object('op', co.id)) then raise exception '同じ運用を2回は連結できません'; end if;
      ia := case when e ->> 'a' is not null then _mp_rpos(r.stops, case when p_dir = -1 then -1 else 1 end, (e ->> 'a')::bigint, false) end;   -- 環状線：つなぐ駅は前・切りはなす駅はうしろのほう
      ib := case when e ->> 'b' is not null then _mp_rpos(r.stops, case when p_dir = -1 then -1 else 1 end, (e ->> 'b')::bigint, true) end;
      if (e ->> 'a' is not null and ia is null) or (e ->> 'b' is not null and ib is null) then raise exception '連結する駅がこの系統にありません'; end if;
      ka := case when ia is null then 1 when p_dir = -1 then ns - ia + 1 else ia end;
      kb := case when ib is null then ns when p_dir = -1 then ns - ib + 1 else ib end;
      if ka >= kb then raise exception '連結する駅は、切りはなす駅より前にしてください'; end if;
      cpl_ := cpl_ || jsonb_build_array(jsonb_build_object('op', co.id, 'a', case when ka > 1 then (e ->> 'a')::bigint end, 'b', case when kb < ns then (e ->> 'b')::bigint end));
    end loop;
  end if;
  -- 途中始発・途中止まり（2026-10-28）：走る順で 始発駅 → 終着駅。系統の端なら null
  ns := array_length(r.stops, 1);
  if (p_sa is not null and not (p_sa = any(r.stops))) or (p_sb is not null and not (p_sb = any(r.stops))) then raise exception '始発駅・終着駅がこの系統にありません'; end if;
  k0 := coalesce(_mp_kpos(r.stops, case when p_dir = -1 then -1 else 1 end, p_sa, false), 1);   -- 環状線：はじめの駅は、始発なら前・終着ならうしろ（どちらも系統の端）
  k1 := coalesce(_mp_kpos(r.stops, case when p_dir = -1 then -1 else 1 end, p_sb, true), ns);
  if k0 >= k1 then raise exception '始発駅は、終着駅より前（走る順）にしてください'; end if;
  sa_ := case when k0 > 1 then p_sa end; sb_ := case when k1 < ns then p_sb end;
  -- 指定は採時駅だけ
  for k, v in select * from jsonb_each(coalesce(p_tt, '{}'::jsonb)) loop
    if not (k::bigint = any(r.timing)) then continue; end if;
    tt_ := tt_ || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object('a', (v ->> 'a')::int, 'd', (v ->> 'd')::int, 't', (v ->> 't')::int)));
  end loop;
  select count(*) into n from mp_trains where route = p_route;
  if p_id is null and n >= 900 then raise exception '1つの系統の列車は900本までです'; end if;
  if p_id is not null and not exists (select 1 from mp_trains where id = p_id and route = p_route) then raise exception '列車が見つかりません'; end if;
  perform _mp_dia_snap(p_route, format(case when p_id is null then '列車 %s を足した' else '列車 %s を直した' end, left(trim(p_num), 12)));
  if p_id is null then
    insert into mp_trains(route, dir, num, kind, dep, form, op, day, tt, skip, cpl, sa, sb)
    values (p_route, case when p_dir = -1 then -1 else 1 end, left(trim(p_num), 12), left(coalesce(nullif(trim(p_kind), ''), '普通'), 8), p_dep, fid, oid_, p_day, tt_,
            coalesce(array(select x from unnest(p_skip) x where x = any(r.stops)), '{}'), coalesce(cpl_, '[]'::jsonb), sa_, sb_)
    returning id into tid;
  else
    update mp_trains set dir = case when p_dir = -1 then -1 else 1 end, num = left(trim(p_num), 12), kind = left(coalesce(nullif(trim(p_kind), ''), '普通'), 8),
           dep = p_dep, form = fid, op = oid_, day = p_day, tt = tt_, skip = coalesce(array(select x from unnest(p_skip) x where x = any(r.stops)), '{}'), sa = sa_, sb = sb_,
           cpl = case when cpl_ is null then (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(cpl) c where (c ->> 'op')::bigint is distinct from oid_) else cpl_ end
     where id = p_id and route = p_route returning id into tid;
    if tid is null then raise exception '列車が見つかりません'; end if;
  end if;
  perform _mp_resched(p_route);
  return (select jsonb_build_object('id', t.id, 'sched', t.sched, 'warn', t.warn, 'cplx', t.cplx) from mp_trains t where t.id = tid);
end $$;
create or replace function public.mp_dia_fix(p_route bigint, p_mode text, p_as text, p_dry boolean, p_cont boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; np int := 0; c record; nt int := 0; nd int := 0; dsum int := 0; n0 int; n1 int; b0 int; b1 int;
        done bigint[]; tr mp_trains; free int; idx int; pv jsonb; pdep int; delta int; changed boolean; dn text; mx int;
        kc int; bc int; k1 int; bb1 int; pt int; pd int; ps int; t0 timestamptz := clock_timestamp(); more boolean := false;
        ts timestamptz; rs interval; lp interval; cut boolean;
        soft interval := make_interval(secs => coalesce(nullif(current_setting('kz.dia_fix_soft', true), '')::float8, 20));   -- 目安（ためすときだけ変えられる）
        hard interval := make_interval(secs => coalesce(nullif(current_setting('kz.dia_fix_hard', true), '')::float8, 40));   -- 上限
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  if p_mode is null or p_mode not in ('trk', 'time', 'both') then raise exception '直し方をえらんでください'; end if;
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  create temp table if not exists _mp_dfx (id bigint, route bigint, dir int, day date, sta text, trk int, ta int, td int, pr int) on commit drop;
  create index if not exists _mp_dfx_st on _mp_dfx (sta, trk, ta);
  begin
    -- まず、いまの時刻で重なりを数えなおす（ほかの系統が、あとから変わっていることがある）。つづき（p_cont）は、前の呼び出しのさいごに組みなおしているので しない
    if not coalesce(p_cont, false) then
      ts := clock_timestamp(); perform _mp_resched(p_route); rs := clock_timestamp() - ts;
    end if;
    -- 重なっている列車の数・重なりの数（注意書きの数）・走れない列車の数
    select count(*) filter (where warn ~ 'とかさなります'), coalesce(sum((length(warn) - length(replace(warn, 'とかさなります', ''))) / 7), 0), count(*) filter (where bad)
      into n0, kc, b0 from mp_trains where route = p_route;
    bc := b0; n1 := n0; b1 := b0;
    if n0 > 0 and not p_dry and not coalesce(p_cont, false) then perform _mp_dia_snap(p_route, '重なりを直した'); end if;
    for pass in 1..(case when n0 > 0 then 10 else 0 end) loop
     -- 時間（DB の更新69）：この呼び出しで1回でも直したら、つぎの回（直す＋組みなおし）が目安をこえるときはしない。
     --   まだ1回も直していなくても、組みなおしの時間がのこっていなければしない（はじめの組みなおしが長い系統：つぎの呼び出しで直す）
     if np > 0 then
       if clock_timestamp() - t0 + coalesce(rs, interval '0') + coalesce(lp, interval '0') > soft then more := true; exit; end if;
     elsif clock_timestamp() - t0 + coalesce(rs, hard / 2) + interval '3 seconds' > hard then more := true; exit;
     end if;
     begin
      changed := false; done := '{}'; pt := 0; pd := 0; ps := 0; cut := false; ts := clock_timestamp();
      -- 駅ごとの発着（関係する系統の列車ぜんぶ）。駅・番線・着く時刻の索引で、近い時刻の列車だけを見る（mx：いちばん長い停車）
      truncate _mp_dfx;
      insert into _mp_dfx
      select t.id, t.route, t.dir, t.day, s.v ->> 0, (s.v ->> 3)::int, coalesce((s.v ->> 1)::int, (s.v ->> 2)::int), coalesce((s.v ->> 2)::int, (s.v ->> 1)::int),
             _mp_kprio(ro.own_u, ro.own_c, t.kind)
        from mp_trains t join mp_routes ro on ro.id = t.route cross join lateral jsonb_array_elements(t.sched) s(v)
       where ro.stops && r.stops and s.v ->> 0 is not null and s.v ->> 3 is not null;
      analyze _mp_dfx;
      mx := coalesce((select max(abs(td - ta)) from _mp_dfx), 0);
      for c in
        select a.id y, a.dir ydir, a.day yday, a.sta, a.trk, a.ta yta, a.td ytd, b.td otd
          from _mp_dfx a join _mp_dfx b on b.sta = a.sta and b.trk = a.trk and b.ta < a.td + 60 and b.ta > a.ta - 60 - mx and b.id <> a.id
         where a.route = p_route
           and (a.day is null or b.day is null or a.day = b.day)
           and not (coalesce(a.day, b.day) is not null and exists (select 1 from mp_cxl zc where zc.ordk is not null and zc.day = coalesce(a.day, b.day) and zc.train in (a.id, b.id)))   -- その日は走らない列車（運転整理。DB の更新100）
           and a.ta - 30 < b.td + 30 and b.ta - 30 < a.td + 30
           and (b.route <> p_route or a.pr > b.pr or (a.pr = b.pr and (a.ta > b.ta or (a.ta = b.ta and a.id > b.id))))
         order by a.ta, a.id
      loop
        if c.y = any(done) then continue; end if;
        -- 組みなおしの時間をのこして、上限までに切りあげる（のこりは つぎの回で）
        if clock_timestamp() - t0 + coalesce(rs, hard / 2) > hard then cut := true; exit; end if;
        done := done || c.y;
        free := null;
        -- 空いている番線（その向きで使える番線。本線から・番号の小さい順）
        if p_mode in ('trk', 'both') then
          dn := case when c.ydir = -1 then 'up' else 'down' end;
          select e.k into free from mp_stations s2, jsonb_array_elements(_mp_sta_trk(s2)) with ordinality e(v, k)
           where s2.id = c.sta::bigint and e.v ->> 'd' in (dn, 'both') and e.k <> c.trk
             and not exists (select 1 from _mp_dfx z where z.sta = c.sta and z.trk = e.k and z.ta < c.ytd + 60 and z.ta > c.yta - 60 - mx and z.id <> c.y
                                                      and (c.yday is null or z.day is null or z.day = c.yday) and c.yta - 30 < z.td + 30
                                                      and not (coalesce(c.yday, z.day) is not null and exists (select 1 from mp_cxl zc where zc.ordk is not null and zc.day = coalesce(c.yday, z.day) and zc.train in (c.y, z.id))))
           order by (e.v ->> 'm' = 'main') desc, e.k limit 1;
          if free is not null then
            update mp_trains set tt = coalesce(tt, '{}'::jsonb) || jsonb_build_object(c.sta, coalesce(tt -> c.sta, '{}'::jsonb) || jsonb_build_object('t', free)) where id = c.y;
            update _mp_dfx set trk = free where id = c.y and sta = c.sta and ta = c.yta;
            pt := pt + 1; changed := true; continue;
          end if;
        end if;
        -- 前の駅で待つ：相手が出て1分（30秒＋30秒）たってから着くように
        if p_mode in ('time', 'both') then
          delta := greatest(1, c.otd + 60 - c.yta);
          if delta > 900 then continue; end if;
          select * into tr from mp_trains where id = c.y;
          select (z.o - 1)::int into idx from jsonb_array_elements(tr.sched) with ordinality z(v, o)
           where z.v ->> 0 = c.sta and coalesce((z.v ->> 1)::int, (z.v ->> 2)::int) = c.yta limit 1;
          if idx is null then continue; end if;
          if idx = 0 then
            if tr.dep + delta >= 86400 then continue; end if;
            update mp_trains set dep = dep + delta where id = c.y;
          else
            pv := tr.sched -> (idx - 1);
            if pv ->> 2 is null then continue; end if;
            pdep := (pv ->> 2)::int - coalesce((tr.hold ->> (pv ->> 0))::int, 0) + delta;
            update mp_trains set tt = coalesce(tt, '{}'::jsonb) || jsonb_build_object(pv ->> 0, coalesce(tt -> (pv ->> 0), '{}'::jsonb) || jsonb_build_object('d', pdep)) where id = c.y;
          end if;
          pd := pd + 1; ps := ps + delta; changed := true;
        end if;
      end loop;
      if not changed then
        if cut then more := true; end if;   -- 時間切れで何も直せなかった：つぎの呼び出しで
        raise exception 'mp_dia_fix_stop';
      end if;
      lp := clock_timestamp() - ts;
      ts := clock_timestamp(); perform _mp_resched(p_route); rs := clock_timestamp() - ts;
      select coalesce(sum((length(warn) - length(replace(warn, 'とかさなります', ''))) / 7), 0), count(*) filter (where bad) into k1, bb1 from mp_trains where route = p_route;
      if k1 >= kc or bb1 > bc then more := false; raise exception 'mp_dia_fix_stop'; end if;   -- よくならない回は取り消して終わる
      kc := k1; bc := bb1; np := np + 1; nt := nt + pt; nd := nd + pd; dsum := dsum + ps;
      if cut then more := true; exit; end if;   -- とちゅうで切りあげた：のこりは つぎの呼び出しで
     exception when raise_exception then
      if sqlerrm <> 'mp_dia_fix_stop' then raise; end if;
      exit;
     end;
    end loop;
    select count(*) filter (where warn ~ 'とかさなります'), count(*) filter (where bad) into n1, b1 from mp_trains where route = p_route;
    if p_dry then raise exception 'mp_dia_fix_dry'; end if;   -- 見つもり：ここまでの変更を取り消す（数はのこる）
  exception when raise_exception then
    if sqlerrm <> 'mp_dia_fix_dry' then raise; end if;
  end;
  if not p_dry and (np > 0 or not coalesce(p_cont, false)) then perform _mp_chg('route', p_route, 'set', null); end if;
  return jsonb_build_object('before', n0, 'after', n1, 'trk', nt, 'time', nd, 'delay', dsum, 'bad0', b0, 'bad1', b1, 'passes', np, 'more', more and n1 > 0,
                            'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end $$;
create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour'); nwk int; ev jsonb; nrun int; ran jsonb := '{}'::jsonb; rfid bigint; nsub int; orf real; sb2 bigint;
        xg real; xa real; xb real; xrm real; xdin int; xlng int; xbag real; xfee real; xmeal real; xbagr real; xug real; xus real; xua real; xub real; xur real;
        xnight boolean := ((hh + 23) % 24) >= 18 or ((hh + 23) % 24) <= 2;   -- この1時間に始発を出る列車は夜行（18時〜2時台）
        lfd boolean[]; rsh jsonb; sube jsonb := '{}'::jsonb; sk text; sf real; sbx record; ld int;   -- 変電所（DB の更新89）
        trk jsonb := '{}'::jsonb; xkb real;   -- 競馬場のお客（DB の更新92）
        lgm int[];   -- 走れる軌間（DB の更新99）
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  -- 競馬場（DB の更新92）：この1時間のレースの来場者が、近くの駅・バス停で乗り降りする（系統ごと）。うまくいかなくても、ふだんどおり
  begin trk := _mp_track_riders(h); exception when others then trk := '{}'::jsonb; raise warning 'mp track riders: %', sqlerrm; end;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
    lgm := case when r.kind = 'rail' then _mp_leg_gm(r.legs) end;   -- 軌間（DB の更新99）
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0)
                 and not exists (select 1 from mp_cxl zc where zc.train = t.id and zc.day = d0 and zc.ordk = 'v') loop   -- その日は運転整理の列車が かわりに走る（運休とは数えない。DB の更新100）
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null then continue; end if;
      dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      -- 編成の工事中（検査・改造・転属・納車）にかかる列車は運休：始発駅を出てから終点に着くまでのどこかが、工事の時間にかかるもの（DB の更新60）
      --   予備編成（DB の更新80）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走。予定は mp_subst）
      rfid := tr.fid;
      if _mp_form_busy(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) then
        begin rfid := _mp_subst_ok(tr.id, d0, tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)); exception when others then rfid := null; end;
        if rfid is not null then perf := _mp_form_perf(rfid); end if;
        if rfid is null or perf is null then nwk := nwk + 1; continue; end if;
        nsub := nsub + 1;
      end if;
      -- 持ち主が運休にした列車（1本ずつ・編成ごと。DB の更新60）
      begin if _mp_cxl_on(tr.id, d0, tr.fid, dep_abs) then ncan := ncan + 1; continue; end if; exception when others then null; end;
      -- 走る区間（途中始発・途中止まり。2026-10-28）：系統のうちの何割を走るか（cf）。本数・定員はその割合で数える
      cf := 1; ia := 1; ib := coalesce(array_length(r.stops, 1), 1);
      if tr.sa is not null or tr.sb is not null then
        ia := _mp_rpos(r.stops, tr.dir, (tr.sched -> 0 ->> 0)::bigint, false); ib := _mp_rpos(r.stops, tr.dir, (tr.sched -> (jsonb_array_length(tr.sched) - 1) ->> 0)::bigint, true);   -- 環状線
        if ia is not null and ib is not null and km > 0 then
          cf := greatest(0.05, least(1, coalesce((select sum((l.v ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality l(v, lo) where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib)), 0) / 1000 / km));
        else ia := 1; ib := coalesce(array_length(r.stops, 1), 1); end if;
      end if;
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
            where l.lo >= least(ia, ib) and l.lo < greatest(ia, ib) and not (l.v ->> 'e')::boolean) then continue; end if;
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and (select coalesce(bit_or(x.m), 0) from unnest(_mp_leg_pm(r.legs)) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) & ~coalesce((perf ->> 'ps')::int, 1) <> 0 then continue; end if;   -- 電化方式がちがう区間は走れない（DB の更新87）
      if r.kind = 'rail' and lgm is not null and coalesce((perf ->> 'gm')::int, 2) & ~(select coalesce(bit_and(x.m), 15) from unnest(lgm) with ordinality x(m, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib)) <> 0 then continue; end if;   -- 軌間のちがう区間は走れない（DB の更新99）
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from unnest(lfd) with ordinality x(f, lo)
            where x.lo >= least(ia, ib) and x.lo < greatest(ia, ib) and not x.f) then continue; end if;   -- 変電所から遠く、電気が来ていない区間は走れない（DB の更新89）
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
      end if;
      -- 変電所の負荷（DB の更新89）：電車・電気機関車は、走る区間の変電所に 出力 × 0.45 × 走る時間（1時間まで）× 長さの割合
      if r.kind = 'rail' and (perf ->> 'elec')::boolean and rsh is not null then
        for sk, sf in select key, value::real from jsonb_each_text(rsh) loop
          sube := sube || jsonb_build_object(sk, coalesce((sube ->> sk)::real, 0) + coalesce((perf ->> 'kw')::real, 0) * 0.45 * least(rt, 3600) * sf * cf);
        end loop;
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        -- 予備編成（DB の更新82）：同じ車庫・同じ形式と両数の予備編成があれば、かわりに走る（代走）
        sb2 := case when rfid = tr.fid then _mp_subst_pick(tr.fid, to_timestamp(dep_abs), to_timestamp(dep_abs + rt)) end;
        if sb2 is null then
          broke := broke + 1;
          update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
          continue;
        end if;
        insert into mp_subst(train, day, orig, sub, own_u, own_c, t0, t1)
          select tr.id, d0, tr.fid, sb2, f.own_u, f.own_c, to_timestamp(dep_abs), to_timestamp(dep_abs + rt) from mp_forms f where f.id = tr.fid
        on conflict (train, day) do update set orig = excluded.orig, sub = excluded.sub, t0 = excluded.t0, t1 = excluded.t1, made_at = now();
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''),
                                    format('故障のため予備編成「%s」が代走（%s）', (select name from mp_forms where id = sb2), to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        rfid := sb2; perf := _mp_form_perf(sb2); nsub := nsub + 1;
        if perf is null then broke := broke + 1; continue; end if;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）。区間折り返しは走った分だけ（DB の更新82）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800) * coalesce(orf, 1);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = rfid;   -- 代走なら予備編成がいたむ（DB の更新80）
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or _mp_form_busy((ce ->> 'f')::bigint, to_timestamp(dep_abs + coalesce((ce ->> 'ta')::int - tr.dep, 0)), to_timestamp(dep_abs + coalesce((ce ->> 'tb')::int - tr.dep, rt))) then continue; end if;   -- 工事中の編成はつながない（DB の更新60）
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if ev is not null then dsum := dsum + coalesce((ev ->> 'dly')::float8, 0); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      nrun := nrun + 1;   -- 走った列車（回送・試運転もふくむ。乗り入れの線路使用料。DB の更新60）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
      -- 料金の席と設備（DB の更新72）：グリーン席、夜行の寝台と個室、食堂車・ラウンジ・展望車、荷物車・郵便車（走る km）
      xg := xg + coalesce((perf ->> 'g')::real, 0) * cf;
      if xnight then xa := xa + coalesce((perf ->> 'a')::real, 0) * cf; xb := xb + coalesce((perf ->> 'b')::real, 0) * cf; xrm := xrm + coalesce((perf ->> 'rooms')::real, 0) * cf; end if;
      xdin := xdin + case when (perf ->> 'din')::boolean then 1 else 0 end;
      xlng := xlng + case when (perf ->> 'lng')::boolean or (perf ->> 'obs')::boolean then 1 else 0 end;
      xbag := xbag + coalesce((perf ->> 'bag')::real, 0) * km * cf;
    end loop;
    ran := ran || jsonb_build_object(r.id::text, nrun);
    -- 運休した列車のお客（きのうの同じ時間のお客 × 運休の割合）：振替輸送をたのんでいれば、近くのほかの線へ（精算）
    lost := 0;
    if ncan > 0 then
      lost := coalesce((select x.served from mp_hours x where x.route = r.id and x.hour = date_trunc('hour', h) - interval '1 day'), 0)::real * ncan / (ncan + nok);
      if lost >= 1 and exists (select 1 from mp_unko z where z.furi @> array[r.id] and z.t0 < h and coalesce(z.t_end, now()) > h - interval '1 hour') then
        begin
          perform _mp_unko_furi_pay(r, lost, case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * greatest(1.5, least(15, km * 0.45)) else 0 end);
        exception when others then raise warning 'mp unko furi: %', sqlerrm; end;
      end if;
    end if;
    if nok = 0 then
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'shop', nwk, 'trust', round(r.trust::numeric, 2)) where id = r.id;
      continue;
    end if;
    -- 乗りたい人（この1時間）
    pop := coalesce((select sum(v::text::real) from jsonb_each(catch) e(k, v)), 0);
    -- ほかの系統とのとりあい：駅のまわりに止まる、ほかの系統の本数
    share := coalesce((select avg(1.0 / (1 + coalesce((select count(*) from mp_routes r2 join mp_stations s2 on s2.id = any(r2.stops)
                         where r2.id <> r.id and r2.ok and r2.kind = r.kind and abs(s2.x - s.x) < 1200 and abs(s2.y - s.y) < 1200), 0) * 0.5))
                       from mp_stations s where s.id = any(r.stops)), 1);
    spd := case when secs > 0 then km / greatest(secs / nok / 3600.0, 0.01) else 30 end;
    q := least(1.5, greatest(0.5, spd / 30.0));
    if r.kind = 'ship' then q := case when spd > 40 then 1.3 else 1 end; end if;   -- 船：島へは船しかないので遅くても減らない（高速船は少しふえる。t54o）
    if r.kind = 'air' then q := least(1.0, greatest(0.2, km / 60)); end if;   -- 飛行機：近いところへは鉄道・バスで行く人が多い（60km より短いと減る。t54p）
    comf := 1;
    if mo in (6, 7, 8, 9) then comf := comf * (0.8 + 0.2 * acn / nok); end if;
    if mo in (12, 1, 2) then comf := comf * (0.8 + 0.2 * htn / nok); end if;
    if km > 30 then comf := comf * (0.9 + 0.1 * toil / nok); end if;
    if km > 50 then comf := comf * (1 + 0.05 * xdin / nok + 0.05 * xlng / nok); end if;   -- 食堂車・ラウンジ・展望車のある列車は、長い系統で少し人気（DB の更新72）
    dem := pop * _mp_rate(case r.kind when 'rail' then 'g_rail' when 'ship' then 'g_ship' when 'air' then 'g_air' else 'g_bus' end) * _mp_hourf(hh) * q * comf * share;
    -- 運行の乱れ：遅れが大きいほど お客がへる（平均 10分で 1割・いちばん 3割）。信頼（0.7〜1）もかける
    dem := dem * coalesce(r.trust, 1) * (1 - least(0.3, dsum / greatest(nd, 1) / 60 / 100));
    xkb := coalesce((trk ->> r.id::text)::real, 0) * least(1.2, greatest(0.7, q));   -- 競馬場のお客（DB の更新92）：遅い線は少し へる
    dem := dem + xkb;
    if r.kind = 'air' then   -- 飛行機：本数が少なくても予約して乗る・座席の数まで（立って乗れない。t54p）
      dem1 := dem / 2 * tph1::real / (tph1 + 0.5); dem2 := dem / 2 * tph2::real / (tph2 + 0.5);
      served := floor(least(dem1, cap1) + least(dem2, cap2));
    else
      dem1 := dem / 2 * tph1::real / (tph1 + 3); dem2 := dem / 2 * tph2::real / (tph2 + 3);
      served := floor(least(dem1, cap1 * 1.5 * 2) + least(dem2, cap2 * 1.5 * 2));
    end if;
    trip := case when r.kind = 'ship' then greatest(1.5, km * 0.85) when r.kind = 'air' then km else greatest(1.5, least(15, km * 0.45)) end;   -- 船はほとんどの人が向こう岸まで（t54o）・飛行機は終点まで
    fare := case when r.kind = 'rail' then _mp_rate('fare_base') + _mp_rate('fare_km') * trip
                 when r.kind = 'ship' then _mp_rate('ship_fare') + _mp_rate('ship_km') * trip
                 when r.kind = 'air' then _mp_rate('air_fare') + _mp_rate('air_km') * trip
                 else _mp_rate('bus_fare') + _mp_rate('bus_km') * greatest(0, trip - 3) end;
    -- 料金（DB の更新72）：グリーン席は乗る人の8%まで（席は1時間に2回転）。寝台は長い系統の夜行だけ（80km をこえるとふえ、680km で4割）。
    --   寝台に乗りたい人の3割は A寝台、のこりは B寝台。個室はそのうち（A の半分・B の2割。1室ごと）。料金は運賃の グリーン1倍・B寝台3倍・A寝台6倍・個室3倍（mp_rates で変えられる）
    --   食堂車：乗る人の5%が食事（1人 600 X）。荷物車・郵便車：1両 1km ごとに 120 X
    xfee := 0; xmeal := 0; xbagr := 0;
    if r.kind = 'rail' then
      xug := least(served * 0.08, xg * 2);
      xus := served * least(0.4, greatest(0, (km - 80) / 600.0));
      xua := least(xus * 0.3, xa); xub := least(xus - xua, xb); xur := least(xrm, xua * 0.5 + xub * 0.2);
      xfee := fare * (xug * coalesce(_mp_rate('fee_g'), 1) + xub * coalesce(_mp_rate('fee_b'), 3) + xua * coalesce(_mp_rate('fee_a'), 6) + xur * coalesce(_mp_rate('fee_room'), 3));
      if xdin > 0 and km > 30 then xmeal := served * 0.05 * xdin / nok * coalesce(_mp_rate('meal'), 600); end if;
      xbagr := xbag * coalesce(_mp_rate('bag_km'), 120);
    end if;
    rev := floor(served * fare + xfee + xmeal + xbagr);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'shop', nwk, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0), 'kb', nullif(round(case when dem > 0 then served * xkb / dem else 0 end), 0)));   -- kb：競馬場のお客（DB の更新92）   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 変電所（DB の更新89）：この1時間の負荷（平均 × 1.6 を いちばん多いときとみる）。容量をこえたら電圧の低下、1.5倍をこえたら停止（3時間に1回まで）
  for sbx in select vs.* from mp_subs vs loop
    ld := round(coalesce((sube ->> sbx.id::text)::real, 0) / 3600 * 1.6);
    update mp_subs set load = ld where id = sbx.id;
    if ld > sbx.cap and (sbx.ev_at is null or sbx.ev_at < h - interval '3 hours') and (sbx.trip is null or sbx.trip < now()) then
      begin perform _mp_sub_event(sbx.id, ld); exception when others then raise warning 'mp sub event: %', sqlerrm; end;
    end if;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when kind = 'rail' then _mp_trk_upk(gauge, g2, slp, elec, cat) else 1 end + case when kind = 'rail' then len * _mp_nw_upk(nw) else 0 end a, '線路・道路' k   -- 規格（DB の更新99）
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
      union all select own_u, own_c, upk, '変電所' from mp_subs where not gov   -- 変電所（DB の更新89）
      union all select p.own_u, p.own_c, (_mp_attr_kinds() -> a.kind ->> 'upk')::numeric, 'アトラクション' from mp_attrs a join mp_blds b on b.id = a.bld join mp_parcels p on p.id = b.parcel where not p.gov   -- DB の更新91
    ) z where pu is not null or pc is not null group by pu, pc   -- 国のもの（国の空港。t54q）は国庫から国庫なので、なし
  loop
    amt := round(o.amt / 24.0);
    if amt > 0 then perform _mp_soft_pay(o.pu, o.pc, false, amt, 'upkeep', format('維持費（%s）', o.ks)); end if;
  end loop;
  -- 使用料：払う人 → 区画の筆の持ち主（筆がなければ国庫）。自分の筆になっていればなし。同じ人の同じ区画は1回（線路と駅のホームが重なるところなど）
  for o in select e.pay_u, e.pay_c, sum(e.fee) fee, p.own_u lu, p.own_c lc
             from (select distinct on (l.x, l.y, l.pay_u, l.pay_c) l.x, l.y, l.pay_u, l.pay_c, l.fee from mp_leases l where not l.pay_gov order by l.x, l.y, l.pay_u, l.pay_c, l.fee desc) e
             left join mp_pcells pc on pc.x = e.x and pc.y = e.y left join mp_parcels p on p.id = pc.parcel
            where p.id is null or not _mp_same(p.own_u, p.own_c, false, e.pay_u, e.pay_c, false)
            group by e.pay_u, e.pay_c, p.own_u, p.own_c loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', '土地の使用料');
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', '土地の使用料（受けとり）');
    end if;
  end loop;
  -- 他社のバス停の使用料（1系統・1日）：系統の持ち主 → バス停の持ち主
  for o in select ro.own_u pay_u, ro.own_c pay_c, sx.own_u lu, sx.own_c lc, sx.kind sk, sum(x.fee) fee
             from mp_stopuse x join mp_routes ro on ro.id = x.route join mp_stations sx on sx.id = x.stop
            where x.fee > 0 and not _mp_same(sx.own_u, sx.own_c, false, ro.own_u, ro.own_c, false)
            group by ro.own_u, ro.own_c, sx.own_u, sx.own_c, sx.kind loop
    amt := round(o.fee / 24.0);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.pay_u, o.pay_c, false, amt, 'lease', case when o.sk = 'ship' then '港の使用料' when o.sk = 'air' then '空港の使用料' else 'バス停の使用料' end);
    if amt > 0 and (o.lu is not null or o.lc is not null) then
      perform _mp_earn(o.lu, o.lc, false, amt, 'lease_in', case when o.sk = 'ship' then '港の使用料（受けとり）' when o.sk = 'air' then '空港の使用料（受けとり）' else 'バス停の使用料（受けとり）' end);
    end if;
  end loop;
  -- 乗り入れの線路使用料（t54j）：この1時間に始発を出た列車（回送・試運転もふくむ）× 持ち主の線路の km × 1列車・1km の使用料。系統の持ち主 → 線路の持ち主
  for o in
    select ro.own_u gu, ro.own_c gc, hk.hu, hk.hc, sum(cnt.n * hk.km * th.fee) amt, sum(cnt.n) n, sum(cnt.n * hk.km) km
      from mp_routes ro
      join lateral (select coalesce((ran ->> ro.id::text)::int, 0) n) cnt on cnt.n > 0   -- ほんとうに走った列車だけ（運休・工事中・故障はのぞく。DB の更新60）
      join lateral (select s.own_u hu, s.own_c hc, sum(abs((g ->> 2)::real - (g ->> 1)::real) * 50 / 1000.0) km
                      from jsonb_array_elements(ro.legs) l, jsonb_array_elements(l -> 'g') g join mp_segs s on s.id = (g ->> 0)::bigint
                     where not (s.own_u is not distinct from ro.own_u and s.own_c is not distinct from ro.own_c) and not s.gov
                     group by s.own_u, s.own_c) hk on true
      join mp_thru th on th.st = 'ok' and th.fee > 0 and th.hu is not distinct from hk.hu and th.hc is not distinct from hk.hc
                     and th.gu is not distinct from ro.own_u and th.gc is not distinct from ro.own_c
     where ro.ok and ro.kind = 'rail'
     group by ro.own_u, ro.own_c, hk.hu, hk.hc
  loop
    amt := round(o.amt);
    if amt <= 0 then continue; end if;
    amt := _mp_soft_pay(o.gu, o.gc, false, amt, 'lease', format('線路使用料（乗り入れ・%s本・%skm）', o.n, round(o.km::numeric, 1)));
    if amt > 0 then perform _mp_earn(o.hu, o.hc, false, amt, 'lease_in', format('線路使用料（乗り入れの受けとり・%s本）', o.n)); end if;
  end loop;
  -- 建物：町の人の出入り・家賃・テナントの家賃・店などの売上
  perform _mp_bld_tick_hour(h);
  -- 学校・工場・物流（t54k）。うまくいかなくても、ほかの1時間の分はそのまま
  begin perform _mp_sc_tick_hour(h); exception when others then raise warning 'mp sc: %', sqlerrm; end;
end $$;
create or replace function public._mp_ferry_links(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare t0 int := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date;
begin
  drop table if exists _fl;
  create temp table _fl on commit drop as
    with rt as (select r.* from mp_routes r where r.kind = 'ship' and r.ok),
         cap as (select t.route, t.dir, sum(coalesce((select sum(ty.load) from mp_cars c join mp_types ty on ty.code = c.type where c.form = t.form and (c.busy_until is null or c.busy_until <= h) and c.cond >= 20), 0)) cap
                   from mp_trains t join rt on rt.id = t.route
                  where t.form is not null and not t.bad and t.kind not in ('回送', '試運転') and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0)
                    and not exists (select 1 from mp_cxl zc where zc.train = t.id and zc.day = d0 and zc.ordk is not null)   -- その日は走らない便（運転整理。DB の更新100）
                  group by t.route, t.dir)
    select rt.id route, rt.own_u ru, rt.own_c rc, sa.id sa, sb.id sb, sa.x / 100.0 ax, sa.y / 100.0 ay, sb.x / 100.0 bx, sb.y / 100.0 by,
           _mp_port_isl(sa.id) ia, _mp_port_isl(sb.id) ib,
           (select sum((rt.legs -> (k - 1) ->> 'd')::real) from generate_series(least(i, j), greatest(i, j) - 1) k) / 1000.0 km,
           case when i < j then 1 else -1 end dir,
           coalesce((select c.cap from cap c where c.route = rt.id and c.dir = case when i < j then 1 else -1 end), 0)::numeric cap, 0::numeric used
      from rt, generate_subscripts(rt.stops, 1) i, generate_subscripts(rt.stops, 1) j, mp_stations sa, mp_stations sb
     where i <> j and sa.id = rt.stops[i] and sb.id = rt.stops[j];
  delete from _fl where ia is not distinct from ib or cap <= 0;
end $$;
-- 運転整理の指示のことば（DB の更新100）：{k, s, m} → 「○○ で打ち切り」など
create or replace function public._mp_ord_txt(act jsonb) returns text
language sql stable set search_path = public as $$
  select case act ->> 'k'
           when 'cut' then format('%s で打ち切り', q.nm) when 'ext' then format('%s まで延長運転', q.nm)
           when 'from' then format('%s から運転', q.nm) when 'xfrom' then format('%s から運転（始発を延ばす）', q.nm)
           when 'stop' then format('%s に臨時停車', q.nm) when 'pass' then format('%s を通過', q.nm)
           when 'shift' then format('時刻を %s分 %s', abs((act ->> 'm')::int), case when (act ->> 'm')::int > 0 then 'くり下げ' else 'くり上げ' end)
           when 'x' then '運休' else '' end
    from (select (select s.name from mp_stations s where s.id = nullif(act ->> 's', '')::bigint) nm) q
$$;
-- 運転整理（DB の更新100）：列車 t に 指示 act（{k, s, m}）を1つ あてた形を返す（t は書きかえない）。できないときは そのわけで raise
--   cut 打ち切り（s が終着）・ext 延長運転（同じ系統の先の s まで）・from 途中から運転（s が始発。s を出る時刻は いまの時刻表のまま）・
--   xfrom 始発を延ばす（手前の s から。いまの始発駅を いまの時刻に出る）・stop 臨時停車・pass 通過・shift 時刻を m 分ずらす（採時駅の指定も）
--   のばした区間は、種別の停車駅のパターンで止まる（パターンがなければ ぜんぶ止まる）。連結は、走る区間のうちに
create or replace function public._mp_ord_apply(t mp_trains, act jsonb, r mp_routes) returns mp_trains
language plpgsql set search_path = public as $$
declare k text := act ->> 'k'; s bigint := nullif(act ->> 's', '')::bigint; n int := coalesce(array_length(r.stops, 1), 0); ord int[]; k0 int; k1 int; ks int; nm text;
        pat bigint[]; e jsonb; tq mp_trains; res jsonb; run int; d int; kc int; pk int; qk int; ta int; tb int; km real[]; cpl2 jsonb; ka int; kb int; mm int; ext bigint[];
begin
  if n < 2 then raise exception '駅が2つ以上ある系統だけです'; end if;
  ord := case when t.dir = -1 then array(select generate_series(n, 1, -1)) else array(select generate_series(1, n)) end;
  k0 := coalesce(_mp_kpos(r.stops, t.dir, t.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, t.dir, t.sb, true), n);
  if k0 >= k1 then k0 := 1; k1 := n; end if;
  if k in ('cut', 'ext', 'from', 'xfrom', 'stop', 'pass') then
    if s is null or not (s = any(r.stops)) then raise exception 'この系統の駅をえらんでください'; end if;
    nm := (select x.name from mp_stations x where x.id = s);
    ks := _mp_kpos(r.stops, t.dir, s, k in ('cut', 'ext'));   -- 環状線：終着は うしろのほう、始発・とちゅうは 前のほう
  end if;
  pat := case when coalesce(r.pats ? t.kind, false) then coalesce(array(select x::bigint from jsonb_array_elements_text(r.pats -> t.kind) x where x ~ '^\d+$'), '{}') else '{}' end;   -- 種別の停車駅のパターン（通過する駅）
  if k = 'cut' then
    if not (ks > k0 and ks < k1) then raise exception '%', format('%s は、この列車が走る区間の とちゅうの駅ではありません', nm); end if;
    t.sb := s; t.skip := array_remove(t.skip, s);
  elsif k = 'ext' then
    if ks <= k1 then raise exception '%', format('%s は、この列車の終着駅より先ではありません', nm); end if;
    ext := array(select r.stops[ord[i]] from generate_series(k1, ks) i);   -- いまの終着駅から のばす駅まで（いまの終着駅にも止まる）
    t.skip := array(select x from unnest(t.skip) x where not (x = any(ext))) || array(select x from unnest(ext[2:array_length(ext, 1) - 1]) x where x = any(pat));
    t.sb := case when ks < n then s end;
  elsif k = 'xfrom' then
    if ks >= k0 then raise exception '%', format('%s は、この列車の始発駅より手前ではありません', nm); end if;
    ext := array(select r.stops[ord[i]] from generate_series(ks, k0) i);   -- のばす駅から いまの始発駅まで（いまの始発駅にも止まる）
    tq := t; tq.sa := case when ks > 1 then s end; tq.sb := r.stops[ord[k0]]; tq.dep := 0; tq.tt := '{}'::jsonb; tq.cpl := '[]'::jsonb;
    tq.skip := array(select x from unnest(ext[2:array_length(ext, 1) - 1]) x where x = any(pat));
    res := _mp_train_times(tq, '{}'::jsonb, '{}'::bigint[]);
    run := case when jsonb_array_length(res -> 'sc') > 1 then (res -> 'sc' -> (jsonb_array_length(res -> 'sc') - 1) ->> 1)::int end;
    if run is null then raise exception '%', format('%s から いまの始発駅までの時間が わかりません', nm); end if;
    d := t.dep - r.dwell - run;   -- いまの始発駅に着いて、停車して、いまの時刻に出る
    if d < 0 then raise exception '%', format('%s から走ると、0時より前に出ることになります', nm); end if;
    -- 発車は 分の単位に（早めに出て、いまの始発駅は いまの時刻に出る）
    t.tt := coalesce(t.tt, '{}'::jsonb) || jsonb_build_object(r.stops[ord[k0]]::text, coalesce(t.tt -> r.stops[ord[k0]]::text, '{}'::jsonb) || jsonb_build_object('d', t.dep));
    t.dep := (d / 60) * 60; t.sa := case when ks > 1 then s end;
    t.skip := array(select x from unnest(t.skip) x where not (x = any(ext))) || tq.skip;
  elsif k = 'from' then
    if not (ks > k0 and ks < k1) then raise exception '%', format('%s は、この列車が走る区間の とちゅうの駅ではありません', nm); end if;
    d := (t.tt -> s::text ->> 'd')::int;   -- 採時駅で 発車を決めていれば その時刻
    if d is null then
      -- いまの時刻表で s を出る時刻（止まる駅なら発車。待避・続行で待つ分はのぞく。通過する駅なら、前後の止まる駅から距離でわりふる）
      kc := 1;
      for e in select v from jsonb_array_elements(coalesce(t.sched, '[]'::jsonb)) v loop
        while kc <= n and r.stops[ord[kc]] <> (e ->> 0)::bigint loop kc := kc + 1; end loop;
        if kc > n then exit; end if;
        if kc = ks then d := (e ->> 2)::int - coalesce((t.hold ->> s::text)::int, 0); exit; end if;
        if kc < ks then pk := kc; ta := (e ->> 2)::int; else qk := kc; tb := (e ->> 1)::int; exit; end if;
        kc := kc + 1;
      end loop;
      if d is null and pk is not null and qk is not null and ta is not null and tb is not null then
        km := array(select coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q2(l, kq) where kq < o), 0) from generate_series(1, n) o);
        d := ta + round((tb - ta) * abs(km[ord[ks]] - km[ord[pk]]) / greatest(abs(km[ord[qk]] - km[ord[pk]]), 0.001))::int;
      end if;
    end if;
    if d is null then raise exception 'この列車の時刻が まだ計算されていません（ダイヤを保存してから）'; end if;
    d := ((d + 59) / 60) * 60;   -- 分の単位に（おくれぎみに出る）
    if d >= 86400 then raise exception '%', format('%s を出るのが24時をすぎるので、途中から運転にできません', nm); end if;
    t.dep := d; t.sa := s; t.skip := array_remove(t.skip, s);
  elsif k = 'stop' then
    if not (ks > k0 and ks < k1) then raise exception '%', format('%s は、この列車が走る区間の とちゅうの駅ではありません', nm); end if;
    if not (s = any(t.skip)) then raise exception '%', format('%s には もう止まります', nm); end if;
    t.skip := array_remove(t.skip, s);
  elsif k = 'pass' then
    if not (ks > k0 and ks < k1) then raise exception '%', format('%s は、この列車が走る区間の とちゅうの駅ではありません', nm); end if;
    if s = any(t.skip) then raise exception '%', format('%s は もう通過します', nm); end if;
    if exists (select 1 from jsonb_array_elements(coalesce(t.cpl, '[]'::jsonb)) c where (c ->> 'a')::bigint = s or (c ->> 'b')::bigint = s) then
      raise exception '%', format('%s で連結・切りはなしをするので、通過にできません', nm);
    end if;
    t.skip := t.skip || s;
  elsif k = 'shift' then
    mm := (act ->> 'm')::int;
    if mm is null or mm = 0 or abs(mm) > 180 then raise exception '何分ずらすか えらんでください（180分まで）'; end if;
    d := t.dep + mm * 60;
    if d < 0 or d >= 86400 then raise exception '時刻をずらすと 0時をまたぎます（始発駅を 0時〜24時に出るように）'; end if;
    t.dep := d;
    t.tt := coalesce((select jsonb_object_agg(z.key, jsonb_strip_nulls(jsonb_build_object('a', (z.value ->> 'a')::int + mm * 60, 'd', (z.value ->> 'd')::int + mm * 60, 't', (z.value ->> 't')::int)))
                        from jsonb_each(coalesce(t.tt, '{}'::jsonb)) z), '{}'::jsonb);
  else
    raise exception '指示をえらんでください';
  end if;
  -- 連結：打ち切る駅から先・途中から運転する駅より前でつなぐ分は、走る区間のうちに（切りはなすのは終着、つなぐのは始発）
  if k in ('cut', 'from') and jsonb_array_length(coalesce(t.cpl, '[]'::jsonb)) > 0 then
    cpl2 := '[]'::jsonb;
    for e in select x from jsonb_array_elements(t.cpl) x loop
      ka := case when e ->> 'a' is null then k0 else _mp_kpos(r.stops, t.dir, (e ->> 'a')::bigint, false) end;
      kb := case when e ->> 'b' is null then k1 else _mp_kpos(r.stops, t.dir, (e ->> 'b')::bigint, true) end;
      if k = 'cut' then
        if ka >= ks then continue; end if;
        if kb >= ks then e := e || jsonb_build_object('b', null); end if;
      else
        if kb <= ks then continue; end if;
        if ka <= ks then e := e || jsonb_build_object('a', null); end if;
      end if;
      cpl2 := cpl2 || jsonb_build_array(e);
    end loop;
    t.cpl := cpl2;
  end if;
  return t;
end $$;
-- 運転整理（DB の更新100）：系統の列車に 指示 p_act（{k, s, m}。_mp_ord_apply）。k = 'x' は運休（日をきめたときだけ）
--   列車：p_trains（えらんだ列車）か、p_flt（毎日の列車を {dir, kinds, t0, t1（発車時刻の秒）, via（通る駅）} でしぼる）
--   p_days：null は毎日（ふだんのダイヤの列車を変える）。{d0, d1, dow} は日をきめて（31日まで・きょうから60日先まで・dow は 0 日〜6 土。なければ ぜんぶの曜日）：
--     毎日の列車は、その日だけ走る「運転整理の列車」をつくる（もとの列車は その日は走らない。もうある日は それに重ねる）。臨時列車・運転整理の列車は、その日なら その列車を変える
--   p_dry は見つもり（変えない）。決めたあとは「↶ 取り消す」でもどせる。日をきめるときは、一度に 400本・日 まで
create or replace function public.mp_dia_order(p_route bigint, p_trains bigint[], p_flt jsonb, p_act jsonb, p_days jsonb, p_dry boolean, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; k text := p_act ->> 'k'; act jsonb; ds date[]; d date; d0 date; d1 date; dw int[]; today date := _mp_today();
        tids bigint[]; tr mp_trains; v mp_trains; nt mp_trains; bt mp_trains; xt mp_trains; hx boolean := false; w text; bw text; txt text; dtx text; ex jsonb;
        ndaily int := 0; nmade int := 0; nupd int := 0; ncx int := 0; nsk int := 0; sk jsonb := '[]'::jsonb; have int; n int; dry boolean := coalesce(p_dry, false);
        f_dir int; f_k text[]; f_t0 int; f_t1 int; f_via bigint; nts mp_trains[] := '{}'; b0 int; b1 int; o0 int; o1 int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  n := coalesce(array_length(r.stops, 1), 0);
  if n < 2 then raise exception '駅が2つ以上ある系統だけです'; end if;
  if k is null or k not in ('cut', 'ext', 'from', 'xfrom', 'stop', 'pass', 'shift', 'x') then raise exception '指示をえらんでください'; end if;
  act := jsonb_strip_nulls(jsonb_build_object('k', k, 's', case when k in ('cut', 'ext', 'from', 'xfrom', 'stop', 'pass') then nullif(p_act ->> 's', '')::bigint end,
                                              'm', case when k = 'shift' then (p_act ->> 'm')::int end));
  if k in ('cut', 'ext', 'from', 'xfrom', 'stop', 'pass') and not coalesce((act ->> 's')::bigint = any(r.stops), false) then raise exception 'この系統の駅をえらんでください'; end if;
  if k = 'shift' and (coalesce((act ->> 'm')::int, 0) = 0 or abs((act ->> 'm')::int) > 180) then raise exception '何分ずらすか えらんでください（180分まで）'; end if;
  txt := _mp_ord_txt(act);
  -- 日
  if p_days is null then
    if k = 'x' then raise exception '運休は、日をきめて指示してください（毎日やめるときは、列車を消します）'; end if;
    dtx := '毎日';
  else
    begin
      d0 := (p_days ->> 'd0')::date; d1 := coalesce(nullif(p_days ->> 'd1', '')::date, d0);
    exception when others then raise exception '日の形がちがいます';
    end;
    if d0 is null or d1 < d0 then raise exception '日をえらんでください（はじめの日 ≦ おわりの日）'; end if;
    if d0 < today then raise exception '過ぎた日には指示できません'; end if;
    if d1 > today + 60 then raise exception '指示できるのは60日先までです'; end if;
    dw := case when jsonb_typeof(p_days -> 'dow') = 'array' and jsonb_array_length(p_days -> 'dow') between 1 and 6
               then array(select x::int from jsonb_array_elements_text(p_days -> 'dow') x where x ~ '^[0-6]$') end;
    ds := array(select g::date from generate_series(d0::timestamp, d1::timestamp, interval '1 day') g where dw is null or extract(dow from g)::int = any(dw) order by 1);
    if coalesce(array_length(ds, 1), 0) = 0 then raise exception 'えらんだ曜日の日がありません'; end if;
    if array_length(ds, 1) > 31 then raise exception '一度に指示できるのは31日までです'; end if;
    dtx := to_char(ds[1], 'FMMM/FMDD') || case when d1 > d0 then '〜' || to_char(d1, 'FMMM/FMDD') || case when dw is not null then '（曜日をえらんで）' else '' end else '' end;
  end if;
  -- 列車
  if p_trains is not null then
    tids := array(select t.id from mp_trains t where t.route = r.id and t.id = any(p_trains) order by t.dep, t.id);
  else
    f_dir := case when p_flt ->> 'dir' in ('1', '-1') then (p_flt ->> 'dir')::int end;
    f_k := case when jsonb_typeof(p_flt -> 'kinds') = 'array' and jsonb_array_length(p_flt -> 'kinds') > 0 then array(select jsonb_array_elements_text(p_flt -> 'kinds')) end;
    f_t0 := nullif(p_flt ->> 't0', '')::int; f_t1 := nullif(p_flt ->> 't1', '')::int; f_via := nullif(p_flt ->> 'via', '')::bigint;
    tids := array(select t.id from mp_trains t where t.route = r.id and t.day is null and t.orig is null
                    and (f_dir is null or t.dir = f_dir) and (f_k is null or t.kind = any(f_k))
                    and (f_t0 is null or t.dep >= f_t0) and (f_t1 is null or t.dep <= f_t1)
                    and (f_via is null or _mp_kpos(r.stops, t.dir, f_via, false) between coalesce(_mp_kpos(r.stops, t.dir, t.sa, false), 1) and coalesce(_mp_kpos(r.stops, t.dir, t.sb, true), n))
                  order by t.dep, t.id);
  end if;
  if coalesce(array_length(tids, 1), 0) = 0 then raise exception 'あてはまる列車がありません'; end if;
  if ds is not null and array_length(tids, 1) * array_length(ds, 1) > 400 then
    raise exception '%', format('一度に指示できるのは 400本・日 までです（列車 %s本 × %s日）', array_length(tids, 1), array_length(ds, 1));
  end if;
  select count(*) into have from mp_trains where route = r.id;
  if not dry then
    perform _mp_lock(pa.pu, pa.pc);
    perform _mp_dia_snap(r.id, format('運転整理（%s）：%s', dtx, txt));
  end if;
  for tr in select * from mp_trains t where t.id = any(tids) order by t.dep, t.id loop
    w := null;
    if ds is null then
      -- 毎日：ふだんのダイヤの列車を変える
      if tr.day is not null then w := '臨時列車・運転整理の列車です（日をきめて指示してください）';
      else
        begin nt := _mp_ord_apply(tr, act, r); exception when others then w := sqlerrm; end;
      end if;
      if w is null then
        ndaily := ndaily + 1; if not hx then xt := nt; hx := true; end if;
        if not dry then update mp_trains set dep = nt.dep, tt = nt.tt, skip = nt.skip, sa = nt.sa, sb = nt.sb, cpl = nt.cpl where id = tr.id; else nts := nts || nt; end if;
      else
        nsk := nsk + 1; if jsonb_array_length(sk) < 20 then sk := sk || jsonb_build_object('num', tr.num, 'w', w); end if;
      end if;
      continue;
    end if;
    if tr.day is not null then
      -- 臨時列車・運転整理の列車：その日が えらんだ日なら、その列車を変える
      if not (tr.day = any(ds)) then w := 'えらんだ日には走りません';
      elsif k = 'x' then
        if exists (select 1 from mp_cxl c where c.train = tr.id and c.day = tr.day) then w := 'もう運休にしています'; end if;
      else
        begin nt := _mp_ord_apply(tr, act, r); exception when others then w := sqlerrm; end;
      end if;
      if w is not null then
        nsk := nsk + 1; if jsonb_array_length(sk) < 20 then sk := sk || jsonb_build_object('num', tr.num, 'd', tr.day, 'w', w); end if;
        continue;
      end if;
      if k = 'x' then
        ncx := ncx + 1;
        if not dry then
          if tr.orig is not null then
            delete from mp_trains where id = tr.id;   -- 運転整理の列車をやめて、もとの列車を その日は運休に
            insert into mp_cxl(train, day, route, own_u, own_c, by_u, ordk) values (tr.orig, tr.day, r.id, r.own_u, r.own_c, u, 'x');
          else
            insert into mp_cxl(train, day, route, own_u, own_c, by_u, ordk) values (tr.id, tr.day, r.id, r.own_u, r.own_c, u, 'x');
          end if;
        end if;
      else
        nupd := nupd + 1; if not hx then xt := nt; hx := true; end if;
        if not dry then
          update mp_trains set dep = nt.dep, tt = nt.tt, skip = nt.skip, sa = nt.sa, sb = nt.sb, cpl = nt.cpl,
                 ordj = case when orig is not null then coalesce(ordj, '[]'::jsonb) || jsonb_build_array(act) end where id = tr.id;
        end if;
      end if;
      continue;
    end if;
    -- 毎日の列車：日ごとに、その日だけ走る運転整理の列車をつくる（もうある日は、それに重ねる）
    bt := null; bw := null;
    foreach d in array ds loop
      w := null;
      select * into v from mp_trains x where x.orig = tr.id and x.day = d;
      if found then
        if k = 'x' then
          ncx := ncx + 1;
          if not dry then
            delete from mp_trains where id = v.id;
            insert into mp_cxl(train, day, route, own_u, own_c, by_u, ordk) values (tr.id, d, r.id, r.own_u, r.own_c, u, 'x');
          end if;
          continue;
        end if;
        begin nt := _mp_ord_apply(v, act, r); exception when others then w := sqlerrm; end;
        if w is null then
          nupd := nupd + 1; if not hx then xt := nt; hx := true; end if;
          if not dry then
            update mp_trains set dep = nt.dep, tt = nt.tt, skip = nt.skip, sa = nt.sa, sb = nt.sb, cpl = nt.cpl, ordj = coalesce(ordj, '[]'::jsonb) || jsonb_build_array(act) where id = v.id;
          end if;
        end if;
      elsif exists (select 1 from mp_cxl c where c.train = tr.id and c.day = d) then
        w := case when k = 'x' then 'もう運休にしています' else 'その日は運休にしています' end;
      elsif k = 'x' then
        ncx := ncx + 1;
        if not dry then insert into mp_cxl(train, day, route, own_u, own_c, by_u, ordk) values (tr.id, d, r.id, r.own_u, r.own_c, u, 'x'); end if;
      else
        if bt is null and bw is null then
          begin bt := _mp_ord_apply(tr, act, r); exception when others then bw := sqlerrm; end;
        end if;
        w := bw;
        if w is null then
          nmade := nmade + 1; if not hx then xt := bt; hx := true; end if;
          if not dry then
            insert into mp_trains(route, dir, num, kind, dep, form, op, day, tt, skip, cpl, sa, sb, orig, ordj)
            values (r.id, bt.dir, bt.num, bt.kind, bt.dep, bt.form, bt.op, d, coalesce(bt.tt, '{}'::jsonb), coalesce(bt.skip, '{}'), coalesce(bt.cpl, '[]'::jsonb), bt.sa, bt.sb, tr.id, jsonb_build_array(act));
          end if;
        end if;
      end if;
      if w is not null then
        nsk := nsk + 1; if jsonb_array_length(sk) < 20 then sk := sk || jsonb_build_object('num', tr.num, 'd', d, 'w', w); end if;
      end if;
    end loop;
  end loop;
  if hx then
    ex := jsonb_build_object('num', xt.num, 'dep', xt.dep, 'skip', coalesce(cardinality(xt.skip), 0),
            'from', (select s.name from mp_stations s where s.id = coalesce(xt.sa, case when xt.dir = -1 then r.stops[n] else r.stops[1] end)),
            'to', (select s.name from mp_stations s where s.id = coalesce(xt.sb, case when xt.dir = -1 then r.stops[1] else r.stops[n] end)));
  end if;
  select count(*) filter (where bad), count(*) filter (where warn ~ 'とかさなります') into b0, o0 from mp_trains where route = r.id;
  if dry and ds is null and ndaily > 0 then
    -- 毎日の見つもり：変えて組みなおしてみて、走れない列車・重なる列車の数を見る（編成のつながりなど。さいごに取り消す）
    begin
      update mp_trains m set dep = x.dep, tt = x.tt, skip = x.skip, sa = x.sa, sb = x.sb, cpl = x.cpl from unnest(nts) x where m.id = x.id;
      perform _mp_resched(r.id);
      select count(*) filter (where bad), count(*) filter (where warn ~ 'とかさなります') into b1, o1 from mp_trains where route = r.id;
      raise exception 'mp_dia_order_dry';
    exception when raise_exception then
      if sqlerrm <> 'mp_dia_order_dry' then raise; end if;
    end;
  end if;
  if not dry then
    if ndaily + nmade + nupd + ncx = 0 then raise exception '%', 'その指示ができる列車がありません' || coalesce('（' || (sk -> 0 ->> 'w') || '）', ''); end if;
    if have + nmade > 900 then raise exception '%', format('1つの系統の列車は900本までです（運転整理の列車もふくみます。いま %s本・つくる %s本）', have, nmade); end if;
    perform _mp_resched(r.id);
    perform _mp_chg('route', r.id, 'set', null);
    select count(*) filter (where bad), count(*) filter (where warn ~ 'とかさなります') into b1, o1 from mp_trains where route = r.id;
  end if;
  return jsonb_build_object('bad0', b0, 'bad1', b1, 'ov0', o0, 'ov1', o1, 'n', ndaily + nmade + nupd + ncx, 'daily', ndaily, 'made', nmade, 'upd', nupd, 'cx', ncx, 'skip', nsk, 'sk', sk,
                            'days', to_jsonb(ds), 'trains', array_length(tids, 1), 'what', txt, 'when', dtx, 'ex', ex,
                            'full', have + nmade > 900, 'have', have);
end $$;
-- 運転整理を消す（DB の更新100）：運転整理の列車 p_trains（もとの列車が その日も走る）・運転整理の運休 p_cxl（mp_cxl の id）。消したあとも「↶ 取り消す」でもどせる
create or replace function public.mp_dia_order_del(p_route bigint, p_trains bigint[], p_cxl bigint[], p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; r mp_routes; vt bigint[]; vc bigint[]; nn int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  select * into r from mp_routes where id = p_route and own_u is not distinct from pa.pu and own_c is not distinct from pa.pc;
  if not found then raise exception '系統が見つかりません'; end if;
  vt := array(select t.id from mp_trains t where t.route = r.id and t.orig is not null and t.id = any(coalesce(p_trains, '{}')));
  vc := array(select c.id from mp_cxl c join mp_trains t on t.id = c.train where t.route = r.id and c.ordk = 'x' and c.id = any(coalesce(p_cxl, '{}')));
  nn := coalesce(array_length(vt, 1), 0) + coalesce(array_length(vc, 1), 0);
  if nn = 0 then raise exception '消す運転整理がありません'; end if;
  perform _mp_lock(pa.pu, pa.pc);
  perform _mp_dia_snap(r.id, format('運転整理を %s件 消した', nn));
  delete from mp_trains where id = any(vt);
  delete from mp_cxl where id = any(vc);
  perform _mp_resched(r.id);
  perform _mp_chg('route', r.id, 'set', null);
  return jsonb_build_object('n', nn);
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。mp_dia_order・mp_dia_order_del は ログインした人（中で系統の持ち主かをしらべる）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_ord_trg', '_mp_ord_txt', '_mp_ord_apply', 'mp_dia_order', 'mp_dia_order_del') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 時刻を組みなおす操作の待ち時間（create or replace で消えた設定も もどす）
alter function public.mp_dia_undo(bigint) set statement_timeout = '20s';
alter function public.mp_train_save(bigint, bigint, int, text, text, int, bigint, jsonb, bigint[], text, bigint, date, jsonb, bigint, bigint) set statement_timeout = '20s';
alter function public.mp_dia_fix(bigint, text, text, boolean, boolean) set statement_timeout = '60s';
alter function public.mp_dia_order(bigint, bigint[], jsonb, jsonb, jsonb, boolean, text) set statement_timeout = '60s';
alter function public.mp_dia_order_del(bigint, bigint[], bigint[], text) set statement_timeout = '60s';
