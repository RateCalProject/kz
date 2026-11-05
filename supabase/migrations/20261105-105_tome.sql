-- DB の更新105：留置線と折り返し
--   折り返しを待つ編成も 駅の番線を1本ずつ つかう。待つ編成と 止まる列車で 駅の番線が足りなくなると「番線が足りません（折り返しを待つ編成…）」。
--   駅の近くに 線路をなぞって 留置線をつくると（mp_tome_build。車庫の size 'R長さx本数'・sta）、8分以上 待つ編成は 着いて3分で留置線へ（番線をあける）。
--   留置線には車両を置けない（車両基地ではない）。地図に 待っている編成を出す（列車の lay）
alter table public.mp_depots add column if not exists sta bigint references public.mp_stations(id) on delete set null;   -- 留置線（size 'R長さx本数'）の駅（DB の更新105）
alter table public.mp_trains add column if not exists lay jsonb;   -- 折り返しを待つ（DB の更新105）：[駅, 着く, 出る, 1 ホーム・2 留置線, 留置線（車庫）, 何本目, ホームをあける時刻, つぎの列車]
create index if not exists mp_trains_lay_t on public.mp_trains (((lay ->> 0)::bigint)) where lay is not null and lay ->> 3 = '2';   -- 留置線で待つ編成（駅ごと）
create index if not exists mp_trains_lay on public.mp_trains (((lay ->> 0)::bigint)) where lay is not null;   -- 折り返しを待つ編成（駅ごと）

create or replace function public._mp_dep_dim(kind text, sz text) returns real[]
language plpgsql immutable as $$
declare l int; n int;
begin
  if kind = 'rail' and sz ~ '^[TR][0-9]{2,4}x[0-9]{1,2}$' then   -- R：留置線（DB の更新105。形は T と同じ）
    l := split_part(substr(sz, 2), 'x', 1)::int; n := split_part(sz, 'x', 2)::int;
    return array[l / 50.0, (n * 5 + 10) / 50.0, 0.25, floor(l / 20.0) * n]::real[];
  end if;
  if kind = 'bus' then return case sz when 'M' then array[5, 3, 0.9, 60] else array[3, 2, 0.9, 20] end::real[]; end if;
  if kind = 'ship' then return array[2, 2, 0.5, 8]::real[]; end if;   -- 港の船の置き場（t54o。線の横ではない）
  if kind = 'air' then return array[2, 2, 0.5, 8]::real[]; end if;    -- 空港の駐機場（t54p。線の横ではない）
  return case sz when 'L' then array[10, 4, 0.9, 120] when 'M' then array[7, 3, 0.9, 48] else array[5, 2, 0.9, 16] end::real[];
end $$;

-- 折り返しを待つ（DB の更新105）：系統 rid の列車が入っている編成ごとに、毎日の走りを時刻の順に見て、前の走りの終着駅から つぎの走りが出るとき、
--   その駅で 着いてから出るまで待つ（前の列車 = 着いた列車の lay に のこす。ほかの系統の列車でも）。待つあいだは 着いた番線をふさぐ。
--   駅の留置線（車庫の size 'R…'・sta がその駅・編成と同じ持ち主・編成が入る長さ）が あいていて 8分以上 待つときは、着いて3分で留置線へ（出る3分前にもどる）
--   lay：[駅, 着く, 出る, 1 ホーム・2 留置線, 留置線（車庫）, 何本目, ホームをあける時刻, つぎの列車]。変わった列車だけ書きかえる
create or replace function public._mp_lay_set(rid bigint) returns void
language plpgsql set search_path = public as $$
declare zp jsonb; e jsonb; zids bigint[]; zout jsonb := '{}'::jsonb; zocc jsonb := '[]'::jsonb; zmv int := 180; zd bigint; zk int; zpl int; zlz int;
        zlen jsonb := '{}'::jsonb; zl real; zid bigint; zfm bigint; zes bigint; zet int; znid bigint; znft int; zou uuid; zoc int;
begin
  if (select ro.kind from mp_routes ro where ro.id = rid) is distinct from 'rail' then   -- 鉄道だけ（バス・船・飛行機は見ない）
    update mp_trains set lay = null where route = rid and lay is not null;
    return;
  end if;
  with fz as (select distinct t.form f from mp_trains t where t.route = rid and t.form is not null and t.day is null),
  ru as (select t.id, t.form, t.route, (t.sched -> 0 ->> 0)::bigint fs, (t.sched -> 0 ->> 2)::int ft,
                (t.sched -> (jsonb_array_length(t.sched) - 1) ->> 0)::bigint es, (t.sched -> (jsonb_array_length(t.sched) - 1) ->> 1)::int et
           from mp_trains t join fz on fz.f = t.form where t.day is null and jsonb_array_length(t.sched) > 1),
  pr as (select ru.*, lead(ru.id) over w nid, lead(ru.fs) over w nfs, lead(ru.ft) over w nft, lead(ru.route) over w nrt
           from ru where ru.ft is not null and ru.et is not null window w as (partition by ru.form order by ru.ft, ru.id))
  select coalesce(jsonb_agg(jsonb_build_array(pr.id, pr.form, pr.es, pr.et, pr.nid, pr.nft, f.own_u, f.own_c) order by pr.es, pr.et, pr.id), '[]'::jsonb) into zp
    from pr join mp_forms f on f.id = pr.form
   where pr.nid is not null and pr.es = pr.nfs and pr.nft >= pr.et and (pr.route = rid or pr.nrt = rid);
  zids := array(select (x ->> 0)::bigint from jsonb_array_elements(zp) x);
  for e in select x from jsonb_array_elements(zp) x loop
    zid := (e ->> 0)::bigint; zfm := (e ->> 1)::bigint; zes := (e ->> 2)::bigint; zet := (e ->> 3)::int; znid := (e ->> 4)::bigint; znft := (e ->> 5)::int;
    zou := (e ->> 6)::uuid; zoc := (e ->> 7)::int;
    zpl := 1; zd := null; zk := null; zlz := znft;
    if znft - zet >= 2 * zmv + 120 and exists (select 1 from mp_depots d where d.sta = zes and d.size like 'R%' and d.kind = 'rail') then
      if not zlen ? zfm::text then zlen := zlen || jsonb_build_object(zfm::text, coalesce((_mp_form_perf(zfm) ->> 'len')::real, 100)); end if;
      zl := (zlen ->> zfm::text)::real;
      select d.id, g.k into zd, zk
        from mp_depots d cross join lateral generate_series(1, split_part(d.size, 'x', 2)::int) g(k)
       where d.sta = zes and d.size like 'R%' and d.kind = 'rail' and d.own_u is not distinct from zou and d.own_c is not distinct from zoc
         and split_part(substr(d.size, 2), 'x', 1)::int >= zl
         -- ほかの系統で決まった留置線の待ち（いま組みなおす列車はのぞく）と、この組みなおしで決めた待ち
         and not exists (select 1 from mp_trains t2 where t2.lay is not null and t2.lay ->> 3 = '2' and (t2.lay ->> 0)::bigint = zes
                           and (t2.lay ->> 4)::bigint = d.id and (t2.lay ->> 5)::int = g.k and t2.day is null and not (t2.id = any(zids))
                           and (t2.lay ->> 1)::int + zmv < znft - zmv and zet + zmv < (t2.lay ->> 2)::int - zmv)
         and not exists (select 1 from jsonb_array_elements(zocc) o where (o ->> 0)::bigint = zes and (o ->> 1)::bigint = d.id and (o ->> 2)::int = g.k
                           and (o ->> 3)::int < znft - zmv and zet + zmv < (o ->> 4)::int)
       order by d.id, g.k limit 1;
      if zd is not null then zpl := 2; zlz := zet + zmv; zocc := zocc || jsonb_build_array(jsonb_build_array(zes, zd, zk, zet + zmv, znft - zmv)); end if;
    end if;
    zout := zout || jsonb_build_object(zid::text, jsonb_build_array(zes, zet, znft, zpl, zd, zk, zlz, znid));
  end loop;
  update mp_trains t set lay = null where t.route = rid and t.lay is not null and not (t.id = any(zids));
  update mp_trains t set lay = zout -> t.id::text where t.id = any(zids) and t.lay is distinct from zout -> t.id::text;
  -- 駅の番線が足りるか：折り返しを待つ編成（留置線へ行くものは 着いて3分・出る前の3分）と、駅に止まる列車（着いてから 出て1分まで）が、
  --   同じ時刻に 番線（通過線をのぞく）の数より多いと、そのとき来た この系統の列車に注意（折り返しを待つ編成が いるときだけ。ほかの系統の分も見る）
  if jsonb_typeof(zout) = 'object' and zout <> '{}'::jsonb then
    with ss as (select distinct (j.value ->> 0)::bigint s from jsonb_each(zout) j),
    lw as (select t.id, (t.lay ->> 0)::bigint s, (t.lay ->> 1)::int a, case when t.lay ->> 3 = '2' then (t.lay ->> 1)::int + zmv else (t.lay ->> 2)::int end b, (t.lay ->> 7)::bigint nx
             from mp_trains t where t.lay is not null and t.day is null and (t.lay ->> 0)::bigint in (select ss.s from ss)
           union all
           select t.id, (t.lay ->> 0)::bigint, (t.lay ->> 2)::int - zmv, (t.lay ->> 2)::int, (t.lay ->> 7)::bigint
             from mp_trains t where t.lay is not null and t.day is null and t.lay ->> 3 = '2' and (t.lay ->> 0)::bigint in (select ss.s from ss)),
    rs as (select ro.id from mp_routes ro where ro.stops && array(select ss.s from ss)),
    st as (select t.id, t.route, t.num, (e.v ->> 0)::bigint s, coalesce((e.v ->> 1)::int, (e.v ->> 2)::int) a, coalesce((e.v ->> 2)::int, (e.v ->> 1)::int) + 60 b
             from mp_trains t cross join lateral jsonb_array_elements(t.sched) with ordinality e(v, o)
            where t.route in (select rs.id from rs) and t.day is null and (e.v ->> 0)::bigint in (select ss.s from ss)
              and not exists (select 1 from lw where lw.id = t.id and e.o = jsonb_array_length(t.sched))
              and not exists (select 1 from lw where lw.nx = t.id and e.o = 1)),
    ev as (select lw.s, lw.a tm, 1 dl, null::bigint id from lw union all select lw.s, lw.b, -1, null from lw
           union all select st.s, st.a, 1, st.id from st union all select st.s, st.b, -1, null from st),
    oc as (select ev.*, sum(ev.dl) over (partition by ev.s order by ev.tm, ev.dl rows unbounded preceding) n from ev),
    cp as (select zs.id s, zs.name, greatest(1, (select count(*) from jsonb_array_elements(_mp_sta_trk(zs)) v where coalesce(v ->> 'm', 'main') <> 'pass'))::int n
             from mp_stations zs where zs.id in (select ss.s from ss)),
    w as (select distinct oc.id, cp.name from oc join cp on cp.s = oc.s
           where oc.dl = 1 and oc.id is not null and oc.n > cp.n
             and exists (select 1 from lw where lw.s = oc.s and lw.a <= oc.tm and oc.tm < lw.b))
    update mp_trains t set warn = concat_ws(' / ', t.warn, format('%s で 番線が足りません（折り返しを待つ編成で うまっています。留置線か 番線を足してください）', w.name))
      from w where t.id = w.id and t.route = rid;
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
  perform _mp_lay_set(rid);   -- 折り返しを待つ・駅の番線の数（DB の更新105）
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

-- 留置線をつくる（DB の更新105）：自分の駅の近く（駅と留置線の はしの あいだが 500m まで）の、自分の線路の横に、線路をなぞって
--   （長さ 40〜600m・20m 単位、1〜8本）。折り返しで 8分以上 待つ編成（留置線に入る長さのもの）は、ホームをふさがずに 留置線で待つ。
--   車両は置けない（車両基地ではない）。工事費：500万 X ＋ 長さ（m）× 本数 × 1万 X（国は無料）。維持費は 小さい車庫と同じ。他人の土地は 使用料か許可
create or replace function public.mp_tome_build(p_sta bigint, p_seg bigint, p_x real, p_y real, p_side int, p_len int, p_n int, p_as text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; st mp_stations; sg mp_segs; q record; s real; lt real; wt real; gap real; dim real[]; cap int; cost numeric; tiles int[]; ters text[]; bad text; lq record;
        did bigint; pt record; dcells int[]; side int := case when p_side < 0 then -1 else 1 end; need jsonb; sz text; nm text; zn int;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  select * into st from mp_stations where id = p_sta;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_same(st.own_u, st.own_c, st.own_u is null and st.own_c is null, pa.pu, pa.pc, pa.gv) then raise exception '留置線は 自分（この名義）の駅につくります'; end if;
  select * into sg from mp_segs where id = p_seg;
  if not found then raise exception '線が見つかりません'; end if;
  if sg.kind <> 'rail' or not _mp_same(sg.own_u, sg.own_c, sg.gov, pa.pu, pa.pc, pa.gv) then raise exception '留置線は自分（この名義）の線路の横に作ります'; end if;
  if p_len is null or p_len < 40 or p_len > 600 or p_len % 20 <> 0 then raise exception '留置線の長さは20m単位で、40〜600mです'; end if;
  if p_n is null or p_n < 1 or p_n > 8 then raise exception '留置線は1〜8本です'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y); s := q.s;
  if q.dist > 1.2 then raise exception '線の上をえらんでください'; end if;
  if not pa.gv and _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]) is not null then
    raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', _mp_lic_need(pa.pu, pa.pc, array[floor(p_x)::int, floor(p_y)::int]);
  end if;
  sz := format('R%sx%s', p_len, p_n);
  dim := _mp_dep_dim('rail', sz); lt := dim[1]; wt := dim[2]; gap := dim[3]; cap := dim[4]::int;
  -- 駅の近く：駅のまん中と留置線のまん中が（ホームの半分＋留置線の半分＋500m）まで
  select * into pt from _mp_at(sg.pts, s);
  if sqrt(power(pt.x - st.x / 100.0, 2) + power(pt.y - st.y / 100.0, 2)) > st.plat / 100.0 + lt / 2 + 10 then raise exception '留置線は 駅の近く（駅から 500m まで）につくります'; end if;
  cost := case when pa.gv then 0 else 5000000 + p_len * p_n * 10000 end;
  if s - lt / 2 < 0.2 or s + lt / 2 > sg.len - 0.2 then raise exception '線のはしからはみ出します'; end if;
  if exists (select 1 from mp_stations t where t.seg = p_seg and abs(t.at - s) < (t.plat / 50.0 + lt) / 2 + 0.2) then raise exception 'ホームの横には つくれません（ホームの はしより先に つくってください）'; end if;
  tiles := _mp_dep_tiles_g(sg.pts, s, side, lt, wt, gap);
  ters := _mp_ters(tiles);
  if '?' = any(ters) or 'D' = any(ters) or 'S' = any(ters) or 'R' = any(ters) or 'L' = any(ters) then raise exception '水の上や地図のないところには作れません'; end if;
  select string_agg(distinct o.x || ',' || o.y, ' ') into bad from mp_occ o
    join (select tiles[2 * i - 1] x, tiles[2 * i] y from generate_series(1, array_length(tiles, 1) / 2) i) t on t.x = o.x and t.y = o.y
   where not (o.what = sg.kind and o.ref = p_seg);
  if bad is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', left(bad, 60); end if;
  if sg.prof is not null and abs(_mp_pz(sg.prof, s) - _mp_gz(pt.x, pt.y)) > 5 then raise exception '留置線は、線が地面の高さのところに作ります（高架・地下・橋のところには作れません）'; end if;
  dcells := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_dep_cells(pt.x, pt.y, pt.ang, side, 'rail', sz) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  if _mp_bld_hit(dcells) is not null then raise exception '道路・線路・建物などのあるマスには作れません（%）。反対側か、ほかの場所にしてください', _mp_bld_hit(dcells); end if;
  select * into lq from _mp_lease_quote(dcells, pa.pu, pa.pc, pa.gv);
  need := _mp_land_need(dcells, pa.pu, pa.pc, pa.gv);
  zn := (select count(*) from mp_depots d where d.sta = st.id and d.size like 'R%');
  nm := left(format('%s 留置線%s', st.name, case when zn > 0 then (zn + 1)::text else '' end), 20);
  if p_dry then return jsonb_build_object('cost', round(cost), 'lease', round(lq.fee), 'cap', cap, 'tiles', array_length(tiles, 1) / 2, 'name', nm,
    'up_day', case when pa.gv then 0 else round(_mp_rate('up_dep')) end, 'need', need); end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, round(cost)::bigint, 'dep', format('留置線「%s」の工事', nm));
  insert into mp_depots(kind, seg, at, side, size, x, y, ang, cap, name, own_u, own_c, cost, sta)
  values ('rail', p_seg, s, side, sz, round(pt.x * 100), round(pt.y * 100), pt.ang, cap, nm, pa.pu, pa.pc, round(cost), st.id)
  returning id into did;
  perform _mp_occ_set(did, 'dep', tiles);
  perform _mp_lease_set('dep', did, pa.pu, pa.pc, pa.gv);
  perform _mp_chg('dep', did, 'set', box(point(pt.x - greatest(8, lt / 2 + gap + wt + 1), pt.y - greatest(8, lt / 2 + gap + wt + 1)),
                                         point(pt.x + greatest(8, lt / 2 + gap + wt + 1), pt.y + greatest(8, lt / 2 + gap + wt + 1))));
  -- この駅に止まる系統の時刻を組みなおす（折り返しを待つ編成が 留置線へ）
  perform _mp_resched(ro.id) from mp_routes ro where st.id = any(ro.stops) and ro.kind = 'rail' and ro.own_u is not distinct from pa.pu and ro.own_c is not distinct from pa.pc;
  return jsonb_build_object('id', did, 'cost', round(cost), 'cap', cap, 'name', nm);
end $$;

-- 留置線には車両を置けない（DB の更新105。車両基地ではない）
create or replace function public._mp_cars_tome_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.depot is not null and exists (select 1 from mp_depots d where d.id = new.depot and d.size like 'R%') then
    raise exception '留置線には車両を置けません（車両基地をえらんでください）';
  end if;
  return new;
end $$;

-- 留置線には除雪車を置けない（DB の更新105）
create or replace function public._mp_dep_tome_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.size like 'R%' and coalesce(new.plows, 0) > 0 then raise exception '留置線には除雪車を置けません'; end if;
  return new;
end $$;

create or replace function public.mp_cars_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pa record;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  return jsonb_build_object(
    'cars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'num', c.num, 'role', t.role, 'face', t.face, 'label', t.label, 'depot', c.depot, 'form', c.form, 'pos', c.pos,
               'cond', round(c.cond::numeric), 'heat', c.heat, 'ac', c.ac, 'toilet', c.toilet, 'snow', c.snow, 'renewed', c.renewed,
               'age', floor(extract(epoch from now() - c.born) / 86400), 'life', t.life,
               'busy', case when c.busy_until > now() then c.busy_kind end, 'until', case when c.busy_until > now() then c.busy_until end, 'price', c.price,
               'xfer', exists (select 1 from mp_xfers x where x.st = 'offer' and c.id = any(x.cars)),
               'tmp', case when c.form is not null then c.tmp_until end)   -- 期間つき増結：入れ替え枠にもどる時刻（DB の更新80）
               order by c.depot, c.form nulls last, c.pos, c.num), '[]'::jsonb)
             from mp_cars c join mp_types t on t.code = c.type where c.own_u is not distinct from pa.pu and c.own_c is not distinct from pa.pc),
    'forms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'depot', f.depot, 'perf', _mp_form_perf(f.id),
               'trains', (select count(*) from mp_trains tr where tr.form = f.id),
               'op', (select jsonb_build_object('id', o.id, 'num', o.num) from mp_ops o where o.form = f.id),
               'xfer', (select x.id from mp_xfers x where x.form = f.id and x.st = 'offer' limit 1),
               -- 予備編成（DB の更新80）：subn 予備として代走する回・subby この編成のかわりに予備編成が走る回（これからのもの）
               'spare', f.spare, 'subn', (select count(*) from mp_subst s where s.sub = f.id and s.t1 > now()), 'subby', (select count(*) from mp_subst s where s.orig = f.id and s.t1 > now())) order by f.name), '[]'::jsonb)
             from mp_forms f where f.own_u is not distinct from pa.pu and f.own_c is not distinct from pa.pc),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'cap', d.cap, 'x', d.x, 'y', d.y,
               'n', (select count(*) from mp_cars c where c.depot = d.id), 'plows', d.plows, 'zone', _mp_snowzone_at(floor(d.x / 100.0)::int, floor(d.y / 100.0)::int), 'pub', d.own_u is null and d.own_c is null and not pa.gv) order by d.own_u is null and d.own_c is null, d.id), '[]'::jsonb)
             from mp_depots d where d.size not like 'R%' and ((d.own_u is not distinct from pa.pu and d.own_c is not distinct from pa.pc)   -- 留置線は のぞく（DB の更新105）
                                 or (d.kind = 'air' and d.bld is not null and _mp_gov_term(d.bld)))),   -- 国の空港の駐機場（みんなで使う。t54q）
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from mp_types t where t.on_sale),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ord), '[]'::jsonb) from mp_series s),
    'fsets', _mp_fset_json(u),   -- 編成のプリセット（DB の更新72）
    'lsplit', true);   -- 機関車と客車を別に注文する（DB の更新78）
end $$;

create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[]; adm boolean;
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
  adm := _is_admin(u);   -- 国の駅・車両基地・系統は、管理者のもの（DB の更新101）
  select jsonb_build_object(
    'segs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(_mp_thin(s.pts, case p_lod when 0 then 1 when 1 then 3 when 2 then 8 else 16 end)), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
                  'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.gov and _is_admin(u)), 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1),
                  'ctl', case when s.own_u = u or s.own_c = any(me_cs) or (s.gov and _is_admin(u)) then to_jsonb(s.ctl) end)
                  || case when s.snowp > 0 then jsonb_build_object('sp', s.snowp) else '{}'::jsonb end
                  || case when s.prof is not null and p_lod <= 1 then jsonb_build_object('pf', to_jsonb(s.prof), 'st', s.st) else '{}'::jsonb end   -- 高さ（t108）
                  || case when s.rack then jsonb_build_object('rk', 1) else '{}'::jsonb end || case when s.hm is not null then jsonb_build_object('hm', s.hm) else '{}'::jsonb end
                  || case when s.hopt is not null then jsonb_build_object('ho', s.hopt) else '{}'::jsonb end   -- 高さの数値（DB の更新84）
                  || case when s.sig > 0 then jsonb_build_object('sg', s.sig) else '{}'::jsonb end   -- 信号の段（DB の更新85）
                  || case when s.quad then jsonb_build_object('q', 1) else '{}'::jsonb end   -- 複々線（DB の更新86）
                  || case when s.elec and s.ps > 0 then jsonb_build_object('ps', s.ps) else '{}'::jsonb end   -- 電化方式（DB の更新87）
                  || case when s.kind = 'rail' and (s.gauge <> 1067 or s.g2 is not null or s.slp <> 0 or (s.elec and s.cat <> 0) or s.nw <> 0)
                          then jsonb_strip_nulls(jsonb_build_object('ga', nullif(s.gauge, 1067), 'g2', s.g2, 'sl', nullif(s.slp, 0), 'ct', case when s.elec then nullif(s.cat, 0) end, 'nw', nullif(s.nw, 0)))
                          else '{}'::jsonb end   -- 線路の規格（DB の更新99）
                  || case when s.kind = 'rail' and s.elec then jsonb_strip_nulls(jsonb_build_object('fd', _mp_feed(s.id))) else '{}'::jsonb end), '[]'::jsonb)   -- 電気をとどける変電所（DB の更新89）
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))
                 and (p_lod < 3 or s.kind = 'rail' or s.cls = 'exp')),   -- lod 3（とても遠く。t108）：線路と高速だけ
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where p_lod < 3 and (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false) or (s.own_u is null and s.own_c is null and adm), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld, 'st', d.sta,   -- st：留置線の駅（DB の更新105）
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false) or (d.own_u is null and d.own_c is null and adm)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false) or (r.own_u is null and r.own_c is null and adm),
                  'w', (select coalesce(jsonb_agg(l -> 'w'), '[]'::jsonb) from jsonb_array_elements(r.legs) l))), '[]'::jsonb)
               from mp_routes r where r.kind in ('ship', 'air') and r.bb && b),   -- t54p：空の路線も
    -- 滑走路（t57）：両はし [x0, y0, x1, y1]（1/100 マス）・はば（マス）・番号・長さ・空港
    'rwys', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'p', jsonb_build_array(r.x0, r.y0, r.x1, r.y1), 'w', r.w, 'n', r.name, 'len', r.len, 'st', r.st,
                  'sn', (select s.name from mp_stations s where s.id = r.st))), '[]'::jsonb)
               from mp_rwys r where box(point(least(r.x0, r.x1) / 100.0, least(r.y0, r.y1) / 100.0), point(greatest(r.x0, r.x1) / 100.0, greatest(r.y0, r.y1) / 100.0)) && b),
    -- 筆：[id, 行ごとの区画のならび [y, x0, x1, …], 1 他人・2 自分・3 国, 売り出し, 建物, 地番, 持ち主のキー]
    'parcels', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pa.id,
                  (select jsonb_agg(v order by rn.y, rn.x0, u.o) from (
                      select y, min(x) x0, max(x) x1 from (select x, y, x - row_number() over (partition by y order by x) g from mp_pcells where parcel = pa.id) z group by y, g) rn,
                     lateral unnest(array[rn.y, rn.x0, rn.x1]) with ordinality u(v, o)),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, pa.sale, pa.bld, _mp_ban(pa.ban, pa.eda),
                  case when pa.gov then 'gov' when pa.own_u is not null then 'u:' || pa.own_u else 'c:' || pa.own_c end)), '[]'::jsonb)
               from mp_parcels pa where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国, 見た目（1〜10。null は自動）, 向き（0〜345度。null は自動）,
    --        1階のお店の看板の色（部屋の番号の順に [c1, c2, c3] か null。どれも決めていなければ null）]（DB の更新103）
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end, b.look, b.rot,
                  (select case when bool_or(x.sc is not null) then jsonb_agg(to_jsonb(x.sc) order by x.no) end from mp_units x where x.bld = b.id and x.floor = 1 and x.use = 'shop'))), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
    -- 小物（DB の更新103）：[id, 種類, x, y（1/100 マス）, 向き, 色, 1 自分の]
    'props', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(pr.id, pr.kind, pr.x, pr.y, pr.rot, pr.col,
                  case when (pa.gov and adm) or coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 1 else 0 end)), '[]'::jsonb)
               from mp_props pr join mp_parcels pa on pa.id = pr.parcel where pr.x >= p_x0 * 100 and pr.x < p_x1 * 100 and pr.y >= p_y0 * 100 and pr.y < p_y1 * 100) end,
    'places', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'k', p.k, 'n', p.name, 'x', p.x, 'y', p.y, 't', p.type, 'pop', p.pop, 'par', p.parent)
                  || case when p.k = 'island' then jsonb_build_object('sz', (p.extra ->> 'n')::int) else '{}'::jsonb end), '[]'::jsonb)   -- 島（t54k2）：sz＝陸のマスの数
               from mp_places p where p.pt <@ b and p.k in ('pref', 'muni', 'ward', 'river', 'spot', 'island') and (p_lod < 2 or p.k in ('pref', 'muni')) and (p_lod < 3 or p.k = 'pref')),
    -- 町字の名前：[id, 種類, 名前, x, y]（町・大字は lod 1 から、丁目・字は lod 0）
    'chos', (select coalesce(jsonb_agg(jsonb_build_array(m.id, m.kind, m.name, m.x, m.y)), '[]'::jsonb)
               from mp_cho m where m.pt <@ b and m.gone is null and (p_lod = 0 or (p_lod = 1 and m.kind in ('cho', 'oaza')))),
    'names', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
               select distinct 'u:' || pa.own_u k, (select nickname from profiles where id = pa.own_u) v from mp_parcels pa where p_lod = 0 and pa.own_u is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'c:' || pa.own_c, (select name from companies where id = pa.own_c) from mp_parcels pa where p_lod = 0 and pa.own_c is not null and pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))
               union select distinct 'u:' || s.own_u, (select nickname from profiles where id = s.own_u) from mp_segs s where s.own_u is not null and s.bb && b
               union select distinct 'c:' || s.own_c, (select name from companies where id = s.own_c) from mp_segs s where s.own_c is not null and s.bb && b) z where v is not null),
    -- アトラクション（DB の更新91）：[id, 建物, 種類, x, y（マス）]
    'attrs', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(a.id, a.bld, a.kind, round(a.x::numeric, 2), round(a.y::numeric, 2))), '[]'::jsonb)
               from mp_attrs a where a.x between p_x0 - 2 and p_x1 + 2 and a.y between p_y0 - 2 and p_y1 + 2) end,
    -- 変電所（DB の更新89）：[id, 場所, 名前, 方式, 大きさ, 容量, 負荷, 止まっている, 自分の, 持ち主のキー]
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'x', ss.x, 'y', ss.y, 'n', ss.name, 'ps', ss.ps, 'sz', ss.sz, 'cap', ss.cap, 'ld', ss.load,
                  'tr', coalesce(ss.trip > now(), false), 'mine', coalesce(ss.own_u = u or ss.own_c = any(me_cs), false) or (ss.gov and _is_admin(u)),
                  'o', case when ss.gov then 'gov' when ss.own_u is not null then 'u:' || ss.own_u else 'c:' || ss.own_c end)), '[]'::jsonb)
               from mp_subs ss where p_lod < 2 and ss.x between (p_x0 - 3) * 100 and (p_x1 + 3) * 100 and ss.y between (p_y0 - 3) * 100 and (p_y1 + 3) * 100),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1, 'park2', 1, 'spec', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）・park2：テーマパークとアトラクション（DB の更新91）
  return r;
end $$;

create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean;
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'color', r.color, 'mine', mine, 'gov', r.own_u is null and r.own_c is null, 'ok', r.ok, 'why', r.why, 'dwell', r.dwell,
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
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats, 'hpat', case when mine then r.hpat end,   -- hpat：1時間の型（DB の更新104）
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'lay', t.lay,   -- 折り返しを待つ（DB の更新105）
                 'fser', fi.ser, 'fn', fi.n, 'fpw', case when fi.n > 0 then case when fi.fel then coalesce(fi.fps, 0) else 0 end end,   -- 編成の電化方式（DB の更新104：0 非電化・1 直流・2 交流50Hz・4 交流60Hz を足したもの。null は編成なし）   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk,
                                                          bool_or(ty.elec) fel, bit_and(ty.ps::int) filter (where ty.elec) fps
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;

drop trigger if exists mp_cars_tome on public.mp_cars;
create trigger mp_cars_tome before insert or update of depot on public.mp_cars for each row execute function public._mp_cars_tome_trg();
drop trigger if exists mp_depots_tome on public.mp_depots;
create trigger mp_depots_tome before update of plows on public.mp_depots for each row execute function public._mp_dep_tome_trg();

revoke all on function public._mp_lay_set(bigint) from public, anon, authenticated;
revoke all on function public._mp_cars_tome_trg() from public, anon, authenticated;
revoke all on function public._mp_dep_tome_trg() from public, anon, authenticated;
revoke all on function public.mp_tome_build(bigint, bigint, real, real, int, int, int, text, boolean) from public, anon;
grant execute on function public.mp_tome_build(bigint, bigint, real, real, int, int, int, text, boolean) to authenticated;
alter function public.mp_tome_build(bigint, bigint, real, real, int, int, int, text, boolean) set statement_timeout = '60s';

do $$ declare zr bigint; begin
  for zr in select ro.id from mp_routes ro where ro.kind = 'rail' and exists (select 1 from mp_trains t where t.route = ro.id and t.form is not null) order by ro.id loop
    perform _mp_lay_set(zr);
  end loop;
end $$;
