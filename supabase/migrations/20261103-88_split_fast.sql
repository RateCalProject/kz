-- 線路のとちゅうから分かれる線（分かれ道）をつくる・直すのを軽く：前は、系統の道すじが1つでも変わると、持ち主の系統（乗り入れもふくむ）を ぜんぶ組みなおしていて、
--   大きい路線網のまん中（都心など）では 短い線でも 20秒の制限をこえていた。いまは 道すじの変わった系統だけ組みなおし、
--   その結果（列車の時刻・待避・注意・走れるか）が前とまったく同じなら、ほかの系統はそのまま（変わったときだけ、前と同じように ほかも組みなおす）
-- 時刻の組みなおしも軽く：駅と駅のあいだごとの 複々線・電化方式・デッドセクションは、列車ごとではなく 系統ごとに1回だけ計算する。
--   番線のかさなりは、この系統の列車が使う駅・番線の発着だけを見る（中身は前と同じ）
-- 線路をつくる・直す・つなぐ・こわす・設定を変えるのは、60秒まで待つ（前は 20秒）

-- 系統の駅と駅のあいだごとの 複々線・電化方式・デッドセクション を、時刻を組みなおすあいだ 1回だけ計算しておく（DB の更新88。前は列車ごとに計算していた）。
--   _mp_train_times は、mp.li_r が その系統のときだけ これを使う（組みなおしがおわると mp.li_r を空にする）
create or replace function public._mp_li_put(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes;
begin
  select * into r from mp_routes where id = rid;
  if not found or r.kind <> 'rail' then perform set_config('mp.li_r', '', true); return; end if;
  perform set_config('mp.li_q', coalesce(_mp_leg_quad(r.legs)::text, ''), true);
  perform set_config('mp.li_pm', coalesce(_mp_leg_pm(r.legs)::text, ''), true);
  perform set_config('mp.li_dz', coalesce(_mp_leg_dz(r.legs)::text, ''), true);
  perform set_config('mp.li_r', rid::text, true);
end $$;
-- 系統の列車の 時刻・待避・注意・走れるか・連結 の指紋（組みなおす前とあとを くらべる用。DB の更新88）
create or replace function public._mp_routes_fp(ids bigint[]) returns text
language sql stable set search_path = public as $$
  select md5(coalesce(string_agg(concat_ws('|', t.id, coalesce(t.sched::text, '-'), coalesce(t.hold::text, '-'), coalesce(t.tai::text, '-'), coalesce(t.warn, '-'), t.bad::text,
                                           coalesce(t.cplx::text, '-')), ',' order by t.id), ''))
    from mp_trains t where t.route = any(ids)
$$;

create or replace function public._mp_routes_fix(pu uuid, pc int) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; i int; leg jsonb; lg jsonb; bad text; ids bigint[] := '{}'; lgs jsonb[] := '{}'; bads text[] := '{}'; same boolean[] := '{}'; k int;
        fp0 text;   -- DB の更新88
begin
  -- 1. 系統ごとに、線路の道すじを出しなおす
  for r in select * from mp_routes x where x.kind = 'rail' and ((x.own_u is not distinct from pu and x.own_c is not distinct from pc)
             or exists (select 1 from mp_thru t where t.hu is not distinct from pu and t.hc is not distinct from pc and t.gu is not distinct from x.own_u and t.gc is not distinct from x.own_c)) loop
    lg := '[]'::jsonb; bad := null;
    for i in 1..array_length(r.stops, 1) - 1 loop
      leg := _mp_rail_path(r.own_u, r.own_c, r.stops[i], r.stops[i + 1]);
      if leg is null then bad := format('%s → %s の線路がつながっていません', (select name from mp_stations where id = r.stops[i]), (select name from mp_stations where id = r.stops[i + 1])); exit; end if;
      lg := lg || jsonb_build_array(leg);
    end loop;
    ids := ids || r.id; lgs := lgs || lg; bads := bads || bad;
    same := same || coalesce((bad is null and r.ok and r.legs = lg) or (bad is not null and not r.ok and r.why is not distinct from bad), false);
  end loop;
  -- 2.（2026-10-28）どの系統も前とまったく同じなら、何もしない（時刻も前のまま）。前は線路を1本つくるたびに、ぜんぶの系統の時刻を組みなおしていて、8秒の制限をこえていた
  if coalesce(array_length(ids, 1), 0) = 0 or true = all(same) then return; end if;
  -- 3. 道すじが変わった系統だけ、書きかえて時刻を組みなおす（DB の更新88）。
  --    前は どれか1つ変わると、ぜんぶの系統（乗り入れもふくむ）を組みなおしていて、大きい路線網のまん中で線を分けると（分かれ道をつくると）20秒の制限をこえていた
  fp0 := _mp_routes_fp(ids);   -- 組みなおす前の、列車の時刻・待避・注意・走れるか
  for k in 1..array_length(ids, 1) loop
    if not same[k] then
      update mp_routes set legs = case when bads[k] is null then lgs[k] else mp_routes.legs end, ok = bads[k] is null, why = bads[k], runt = '{}'::jsonb where id = ids[k];
      if bads[k] is null then perform _mp_resched(ids[k]); end if;
    end if;
  end loop;
  -- 4. 組みなおした結果が前とまったく同じなら、ほかの系統はそのまま。変わったら、前と同じように ほかの系統も組みなおす（待避・番線のかさなりが変わるので）
  if _mp_routes_fp(ids) is distinct from fp0 then
    for k in 1..array_length(ids, 1) loop
      if same[k] and bads[k] is null then perform _mp_resched(ids[k]); end if;
    end loop;
  end if;
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

create or replace function public._mp_train_times(tr mp_trains, hold jsonb, waits bigint[]) returns jsonb
language plpgsql set search_path = public as $$
declare r mp_routes; perf jsonb; n int; ord int[]; i int; k int; t int; arr int; dep int; spec jsonb; sc jsonb := '[]'::jsonb; ws text[] := '{}';
        st mp_stations; lastStop int; run int; trk int; dw int; flen real; stop boolean;
        lq boolean[]; qx boolean;   -- 複々線（DB の更新86）
        lpm int[]; ldz int[]; pneed int; pm int; dzp int := 6;   -- 電化方式・デッドセクション（DB の更新87）
        e jsonb; ci bigint; o mp_ops; cp jsonb; ka int; kb int; cx jsonb := '[]'::jsonb; cw text; nmax int; x jsonb; skipped bigint; k0 int; k1 int;
begin
  select * into r from mp_routes where id = tr.route;
  perf := case when tr.form is not null then _mp_form_perf(tr.form) end;
  n := array_length(r.stops, 1);
  ord := case when tr.dir = 1 then array(select generate_series(1, n)) else array(select generate_series(n, 1, -1)) end;
  dw := r.dwell;
  lq := case when r.kind = 'rail' then case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_q', true), '')::boolean[] else _mp_leg_quad(r.legs) end end;   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
  qx := r.kind = 'rail' and _mp_kprio(r.own_u, r.own_c, tr.kind) <= 3;   -- 急行線を走る列車（優先番号 3 まで。DB の更新86）
  -- 走る区間（途中始発・途中止まり。2026-10-28）：走る順の k0 番目から k1 番目まで
  k0 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sa, false), 1); k1 := coalesce(_mp_kpos(r.stops, tr.dir, tr.sb, true), n);   -- 環状線：始発は走る順で前の、終着はうしろのほう
  if k0 >= k1 then ws := ws || '始発駅と終着駅の順がちがいます（系統の端から端まで走ります）'::text; k0 := 1; k1 := n; end if;
  if perf is null then ws := ws || '編成が決まっていません（走りません）'::text; end if;
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean and exists (select 1 from jsonb_array_elements(r.legs) with ordinality l(v, lo)
        where l.lo >= least(ord[k0], ord[k1]) and l.lo < greatest(ord[k0], ord[k1]) and not (l.v ->> 'e')::boolean) then   -- 走る区間だけ
    ws := ws || '電化していない区間があります（電車は走れません）'::text;
  end if;
  -- 電化方式（DB の更新87）：走る区間の方式を、編成が ぜんぶ走れるか
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean then
    if current_setting('mp.li_r', true) = r.id::text then   -- 組みなおしのあいだは1回だけ計算したもの（DB の更新88）
      lpm := nullif(current_setting('mp.li_pm', true), '')::int[]; ldz := nullif(current_setting('mp.li_dz', true), '')::int[];
    else lpm := _mp_leg_pm(r.legs); ldz := _mp_leg_dz(r.legs); end if;
    pm := coalesce((perf ->> 'ps')::int, 1);
    pneed := (select coalesce(bit_or(lpm[lo]), 0) from generate_series(least(ord[k0], ord[k1]), greatest(ord[k0], ord[k1]) - 1) lo);
    if pneed & ~pm <> 0 then
      ws := ws || format('%s の区間があります（この編成は %s だけ。走れません）', _mp_ps_names(pneed & ~pm), _mp_ps_names(pm));
    end if;
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
    trk := coalesce((spec ->> 't')::int, _mp_pick_trk(_mp_sta_trk(st), tr.dir, st.id = any(coalesce(waits, '{}'))
                       or (qx and coalesce(coalesce(lq[i - 1], lq[i]) and coalesce(lq[i], lq[i - 1]), false))));   -- 複々線の中の駅：急行線の列車は待避線の番線（DB の更新86）
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
      if ldz is not null then run := run + dzp * (select coalesce(sum(ldz[lo]), 0) from generate_series(least(lastStop, i), greatest(lastStop, i) - 1) lo)::int; end if;   -- デッドセクションは惰行で通る（1か所 6秒。DB の更新87）
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

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_li_put', '_mp_routes_fp', '_mp_routes_fix', '_mp_resched', '_mp_train_times') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- 線路をつくる・直す・つなぐ・こわす・設定を変える（系統の時刻を組みなおすことがある）は 60秒まで（DB の更新88）
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mp_seg_build', 'mp_seg_edit', 'mp_seg_join', 'mp_seg_del', 'mp_seg_opts') loop
    execute format('alter function %s set statement_timeout = %L', f.sig, '60s');
  end loop;
end $$;
