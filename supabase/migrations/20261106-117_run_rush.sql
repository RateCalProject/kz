-- DB の更新117：線路の改造も 国の強行・ダイヤがうまく作られていなくても 走ろうとする・通勤時間帯の混雑で 遅れる
--   国の強行（DB の更新116 のつづき）：線の設定（複線化・複々線化・車線。はばが建物にかかっても）・1本にする（アプト式のちがい・つなぎ目のカーブ）・
--   ホームの長さ・番線の数（ホームのカーブ・ホームにかかる建物）。mp_seg_opts・mp_seg_merge・mp_seg_join・mp_sta_resize に p_force（国の線・駅・管理者だけ）。
--   国の線の「1本にする」「つなぎ目をまたぐ」（mp_seg_join）が 管理者でも できなかったのを直す
--   走ろうとする：編成が まにあわない列車（前の列車の終点から2分ない・編成が ほかの駅にいる・補給がたりない）も 走れない列車（bad）にしない。
--   遅れて出る（mp_trains.lag 秒。回送して まにあう時刻まで・1時間まで。補給は とちゅうで 20分）。遅れは 走るあいだに 1秒に 0.1秒ずつ取りもどす。
--   編成のない列車だけが 走れない（bad）
--   通勤時間帯の混雑：平日（土日・祝日の休みをのぞく）の 7〜10時・17〜20時に、こんでいる鉄道の系統は 全線で少しおそくなる（遅れる。いちばん 12%）。
--   こみぐあいは 前の日の その時間の乗車率（mp_routes.rush。80% から・150% でいちばん。9時台・19時台は 6割）。AI の運行の乱れをオフにした名義の系統は なし

alter table public.mp_trains add column if not exists lag int not null default 0;   -- 走ろうとする（DB の更新117）：遅れて出る秒（編成が まにあわない・補給）
alter table public.mp_routes add column if not exists rush jsonb;   -- 通勤時間帯の混雑（DB の更新117）：{始まりの時: 速さ（1 より小さい）}（鉄道。7・8・9・17・18・19時）

-- 形が変わる関数：前の形を消す
drop function if exists public._mp_run_mark(bigint, int, text);
drop function if exists public._mp_unko_trn(jsonb, bigint[], jsonb, jsonb, int, float8, bigint, float8);
drop function if exists public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int);
drop function if exists public._mp_seg_join2(bigint, bigint);
drop function if exists public.mp_seg_join(bigint, bigint);
drop function if exists public.mp_seg_merge(bigint, bigint, bigint, boolean);
drop function if exists public.mp_sta_resize(bigint, int, int, boolean);

-- 休みの日（土日・正月・GW・お盆・年末。道路の渋滞 _mp_jam_tick と同じ）
create or replace function public._mp_offday(d date) returns boolean
language sql immutable as $$
  select extract(dow from d) in (0, 6) or to_char(d, 'MM-DD') in ('01-01', '01-02', '01-03', '04-29', '05-03', '05-04', '05-05', '08-13', '08-14', '08-15', '08-16', '12-29', '12-30', '12-31')
$$;
revoke all on function public._mp_offday(date) from public, anon, authenticated;
-- 通勤時間帯の混雑（DB の更新117）：始まりの時 hs（7・8・9・17・18・19）の1時間の 乗った人・定員から、その時間の速さ（1 なら遅れない。いちばん 0.88）
--   乗車率（乗った人 ÷ 定員の2倍。地図の「乗車率」と同じ）が 80% から・150% でいちばん。9時台・19時台は 6割
create or replace function public._mp_rush_rate(hs int, served bigint, cap bigint) returns real
language sql immutable as $$
  select case when cap is null or cap <= 0 or served is null or hs not in (7, 8, 9, 17, 18, 19) then 1
              else round((1 - 0.12 * least(1, greatest(0, (served::float8 / (2 * cap) - 0.8) / 0.7)) * case when hs in (9, 19) then 0.6 else 1 end)::numeric, 2) end::real
$$;
revoke all on function public._mp_rush_rate(int, bigint, bigint) from public, anon, authenticated;
-- 通勤時間帯の混雑の窓（_mp_unko_rt と同じ形 [はじめ, おわり, 速さ, 0, 1（全線）, 0]）：rush（{時: 速さ}）・ta〜tb（1970年からの秒）にかかる 平日の分
create or replace function public._mp_rush_w(rush jsonb, ta float8, tb float8) returns jsonb
language plpgsql stable as $$
declare zd float8; zk text; zv text; za float8; zo jsonb := '[]'::jsonb;
begin
  if rush is null or jsonb_typeof(rush) <> 'object' or ta is null or tb is null then return zo; end if;
  zd := floor((ta + 32400) / 86400) * 86400 - 32400 - 86400;   -- 前の日の 0時（日本時間）から
  while zd < tb loop
    if not _mp_offday((to_timestamp(zd + 43200) at time zone 'Asia/Tokyo')::date) then
      for zk, zv in select key, value from jsonb_each_text(rush) order by key::int loop
        za := zd + zk::int * 3600;
        if za + 3600 > ta and za < tb and zv::float8 < 1 then zo := zo || jsonb_build_array(jsonb_build_array(za, za + 3600, zv::float8, 0, 1, 0)); end if;
      end loop;
    end if;
    zd := zd + 86400;
  end loop;
  return zo;
end $$;
revoke all on function public._mp_rush_w(jsonb, float8, float8) from public, anon, authenticated;

-- 走ろうとする（DB の更新117）：前の走りが 駅 lsta に lt（その日の秒）に着く編成が、駅 fs を ft に出る列車に入るとき、遅れて出る秒（0〜3600）。
--   同じ駅なら 着いてから2分。ちがう駅なら 回送（まっすぐの長さ × 1.3 を 60km/h）＋2分
create or replace function public._mp_run_lag(lsta bigint, lt int, fs bigint, ft int) returns int
language sql stable set search_path = public as $$
  select case when lsta is null or lt is null or ft is null then 0
              else least(3600, greatest(0, lt + 120 - ft + case when fs = lsta then 0 else
                     coalesce((select ceil(sqrt(((a.x - b.x) / 100.0) ^ 2 + ((a.y - b.y) / 100.0) ^ 2) * 50 * 1.3 / 16.7)::int
                                 from mp_stations a, mp_stations b where a.id = lsta and b.id = fs), 600) end))::int end
$$;
revoke all on function public._mp_run_lag(bigint, int, bigint, int) from public, anon, authenticated;
-- 走ろうとする（DB の更新117）：【編成】の注意の おわり（前は「（走れません）」）
create or replace function public._mp_lag_txt(zl int, other boolean) returns text
language sql immutable as $$
  select case when coalesce(other, false) then case when zl >= 60 then format('（回送して、約%s分 遅れて走ります）', round(zl / 60.0)) else '（回送して走ります）' end
              else format('（約%s分 遅れて走ります）', greatest(1, round(zl / 60.0))) end
$$;
revoke all on function public._mp_lag_txt(int, boolean) from public, anon, authenticated;

create or replace function public._mp_run_mark(tid bigint, ci int, w text, zl int default null) returns void
language plpgsql set search_path = public as $$
begin
  if ci = 0 then   -- 走ろうとする（DB の更新117）：編成が まにあわなくても走る（bad にしない）。zl：遅れて出る秒（null は いまのまま）
    update mp_trains set bad = false, lag = coalesce(zl, lag),
           warn = nullif(concat_ws(' / ', nullif(regexp_replace(coalesce(warn, ''), '( / )?【(編成|補給)】[^/]*', '', 'g'), ''), w), '') where id = tid;
  else
    update mp_trains set cplx = jsonb_set(cplx, array[(ci - 1)::text], (cplx -> (ci - 1)) || jsonb_build_object('ok', w is null, 'w', w))
     where id = tid and jsonb_array_length(cplx) >= ci;
  end if;
end $$;

create or replace function public._mp_resched(rid bigint) returns void
language plpgsql set search_path = public as $$
declare tr mp_trains; a record; b record; r mp_routes; w text; fid bigint; lsta bigint; lt int; lnum text; dd date; ldated bigint; ldci int; pass int;
        sk jsonb; wl real; cl real; sr jsonb; stw boolean;   -- 蒸気機関車の補給（DB の更新78）
        zl int; zlg int;   -- 走ろうとする（DB の更新117）：遅れて出る秒・前の走りの おわりの遅れ
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
  update mp_trains set bad = true, lag = 0 where route = rid and form is null;
  -- 編成のつながり：編成ごとに時刻の順に見て、前に走る列車の終点から2分以上あけて出られるか。まにあわない列車も 走ろうとする（DB の更新117）：
  --   回送して まにあう時刻まで 遅れて出る（lag。1時間まで。前は bad で走れなかった）。遅れは 走るあいだに 1秒に 0.1秒ずつ取りもどす（つぎの列車にもひびく）
  --   連結（cplx）も、その編成の走りとして見る（つなぐ駅を出てから、切りはなす駅に着くまで）。まにあわない連結は、つながない（ok = false）
  --   連結する列車が走るかどうかは、ほかの編成の結果で決まるので、2回まわす
  for pass in 1..2 loop
    for fid in select z.f from (select distinct form f from mp_trains where route = rid and form is not null
                                union select distinct (c ->> 'f')::bigint from mp_trains t, jsonb_array_elements(t.cplx) c where t.route = rid and (c ->> 'v')::boolean) z
                order by z.f loop
      -- 毎日の列車
      lsta := null; lt := null; lnum := null; zlg := 0;
      sk := _mp_form_steam(fid); wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;   -- 蒸気機関車（DB の更新78）：1日のはじめは水も石炭も満タン
      for a in select * from _mp_form_runs(fid) x where x.day is null order by x.ft, x.tid, x.ci loop
        if a.ci > 0 and a.hb then perform _mp_run_mark(a.tid, a.ci, 'この列車が走らないので、連結しません'); continue; end if;
        w := _mp_run_check(lsta, lt + zlg, lnum, a.fs, a.ft, a.ci > 0); zl := 0;
        if w is not null and a.ci = 0 then   -- 走ろうとする（DB の更新117）：前の列車の終点から 回送して まにあう時刻まで 遅れて出る
          zl := _mp_run_lag(lsta, lt + zlg, a.fs, a.ft);
          w := replace(w, '（走れません）', _mp_lag_txt(zl, a.fs <> lsta));
        end if;
        if (w is null or a.ci = 0) and sk is not null then   -- 補給（DB の更新78）：止まる駅の給水・給炭で、駅のあいだを走りきれるか
          sr := _mp_steam_run(a.tid, a.fs, a.es, (sk ->> 'w')::real, (sk ->> 'c')::real, wl, cl);
          if sr ->> 'w' is null then wl := (sr ->> 'wl')::real; cl := (sr ->> 'cl')::real;
          elsif a.ci > 0 then w := replace(sr ->> 'w', '【補給】', '') || '（連結しません）';
          else   -- 走ろうとする（DB の更新117）：とちゅうで補給して 20分 遅れる。そのあとは満タン
            w := concat_ws(' / ', w, sr ->> 'w', '【補給】とちゅうで補給して、約20分 遅れて走ります'); zl := zl + 1200;
            wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;
          end if;
        end if;
        zl := least(zl, 3600);
        perform _mp_run_mark(a.tid, a.ci, w, zl);
        if a.ci = 0 then lsta := a.es; lt := a.et; lnum := a.num; zlg := greatest(0, zl - floor(0.1 * greatest(0, a.et - a.ft)))::int;   -- 走る（遅れは 着くまでに 取りもどす分だけ へる）
        elsif w is null then lsta := a.es; lt := a.et; lnum := a.num; zlg := 0; end if;
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
            zl := 0;
            if w is not null and a.ci = 0 then   -- 走ろうとする（DB の更新117）
              if stw then w := concat_ws(' / ', w, '【補給】とちゅうで補給して、約20分 遅れて走ります'); zl := 1200; wl := (sk ->> 'w')::real; cl := (sk ->> 'c')::real;
              else zl := _mp_run_lag(lsta, lt, a.fs, a.ft); w := replace(w, '（走れません）', _mp_lag_txt(zl, a.fs <> lsta)); end if;
            end if;
            perform _mp_run_mark(a.tid, a.ci, w, least(zl, 3600));
            if w is null or a.ci = 0 then lsta := a.es; lt := a.et; lnum := a.num; ldated := a.tid; ldci := a.ci; end if;
          else
            if w is not null and ldated is not null then
              perform _mp_run_mark(ldated, ldci, format(case when ldci > 0 then case when stw then 'この臨時列車のあと、%s の水か石炭がたりなくなります（連結しません）' else 'この臨時列車のあと、%s にまにあいません（連結しません）' end
                                                             else case when stw then '【補給】この臨時列車のあと、%s の水か石炭がたりなくなります（そのまま走ります）' else '【編成】この臨時列車のあと、%s にまにあいません（そのまま走ります）' end end, a.num));   -- 走ろうとする（DB の更新117）
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
      if upc is not null or coalesce(tr.lag, 0) > 0 then   -- 乱れの区間を通る列車・遅れて出る列車（DB の更新117）だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt, coalesce(tr.lag, 0)::float8); exception when others then ev := null; end;
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
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'shop', nwk, 'trust', round(r.trust::numeric, 2)),
                           rush = case when r.rush ? (((hh + 23) % 24)::text) then nullif(r.rush - (((hh + 23) % 24)::text), '{}'::jsonb) else r.rush end where id = r.id;   -- 通勤時間帯の混雑（DB の更新117）：走らなければ なし
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
    -- 通勤時間帯の混雑（DB の更新117）：この1時間（始まりが 7・8・9・17・18・19時）の乗車率から、あしたからの その時間の速さ（鉄道）
    if r.kind = 'rail' and ((hh + 23) % 24) in (7, 8, 9, 17, 18, 19) then
      update mp_routes set rush = nullif(case when _mp_rush_rate((hh + 23) % 24, served, cap1 + cap2) < 1
                                             then coalesce(rush, '{}'::jsonb) || jsonb_build_object(((hh + 23) % 24)::text, _mp_rush_rate((hh + 23) % 24, served, cap1 + cap2))
                                             else coalesce(rush, '{}'::jsonb) - (((hh + 23) % 24)::text) end, '{}'::jsonb)
       where id = r.id;
    end if;
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
    perform _mp_earn(o.pu, o.pc, o.pu is null and o.pc is null, round(o.amt * case when _mp_unko_off(o.pu, o.pc) then 1 else 1.05 end)::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));   -- DB の更新73
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

create or replace function public._mp_unko_rt(rid bigint, ta float8, tb float8) returns jsonb
language plpgsql stable set search_path = public as $$
declare z mp_unko; out jsonb := '[]'::jsonb; w jsonb; zi jsonb; dr float8; zr jsonb;
begin
  for z in select * from mp_unko x where x.routes @> array[rid] and x.t0 < to_timestamp(tb) and coalesce(x.t_end, now() + interval '1 day') > to_timestamp(ta) order by x.id loop
    zi := _mp_unko_zi(z, rid);
    -- 迂回・区間折り返し（DB の更新82）：区間だけの見合わせ（速さ 0・全線でない）は、迂回できる系統は迂回の速さで走る。
    --   迂回しない系統は、折り返しにしたら6つめを 1（区間に入るはずの列車は、区間の外だけ走る）
    dr := case when zi is not null and z.det is not null and z.det ? rid::text then (z.det ->> rid::text)::float8 end;
    w := (select coalesce(jsonb_agg(jsonb_build_array((e ->> 0)::float8, (e ->> 1)::float8,
                                    case when dr is not null and (e ->> 2)::float8 = 0 and coalesce((e ->> 5)::int, 0) = 0 then dr else (e ->> 2)::float8 end,
                                    coalesce((e ->> 3)::int, 0), coalesce((e ->> 5)::int, 0),
                                    case when dr is null and zi is not null and z.ori and (e ->> 2)::float8 = 0 and coalesce((e ->> 5)::int, 0) = 0 then 1 else 0 end)
                                    order by (e ->> 0)::float8, (e ->> 1)::float8), '[]'::jsonb)
            from jsonb_array_elements(z.wins) e where (e ->> 1)::float8 > (e ->> 0)::float8 and (e ->> 2)::float8 < 1);
    if jsonb_array_length(w) = 0 then continue; end if;
    out := out || jsonb_build_array(jsonb_build_object('id', z.id, 'w', w, 'zi', zi));
  end loop;
  -- 通勤時間帯の混雑（DB の更新117）：平日の朝夕、こんでいる鉄道の系統は 全線で少しおそくなる（id 0）。AI の運行の乱れをオフにした名義は なし
  zr := (select _mp_rush_w(ro.rush, ta, tb) from mp_routes ro where ro.id = rid and ro.kind = 'rail' and ro.rush is not null and not _mp_unko_off(ro.own_u, ro.own_c));
  if zr is not null and jsonb_array_length(zr) > 0 then out := out || jsonb_build_array(jsonb_build_object('id', 0, 'w', zr, 'zi', null)); end if;
  return case when jsonb_array_length(out) = 0 then null else out end;
end $$;

create or replace function public._mp_unko_trn(L jsonb, st bigint[], legs jsonb, sc jsonb, dir int, d0 float8, tid bigint, te float8, z0 float8 default 0) returns jsonb
language plpgsql stable as $$
declare n int; ns int := coalesce(array_length(st, 1), 0); idx int[]; cum float8[]; t0 float8; bad boolean; fwd boolean;
        ia int[]; ar float8[]; dp float8[];
        xa float8[] := '{}'; xb float8[] := '{}'; xr float8[] := '{}'; xth boolean[] := '{}'; xza float8[] := '{}'; xzb float8[] := '{}'; xzc float8[] := '{}'; xrs float8[] := '{}'; xid bigint[] := '{}';
        zz jsonb; w jsonb; zi jsonb; cs float8; ce float8; rs float8; a float8; b float8; r float8; th boolean; wide boolean;
        xo boolean[] := '{}'; ori boolean; op float8 := null; oz bigint := null;
        ka int; kb int; k int; lo int; hi int; ea int; eb int; za float8; zb float8; i int; j int; m int;
        s float8; d float8; p float8; nx float8; pr float8; it int := 0; ze float8; can text := null; cz bigint := null;
begin
  n := jsonb_array_length(sc);
  if n < 2 or ((L is null or jsonb_array_length(L) = 0) and coalesce(z0, 0) <= 0) then return jsonb_build_object('can', null, 'dly', 0, 'z', null); end if;
  idx := _mp_sched_idx(st, dir, sc);
  bad := exists (select 1 from unnest(idx) q where q < 0);
  t0 := (sc -> 0 ->> 2)::float8;
  ar := array(select coalesce((v ->> 1)::float8, (v ->> 2)::float8) from jsonb_array_elements(sc) with ordinality x(v, o) order by o);
  dp := array(select coalesce((v ->> 2)::float8, (v ->> 1)::float8) from jsonb_array_elements(sc) with ordinality x(v, o) order by o);
  -- 系統の駅までの距離（m）
  cum := array[0::float8];
  for i in 1..greatest(ns - 1, 0) loop cum := cum || (cum[i] + coalesce((legs -> (i - 1) ->> 'd')::float8, 0)); end loop;
  fwd := idx[n] > idx[1];
  -- 窓を、この列車の区間の時刻つきに（区間がいくつかあれば、その数だけ）
  for zz in select v from jsonb_array_elements(L) with ordinality x(v, o) order by o loop
    zi := zz -> 'zi'; cs := null; ce := '-infinity';
    for w in select v from jsonb_array_elements(zz -> 'w') with ordinality x(v, o) order by o loop
      a := (w ->> 0)::float8; b := (w ->> 1)::float8; r := (w ->> 2)::float8; th := coalesce((w ->> 3)::int, 0) = 1; wide := coalesce((w ->> 4)::int, 0) = 1;
      ori := coalesce((w ->> 5)::int, 0) = 1;   -- 区間折り返し（DB の更新82）
      rs := a;
      if r = 0 then
        if cs is null or ce < a - 1 then cs := a; ce := b; else ce := greatest(ce, b); end if;
        rs := cs;
      end if;
      if wide or zi is null or jsonb_typeof(zi) <> 'array' or bad then
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (-1e9)::float8; xzb := xzb || 1e9::float8; xzc := xzc || 0::float8; xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint; xo := xo || false;
        continue;
      end if;
      for m in 0..jsonb_array_length(zi) - 1 loop
        ka := (zi -> m ->> 0)::int; kb := (zi -> m ->> 1)::int;
        lo := least(idx[1], idx[n]); hi := greatest(idx[1], idx[n]);
        ea := greatest(ka, lo); eb := least(kb, hi);
        if eb <= ea then continue; end if;
        za := null; zb := null;
        -- 区間に入る時刻（その駅を出る・通る）と、出る時刻（その駅に着く・通る）
        for j in 0..1 loop
          k := case when (j = 0) = fwd then ea else eb end;   -- j=0 入る駅・j=1 出る駅
          for i in 1..n loop
            if idx[i] = k then
              if j = 0 then za := dp[i]; else zb := ar[i]; end if;
              exit;
            end if;
            if i < n and ((idx[i] < k and k < idx[i + 1]) or (idx[i] > k and k > idx[i + 1])) then
              pr := case when cum[idx[i + 1] + 1] <> cum[idx[i] + 1] then (cum[k + 1] - cum[idx[i] + 1]) / (cum[idx[i + 1] + 1] - cum[idx[i] + 1])
                         else (k - idx[i])::float8 / (idx[i + 1] - idx[i]) end;
              if j = 0 then za := dp[i] + (ar[i + 1] - dp[i]) * pr; else zb := dp[i] + (ar[i + 1] - dp[i]) * pr; end if;
              exit;
            end if;
          end loop;
        end loop;
        if za is null or zb is null or zb <= za then continue; end if;
        xa := xa || a; xb := xb || b; xr := xr || r; xth := xth || th; xza := xza || (za - t0); xzb := xzb || (zb - t0); xzc := xzc || (za - t0); xrs := xrs || rs; xid := xid || (zz ->> 'id')::bigint; xo := xo || ori;
      end loop;
    end loop;
  end loop;
  m := coalesce(array_length(xa, 1), 0);
  if m = 0 and coalesce(z0, 0) <= 0 then return jsonb_build_object('can', null, 'dly', 0, 'z', null); end if;
  -- 運休（見合わせ・間引き）
  for i in 1..m loop
    ze := d0 + xzc[i];
    -- 区間折り返し（DB の更新82）：見合わせの窓に区間に入るはずの列車は、区間の外だけ走る（op：走るわりあい。始発駅を出てから終点に着くまでの時間で）
    if xr[i] = 0 and xo[i] and xa[i] <= ze and ze < xb[i] then
      if op is null then op := greatest(0, 1 - (xzb[i] - xza[i]) / greatest(1, ar[n] - t0)); oz := xid[i]; end if;
      continue;
    end if;
    if xr[i] = 0 and xa[i] <= ze and ze < xb[i] and d0 >= xrs[i] then can := 'stop'; cz := xid[i]; exit; end if;
    if xth[i] and tid % 2 = 1 and xa[i] <= ze and ze < xb[i] and d0 >= xa[i] then can := 'thin'; cz := xid[i]; exit; end if;
  end loop;
  if can is null and op is not null and op < 0.05 then can := 'stop'; cz := oz; end if;   -- 区間の外がほとんどない列車は運休
  if can is not null then return jsonb_build_object('can', can, 'dly', 0, 'z', cz); end if;
  -- 遅れ：区間にいるあいだは窓の速さ、そのほかは 1秒に 0.1秒ずつ取りもどす
  s := d0; d := greatest(0, coalesce(z0, 0));   -- 遅れて出る（DB の更新117。編成が まにあわない）
  while s < te - 1e-6 and it < 400 loop
    it := it + 1;
    p := s - d0 - d; r := 1; nx := te;
    for i in 1..m loop
      if not xo[i] and xa[i] <= s and s < xb[i] and xza[i] <= p + 1e-6 and p < xzb[i] - 1e-6 then r := least(r, xr[i]); end if;   -- 折り返しの窓では待たない（DB の更新82）
      if xa[i] > s then nx := least(nx, xa[i]); elsif xb[i] > s then nx := least(nx, xb[i]); end if;
    end loop;
    if r < 1 then
      if r > 0 then
        for i in 1..m loop
          if not xo[i] and xa[i] <= s and s < xb[i] then
            if p < xza[i] - 1e-6 then nx := least(nx, s + (xza[i] - p) / r);
            elsif p < xzb[i] - 1e-6 then nx := least(nx, s + (xzb[i] - p) / r); end if;
          end if;
        end loop;
      end if;
      d := d + (1 - r) * (nx - s); s := nx;
    else
      pr := case when d > 0 then 1.1 else 1 end;
      if d > 0 then nx := least(nx, s + d / 0.1); end if;
      for i in 1..m loop
        if not xo[i] and xa[i] <= s and s < xb[i] and p < xza[i] - 1e-6 then nx := least(nx, s + (xza[i] - p) / pr); end if;
      end loop;
      d := greatest(0, d - 0.1 * (nx - s)); s := nx;
    end if;
  end loop;
  return jsonb_build_object('can', null, 'dly', d, 'z', null) || case when op is not null then jsonb_build_object('ori', op, 'oz', oz) else '{}'::jsonb end;
end $$;

create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 3, 'aioff', case when gv then null else _mp_unko_off(pu, pc) end,
    'rush', (select coalesce(jsonb_agg(jsonb_build_array(ro.id, ro.rush) order by ro.id), '[]'::jsonb) from mp_routes ro
              where ro.ok and ro.kind = 'rail' and ro.rush is not null and not _mp_unko_off(ro.own_u, ro.own_c)),   -- 通勤時間帯の混雑（DB の更新117）：[系統, {時: 速さ}]（平日だけ）
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
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
    'me', (pu is not null or pc is not null or gv) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,   -- 国の線は名義「国」で（DB の更新101）
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') when z.own_u is null and _is_admin(u) then 'gov' end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'),
    -- 持ち主が決めた運休（1本：きのうから・編成ごと：おわって6時間まで）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]（DB の更新60）
    'cx', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.train, c.day, c.form, extract(epoch from c.t0), extract(epoch from e.t1), c.unko,
                    (pu is not null or pc is not null or gv) and c.own_u is not distinct from pu and c.own_c is not distinct from pc) order by c.id), '[]'::jsonb)
             from mp_cxl c left join mp_unko z2 on z2.id = c.unko
             cross join lateral (select coalesce(c.t1, case when z2.st = 'done' then greatest(z2.t_end, z2.t0 + make_interval(secs => z2.dur)) end) t1) e
            where c.ordk is null and ((c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours'))));   -- 運転整理の分は mp_dia で（DB の更新100）
end $$;

create or replace function public.mp_dia(p_route bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); r mp_routes; mine boolean; zlp int[];
begin
  perform _mp_ok(u);
  select * into r from mp_routes where id = p_route;
  if not found then raise exception '系統が見つかりません'; end if;
  mine := _mp_mine(u, r.own_u, r.own_c);
  zlp := _mp_leg_pw(r);   -- 線の電化（DB の更新106）
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
    'stops', (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'tracks', s.tracks, 'plat', s.plat, 'trk', _mp_sta_trk(s), 'x', s.x, 'y', s.y)
                               || case when s.memo is not null then jsonb_build_object('mm', s.memo, 'mo', _mp_pname(s.own_u, s.own_c, s.own_u is null and s.own_c is null)) else '{}'::jsonb end   -- 駅のメモと 駅の持ち主（DB の更新115）
                               order by o) from unnest(r.stops) with ordinality z(sid, o) join mp_stations s on s.id = z.sid),
    'kinds', _mp_kinds_of(r.own_u, r.own_c), 'pats', r.pats, 'hpat', case when mine then r.hpat end, 'agrp', case when mine then r.agrp end,   -- agrp：運用の あてる先（DB の更新106）   -- hpat：1時間の型（DB の更新104）
    'km', (select jsonb_agg(round((coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) with ordinality q(l, k) where k < o), 0) / 1000)::numeric, 2) order by o) from unnest(r.stops) with ordinality z(sid, o)),
    'legs', (select jsonb_agg(jsonb_build_object('d', l -> 'd', 'e', l -> 'e', 's', l -> 's', 'g', l -> 'g', 'w', l -> 'w')) from jsonb_array_elements(r.legs) l),   -- w：航路の折れ線（t54o）
    'trains', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'dir', t.dir, 'num', t.num, 'kind', t.kind, 'dep', t.dep, 'form', t.form, 'tt', t.tt, 'skip', to_jsonb(t.skip),
                 'sched', t.sched, 'warn', case when mine then t.warn end, 'fname', (select name from mp_forms where id = t.form),
                 'op', t.op, 'onum', (select num from mp_ops where id = t.op), 'day', t.day, 'bad', t.bad, 'lag', nullif(t.lag, 0), 'cpl', t.cpl, 'cplx', t.cplx, 'tai', t.tai, 'sa', t.sa, 'sb', t.sb,
                 'orig', t.orig, 'ordj', t.ordj,   -- 運転整理の列車（DB の更新100）：もとの毎日の列車・指示
                 'ordd', (select jsonb_agg(jsonb_build_array(c.day, c.ordk, c.id) order by c.day) from mp_cxl c where c.train = t.id and c.ordk is not null and c.day >= _mp_today() - 1),   -- その日は走らない［日, v（運転整理の列車が走る）か x（運休）, id］
                 'lay', t.lay,   -- 折り返しを待つ（DB の更新105）
                 'lpw', case when jsonb_array_length(t.sched) > 1 then _mp_train_lpw(r.stops, zlp, t.dir, (t.sched -> 0 ->> 0)::bigint, (t.sched -> (jsonb_array_length(t.sched) - 1) ->> 0)::bigint) end,   -- 走る線の電化（DB の更新106）
                 'fser', fi.ser, 'fn', fi.n, 'fpw', case when fi.n > 0 then case when fi.fel then coalesce(fi.fps, 0) else 0 end end,   -- 編成の電化方式（DB の更新104：0 非電化・1 直流・2 交流50Hz・4 交流60Hz を足したもの。null は編成なし）   -- 編成の形式（系列）と両数（列車一覧の絞り込み）
                 'wk', case when fi.wu is not null then jsonb_build_array(case when fi.wn then null else extract(epoch from fi.wf) end, extract(epoch from fi.wu)) end, 'wkk', fi.wkk,   -- 編成の工事中（DB の更新60）
                 'sub', (select jsonb_agg(jsonb_build_array(s.day, extract(epoch from s.t0)::bigint, sf.name) order by s.t0) from mp_subst s join mp_forms sf on sf.id = s.sub
                          where s.train = t.id and s.t1 > now() - interval '1 day')   -- 予備編成の代走（DB の更新80）：［運行日, 発車, 予備編成］
               ) || case when fi.fm is not null then jsonb_build_object('fm', fi.fm) else '{}'::jsonb end   -- fm：モデルのある系列の編成の形式（下り方から［形式, 役割, 向き］。DB の更新107）
               order by t.dir desc, t.dep), '[]'::jsonb)
               from mp_trains t left join lateral (select string_agg(distinct se.name, '+') ser, count(*) n,
                                                          min(c.busy_from) filter (where c.busy_until > now()) wf, max(c.busy_until) filter (where c.busy_until > now()) wu,
                                                          bool_or(c.busy_until > now() and c.busy_from is null) wn,
                                                          (array_agg(c.busy_kind order by c.busy_until desc) filter (where c.busy_until > now()))[1] wkk,
                                                          bool_or(ty.elec) fel, bit_and(ty.ps::int) filter (where ty.elec) fps,
                                                          case when bool_or(se.mdl is not null) then jsonb_agg(jsonb_build_array(ty.label, ty.role, ty.face) order by c.pos) end fm   -- 3D のモデル（DB の更新107）
                                                     from mp_cars c join mp_types ty on ty.code = c.type join mp_series se on se.code = ty.series
                                                    where t.form is not null and c.form = t.form) fi on true
              where t.route = r.id));
end $$;

create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null, p_quad boolean default null, p_ps int default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
        nq boolean; nd boolean; m0 numeric; m1 numeric; rid bigint; ne boolean; nps smallint;   -- ne・nps：電化・電化方式（DB の更新87）
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新117）
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  zfo := coalesce(p_force, false) and sg.gov and _is_admin(u);   -- 国の強行（DB の更新117）：はばが建物にかかっても 広げる
  ters := _mp_ters(_mp_tiles(sg.pts));
  if not sg.gov then mul := case when sg.st is null then _mp_cmuls(_mp_tiles(sg.pts), ters) else _mp_st_muls(sg.pts, ters, sg.st, sg.rack) end; end if;   -- 国の工事は無料（t57b）。縦断のある線は つくりの倍率（t108）
  nq := sg.kind = 'rail' and coalesce(p_quad, sg.quad);
  nd := sg.kind = 'rail' and (coalesce(p_dbl, sg.dbl) or nq);
  ne := sg.kind = 'rail' and coalesce(p_elec, sg.elec);
  nps := case when ne then case when coalesce(p_ps, sg.ps) = 3 then 3 else least(2, greatest(0, coalesce(p_ps, sg.ps))) end::smallint else sg.ps end;   -- 3：第三軌条（直流750V。DB の更新99）
  if sg.kind = 'rail' then
    base := _mp_rate('rail');
    m0 := _mp_trmul(sg.dbl, sg.quad); m1 := _mp_trmul(nd, nq);
    if not sg.gov then
      for i in 1..array_length(ters, 1) loop
        if m1 > m0 then amt_ := amt_ + base * mul[i] * (m1 - m0); end if;
        if coalesce(p_elec, sg.elec) and not sg.elec then amt_ := amt_ + _mp_rate('elec');
        elsif ne and sg.elec and nps <> sg.ps then amt_ := amt_ + _mp_rate('elec') * 0.6; end if;   -- 電化方式を変える（架線と変電の設備を取りかえる。DB の更新87）
      end loop;
    end if;
    what := case when nq and not sg.quad then '複々線化' when nd and not sg.dbl then '複線化' else '' end || case when coalesce(p_elec, sg.elec) and not sg.elec then '電化' when ne and sg.elec and nps <> sg.ps then '電化方式の変更' else '' end;
    nl := sg.lanes;
  else
    nl := coalesce(p_lanes, sg.lanes);
    if sg.cls = 'lane' then nl := 0; end if;
    nl := least(case when sg.cls = 'priv' then 2 else 4 end, greatest(case when sg.cls in ('exp', 'nat') then 2 else 0 end, nl));
    if nl > sg.lanes and not sg.gov then
      for i in 1..array_length(ters, 1) loop
        amt_ := amt_ + _mp_rate('road') * (_mp_road_mul(sg.cls, nl) - _mp_road_mul(sg.cls, sg.lanes)) * mul[i];
      end loop;
    end if;
    if nl > sg.lanes then what := format('拡幅（片側%s車線）', nl); end if;
  end if;
  amt_ := coalesce(round(amt_), 0);
  if (sg.kind = 'rail' and ((nd and not sg.dbl) or (nq and not sg.quad))) or (sg.kind = 'road' and nl > sg.lanes) then
    wc := _mp_seg_cells_arr(sg.pts, sg.kind, case when sg.kind = 'rail' then case when nq then 0.8 else 0.5 end else _mp_road_w(sg.cls, nl) end, nd);
    what2 := _mp_bld_hit(wc);
    if what2 is not null then
      if not zfo then raise exception '建物のある土地（%）にかかるので、はばを広げられません', left(what2, 60); end if;
      zfc := zfc || jsonb_build_array(jsonb_build_array('wb', left(what2, 60)));
    end if;
    -- 広げたところが他人の筆にかかるときは、貸出料があるか申請が許可されているときだけ
    need := _mp_land_need(wc, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  end if;
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need, 'quad', nq, 'ps', nps) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end; end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then nd else false end, quad = case when kind = 'rail' then nq else false end,
         elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end, ps = nps,
         cat = case when kind <> 'rail' then cat when nps = 3 then 6 when cat = 6 then 0 else cat end,   -- 第三軌条は 直流750V だけ（DB の更新99）
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when nq then 0.8 when nd then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c, array[p_id]); end if;   -- この線を通る系統だけ（DB の更新94）
  if sg.kind = 'rail' and (nq is distinct from sg.quad or nps is distinct from sg.ps) then   -- 複々線・電化方式（DB の更新87）：通る系統の時刻を計算しなおす（道すじは同じなので _mp_routes_fix ではしない）
    for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = p_id loop
      perform _mp_resched(rid);
    end loop;
  end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl, 'quad', nq, 'ps', nps);
end $$;

create or replace function public._mp_seg_join2(xid bigint, yid bigint, p_force boolean default false) returns bigint
language plpgsql set search_path = public as $$
declare x mp_segs; y mp_segs; nd bigint; xr boolean; yr boolean; px int[]; py int[]; pm int[]; lx real; jl real; n int; d real; fx real[]; fy real[]; fm real[];
begin
  select * into x from mp_segs where id = xid for update;
  select * into y from mp_segs where id = yid for update;
  if x.id is null or y.id is null or x.id = y.id or x.kind <> 'rail' or y.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  nd := case when x.n1 is not null and x.n1 in (y.n0, y.n1) then x.n1 when x.n0 is not null and x.n0 in (y.n0, y.n1) then x.n0 end;
  if nd is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if (select count(*) from mp_segs s where s.n0 = nd or s.n1 = nd) <> 2 then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
  if not (x.own_u is not distinct from y.own_u and x.own_c is not distinct from y.own_c and x.gov = y.gov) then raise exception 'ほかの会社の線路にはつなげません'; end if;
  if x.dbl <> y.dbl or x.elec <> y.elec then raise exception '単線と複線、電化と非電化がかわるところは、またげません（線路の設定をそろえてください）'; end if;
  if x.rack <> y.rack and not coalesce(p_force, false) then raise exception 'アプト式とそうでない線路のつなぎ目は、またげません（線路の高さの設定をそろえてください）'; end if;
  if x.elec and x.ps <> y.ps then raise exception '電化方式がかわるところ（デッドセクション）は、またげません'; end if;   -- DB の更新87
  if x.quad <> y.quad then raise exception '複線と複々線がかわるところは、またげません（線路の設定をそろえてください）'; end if;   -- DB の更新86
  if x.gauge <> y.gauge or x.g2 is distinct from y.g2 then raise exception '軌間のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;   -- DB の更新99
  if x.slp <> y.slp then raise exception '枕木のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.elec and x.cat <> y.cat then raise exception '架線のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.nw <> y.nw then raise exception '防音壁のちがう線路のつなぎ目は、またげません（「1本にする」で そろえてください）'; end if;
  if x.sig <> y.sig then raise exception '信号のちがう線路のつなぎ目は、またげません（線路の信号をそろえてください）'; end if;   -- DB の更新85
  if x.name <> '' and y.name <> '' and x.name <> y.name then raise exception '名前のちがう線路のつなぎ目は、またげません（線路の名前をそろえてください）'; end if;
  xr := x.n1 is distinct from nd;   -- x は nd で終わるように
  yr := y.n0 is distinct from nd;   -- y は nd から始まるように
  px := case when xr then _mp_rev(x.pts) else x.pts end;
  py := case when yr then _mp_rev(y.pts) else y.pts end;
  n := array_length(px, 1);
  d := sqrt(((py[1] - px[n - 1]) / 100.0) ^ 2 + ((py[2] - px[n]) / 100.0) ^ 2);
  pm := px || case when d < 0.03 then py[3:] else py end;
  lx := _mp_len(px); jl := lx + case when d < 0.03 then 0 else d end;
  if not coalesce(p_force, false) and _mp_minr(_mp_sub(pm, greatest(0, lx - 1.5), least(_mp_len(pm), lx + 1.5))) < 3 then raise exception 'つなぎ目のカーブがきつすぎて、またげません'; end if;   -- 国の強行（DB の更新117）はまたぐ
  -- 高さ（t108）：縦断もつなぐ（縦断のないほうは地面どおり）
  if x.prof is not null or y.prof is not null then
    fx := case when x.prof is null then _mp_prof_ground(px) when xr then _mp_prof_rev(x.prof, x.len) else x.prof end;
    fy := case when y.prof is null then _mp_prof_ground(py) when yr then _mp_prof_rev(y.prof, y.len) else y.prof end;
    fm := _mp_prof_cat(fx, fy, jl);
  end if;
  -- 駅・車庫の位置（はじめからの長さ）を、1本にした線の上に
  update mp_stations set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_depots set at = case when xr then x.len - at else at end where seg = x.id;
  update mp_stations set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  update mp_depots set seg = x.id, at = jl + case when yr then y.len - at else at end where seg = y.id;
  -- 使っているマス・使用料は x へ（同じ区画は1つに）
  delete from mp_occ o where o.what = 'rail' and o.ref = y.id and exists (select 1 from mp_occ o2 where o2.what = 'rail' and o2.ref = x.id and o2.x = o.x and o2.y = o.y);
  update mp_occ set ref = x.id where what = 'rail' and ref = y.id;
  delete from mp_leases l where l.ref_kind = 'seg' and l.ref = y.id and exists (select 1 from mp_leases l2 where l2.ref_kind = 'seg' and l2.ref = x.id and l2.x = l.x and l2.y = l.y);
  update mp_leases set ref = x.id where ref_kind = 'seg' and ref = y.id;
  update mp_segs set pts = pm, ctl = null, bb = _mp_bb(pm), len = _mp_len(pm),
                     n0 = case when xr then x.n1 else x.n0 end, n1 = case when yr then y.n0 else y.n1 end,
                     name = case when x.name <> '' then x.name else y.name end, cost = x.cost + y.cost, color = coalesce(x.color, y.color),
                     prof = fm, st = _mp_st_of(pm, fm), hm = case when fm is null then null when x.prof is null then y.hm when y.prof is null then x.hm when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hm else 'man' end,
                     hopt = case when fm is null then null when x.prof is null then y.hopt when y.prof is null then x.hopt when x.hm = y.hm and x.hopt is not distinct from y.hopt then x.hopt end,   -- 高さの数値（DB の更新84）
                     vlim = case when x.rack then least(30, _mp_vlim(_mp_minr(pm))) else _mp_vlim(_mp_minr(pm)) end
   where id = x.id;
  delete from mp_segs where id = y.id;
  delete from mp_nodes where id = nd;
  perform _mp_chg('seg', y.id, 'del', y.bb);
  perform _mp_chg('seg', x.id, 'set', _mp_bb(pm));
  return x.id;
end $$;

create or replace function public.mp_seg_join(p_a bigint, p_b bigint, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a mp_segs; me_cs int[]; ch bigint[]; m bigint; i int; s mp_segs;
begin
  perform _mp_ok(u);
  select * into a from mp_segs where id = p_a;
  if not found or a.kind <> 'rail' then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(a.own_u = u or a.own_c = any(me_cs) or (a.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;   -- 国の線は管理者（DB の更新117）
  perform _mp_lock(a.own_u, a.own_c);
  m := p_a;
  if p_b is not null and p_b <> p_a then
    ch := _mp_seg_chain(p_a, p_b);
    if ch is null then raise exception '起点と終点のあいだに分かれ道があるか、線路がつながっていません（分かれ道はまたげません）'; end if;
    for i in 2..array_length(ch, 1) loop m := _mp_seg_join2(m, ch[i], coalesce(p_force, false) and a.gov and _is_admin(u)); end loop;   -- 国の強行（DB の更新117）
    perform _mp_renet(a.own_u, a.own_c); perform _mp_routes_fix(a.own_u, a.own_c, ch);   -- 1本にした線を通る系統だけ（DB の更新94）
  end if;
  select * into s from mp_segs where id = m;
  return jsonb_build_object('id', s.id, 'k', s.kind, 'c', s.cls, 'n', s.name, 'w', s.w, 'l', s.lanes, 'p', to_jsonb(s.pts), 'dbl', s.dbl, 'el', s.elec, 'art', s.art, 'col', s.color,
    'o', case when s.gov then 'gov' when s.own_u is not null then 'u:' || s.own_u else 'c:' || s.own_c end, 'mine', true, 'n0', s.n0, 'n1', s.n1, 'v', s.vlim, 'len', round(s.len::numeric, 1), 'ctl', to_jsonb(s.ctl));
end $$;

create or replace function public.mp_seg_merge(p_a bigint, p_b bigint, p_keep bigint, p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a mp_segs; b mp_segs; k mp_segs; o mp_segs; o2 mp_segs; me_cs int[]; nd bigint; c1 jsonb; cost numeric := 0; need jsonb; jerr text; r jsonb;
        dopt boolean; dsig boolean; dspec boolean; dsnow boolean;
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新117）
begin
  perform _mp_ok(u);
  select * into a from mp_segs where id = p_a;
  if not found or a.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(a.own_u = u or a.own_c = any(me_cs) or (a.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  zfo := coalesce(p_force, false) and a.gov and _is_admin(u);   -- 国の強行（DB の更新117）：アプト式のちがい・つなぎ目のカーブ・はばが建物にかかっても
  if p_b is null then
    return jsonb_build_object('cands', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'n', s.name, 'm', round((s.len * 50)::numeric), 'end', case when e.nd = a.n0 then 0 else 1 end,
               'rack', s.rack <> a.rack, 'dif', to_jsonb(_mp_seg_difs(a, s))) order by e.nd = a.n1, s.id)
      from (select unnest(array[a.n0, a.n1]) nd) e join mp_segs s on (s.n0 = e.nd or s.n1 = e.nd) and s.id <> a.id
     where e.nd is not null and s.kind = 'rail' and s.own_u is not distinct from a.own_u and s.own_c is not distinct from a.own_c and s.gov = a.gov
       and (select count(*) from mp_segs q where q.n0 = e.nd or q.n1 = e.nd) = 2), '[]'::jsonb));
  end if;
  select * into b from mp_segs where id = p_b;
  if not found or b.kind <> 'rail' or b.id = a.id then raise exception '線路が見つかりません'; end if;
  if not (b.own_u is not distinct from a.own_u and b.own_c is not distinct from a.own_c and b.gov = a.gov) then raise exception 'ほかの持ち主の線路とは、1本にできません'; end if;
  nd := case when a.n1 is not null and a.n1 in (b.n0, b.n1) then a.n1 when a.n0 is not null and a.n0 in (b.n0, b.n1) then a.n0 end;
  if nd is null or (select count(*) from mp_segs q where q.n0 = nd or q.n1 = nd) <> 2 then raise exception 'となりあっていない線か、分かれ道のある点です（1本にできません）'; end if;
  if p_keep is not null and p_keep not in (a.id, b.id) then raise exception 'そろえる線は、えらんだ2本のどちらかです'; end if;
  if p_keep = b.id then k := b; o := a; else k := a; o := b; end if;
  if k.rack <> o.rack then
    if not zfo then raise exception 'アプト式の線と そうでない線は、1本にできません（高さの設定で そろえてください）'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('rk'));   -- もう1本も そろえる線と同じ（アプト式か そうでないか）に
  end if;
  dopt := k.dbl <> o.dbl or k.quad <> o.quad or k.elec <> o.elec or (k.elec and k.ps <> o.ps);
  dsig := k.sig <> o.sig;
  dspec := k.gauge <> o.gauge or k.g2 is distinct from o.g2 or k.slp <> o.slp or (k.elec and k.cat <> o.cat) or k.nw <> o.nw;
  dsnow := k.snowp <> o.snowp;
  if p_dry then
    if dopt then c1 := mp_seg_opts(o.id, k.dbl, k.elec, null, true, null, k.quad, k.ps, zfo); cost := cost + coalesce((c1 ->> 'cost')::numeric, 0); need := c1 -> 'need'; zfc := zfc || coalesce(c1 -> 'fc', '[]'::jsonb); end if;
    if dsig then cost := cost + coalesce((mp_seg_sig(o.id, k.sig, false, true) ->> 'cost')::numeric, 0); end if;
    if dspec and not o.gov then
      o2 := o;
      if k.elec and not o.elec then o2.elec := true; o2.cat := case when k.ps = 3 then 6 else 0 end; end if;
      cost := cost + _mp_spec_cost(o2, k.gauge, k.g2, k.slp, case when k.elec then k.cat else o2.cat end, k.nw);
    end if;
    if dsnow then cost := cost + coalesce((mp_seg_snow(o.id, k.snowp, true) ->> 'cost')::numeric, 0); end if;
    -- つなげるか（つなぎ目のカーブなど）：設定をそろえたつもりで ためして、もどす
    begin
      update mp_segs set dbl = k.dbl, quad = k.quad, elec = k.elec, ps = k.ps, sig = k.sig, gauge = k.gauge, g2 = k.g2, slp = k.slp, cat = k.cat, nw = k.nw, snowp = k.snowp, name = k.name, rack = case when zfo then k.rack else rack end where id = o.id;
      begin   -- 国の強行（DB の更新117）：強行しないと つなげないか（ためして もどす）
        perform _mp_seg_join2(k.id, o.id, false);
        raise exception '__dry2__';
      exception when others then
        if sqlerrm <> '__dry2__' then
          if zfo and sqlerrm like 'つなぎ目のカーブ%' then zfc := zfc || jsonb_build_array(jsonb_build_array('jc')); else raise; end if;
        end if;
      end;
      perform _mp_seg_join2(k.id, o.id, zfo);
      raise exception '__dry__';
    exception when others then
      if sqlerrm <> '__dry__' then jerr := sqlerrm; end if;
    end;
    return jsonb_build_object('cost', round(cost), 'keep', k.id, 'other', o.id, 'dif', to_jsonb(_mp_seg_difs(k, o)), 'need', need, 'err', jerr,
      'm', round(((k.len + o.len) * 50)::numeric)) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;
  end if;
  -- そろえる（それぞれの工事。工事費もそれぞれ払う）→ 1本にする（どこかでだめなら、ぜんぶ取り消し）
  if dopt then perform mp_seg_opts(o.id, k.dbl, k.elec, k.name, false, null, k.quad, k.ps, zfo); end if;
  if dsig then perform mp_seg_sig(o.id, k.sig, false, false); end if;
  if dspec then
    select * into o from mp_segs where id = o.id;
    if o.gauge <> k.gauge or o.g2 is distinct from k.g2 or o.slp <> k.slp or (o.elec and o.cat <> k.cat) or o.nw <> k.nw then
      perform mp_seg_spec(o.id, jsonb_build_object('gauge', k.gauge, 'g2', coalesce(k.g2, 0), 'slp', k.slp, 'cat', k.cat, 'nw', k.nw), false, false);
    end if;
  end if;
  if dsnow then perform mp_seg_snow(o.id, k.snowp, false); end if;
  update mp_segs set name = k.name, color = k.color where id = o.id and (name is distinct from k.name or color is distinct from k.color);
  if zfo and o.rack <> k.rack then update mp_segs set rack = k.rack where id = o.id; end if;   -- 国の強行（DB の更新117）
  r := mp_seg_join(k.id, o.id, zfo);
  return r || jsonb_build_object('cost', round(cost));
end $$;

create or replace function public.mp_sta_resize(p_id bigint, p_plat int, p_tracks int, p_dry boolean, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); st mp_stations; sg mp_segs; span real; sub int[]; tiles int[]; pcs int[]; oc int[]; olds int[]; need jsonb; lfee numeric := 0;
        pt record; cost numeric; addc bigint; ntrk jsonb; dflt jsonb; rr bigint; st2 mp_stations;
        zfo boolean := false; zfc jsonb := '[]'::jsonb;   -- 国の強行（DB の更新117）
begin
  perform _mp_ok(u);
  select * into st from mp_stations where id = p_id;
  if not found or st.kind <> 'rail' then raise exception '駅が見つかりません'; end if;
  if not _mp_mine(u, st.own_u, st.own_c) then raise exception 'あなたの駅ではありません'; end if;
  zfo := coalesce(p_force, false) and st.own_u is null and st.own_c is null and _is_admin(u);   -- 国の強行（DB の更新117）：ホームのカーブ・ホームにかかる建物でも
  if not p_dry then
    perform _mp_lock(st.own_u, st.own_c);
    select * into st from mp_stations where id = p_id for update;
  end if;
  if p_plat is null or p_plat < 20 or p_plat > 400 or p_plat % 20 <> 0 then raise exception 'ホームの長さは20m単位で、20〜400mです'; end if;
  if p_tracks is null or p_tracks < 1 or p_tracks > 8 then raise exception '番線の数は1〜8です'; end if;
  if p_plat = st.plat and p_tracks = st.tracks then raise exception 'ホームの長さも番線の数も、いまと同じです'; end if;
  select * into sg from mp_segs where id = st.seg;
  if not found then raise exception '線路が見つかりません'; end if;
  span := p_plat / 50.0;
  if st.at - span / 2 < 0.3 or st.at + span / 2 > sg.len - 0.3 then raise exception 'ホームが線路からはみ出します（いまの線路では、これより長くできません）'; end if;
  sub := _mp_sub(sg.pts, st.at - span / 2, st.at + span / 2);
  if p_plat > st.plat and _mp_minr(sub) < 8 then
    if not zfo then raise exception 'ホームはカーブのゆるいところ（半径400m以上）にしか作れません'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('rs', round((_mp_minr(sub) * 50)::numeric)));
  end if;
  if exists (select 1 from mp_stations t where t.seg = st.seg and t.id <> p_id and abs(t.at - st.at) < (t.plat / 50.0 + span) / 2 + 1)
     or exists (select 1 from mp_depots t where t.seg = st.seg and abs(t.at - st.at) < (span + (_mp_dep_dim(t.kind, t.size))[1]) / 2 + 0.2) then raise exception '近くにほかの駅・車庫があります'; end if;
  tiles := _mp_tiles(sub);
  pcs := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_line_cells(sub, greatest(0.5, (0.22 * p_tracks + 0.18) * 2.5)::real) z,
                  lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  -- いまのホームの区画（もう使っている）は、建物・許可・使用料の見つもりからのぞく
  olds := (select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from _mp_sta_cells(p_id) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o));
  if _mp_bld_hit_z((select coalesce(array_agg(u2.v order by z.y, z.x, u2.o), '{}') from (
        select pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i
        except select olds[2 * i - 1], olds[2 * i] from generate_series(1, coalesce(array_length(olds, 1), 0) / 2) i) z, lateral unnest(array[z.x, z.y]) with ordinality u2(v, o)),
        case when sg.prof is not null then _mp_pz(sg.prof, st.at) end) is not null then   -- 高さ（t108）：地下駅・高架駅は建物の下・上にも
    if not zfo then raise exception 'ホームが建物のある土地にかかります'; end if;
    zfc := zfc || jsonb_build_array(jsonb_build_array('b', '建物'));
  end if;
  oc := _mp_seg_cells_arr(_mp_sub(sg.pts, greatest(0, st.at - span / 2 - 1), least(sg.len, st.at + span / 2 + 1)), 'rail', sg.w, sg.dbl);
  need := _mp_land_need(pcs, st.own_u, st.own_c, false, oc || olds);
  with c as (select distinct pcs[2 * i - 1] x, pcs[2 * i] y from generate_series(1, coalesce(array_length(pcs, 1), 0) / 2) i),
       o as materialized (select distinct oc[2 * i - 1] x, oc[2 * i] y from generate_series(1, coalesce(array_length(oc, 1), 0) / 2) i
                          union select olds[2 * i - 1], olds[2 * i] from generate_series(1, coalesce(array_length(olds, 1), 0) / 2) i)
  select coalesce(sum(coalesce(_mp_land_fee(p.id, st.own_u, st.own_c), _mp_land_std(p.id))), 0) into lfee
    from c join mp_pcells pcl on pcl.x = c.x and pcl.y = c.y join mp_parcels p on p.id = pcl.parcel
   where (st.own_u is not null or st.own_c is not null) and not exists (select 1 from o where o.x = c.x and o.y = c.y) and (p.own_u is not null or p.own_c is not null) and not _mp_same(p.own_u, p.own_c, false, st.own_u, st.own_c, false);
  select * into pt from _mp_at(sg.pts, st.at);
  -- ふえるホーム（番線 × 長さ）の分だけ、いまの場所の値段で
  cost := greatest(0, p_tracks * p_plat - st.tracks * st.plat) * _mp_rate('sta_m') * (1 + _mp_rate('urb_sta') * _mp_dens(pt.x, pt.y))
          * case _mp_sta_lv(st.seg, st.at, st.x, st.y) when 'U' then 2.5 when 'E' then 1.5 else 1 end;   -- 地下駅 2.5倍・高架駅 1.5倍（t108）
  addc := round(cost)::bigint;
  if p_dry then
    return jsonb_build_object('cost', addc, 'up_day', round(_mp_rate('up_sta') * (1 + 0.25 * (p_tracks - 1))), 'up_now', round(_mp_rate('up_sta') * (1 + 0.25 * (st.tracks - 1))),
                              'lease', round(lfee), 'need', need,
                              'routes', (select count(*) from mp_routes r where p_id = any(r.stops))) || case when zfo then jsonb_build_object('fc', zfc) else '{}'::jsonb end;
  end if;
  perform _mp_land_stop(need);
  if addc > 0 then perform _mp_pay(st.own_u, st.own_c, st.own_u is null and st.own_c is null, addc, 'sta', format('駅「%s」のホームの工事（%sm・%s番線 → %sm・%s番線）', st.name, st.plat, st.tracks, p_plat, p_tracks)); end if;
  -- 番線の使いかた：決めていたら、のこる番線はそのまま・ふえた番線はいつもの決まり
  ntrk := null;
  if st.trk is not null and jsonb_typeof(st.trk) = 'array' and jsonb_array_length(st.trk) = greatest(st.tracks, 1) and p_tracks > 1 then
    st2 := st; st2.trk := null; st2.tracks := p_tracks; dflt := _mp_sta_trk(st2);
    ntrk := (select jsonb_agg(case when k <= jsonb_array_length(st.trk) then st.trk -> (k - 1) else dflt -> (k - 1) end order by k) from generate_series(1, p_tracks) k);
  end if;
  update mp_stations set plat = p_plat, tracks = p_tracks, cost = st.cost + addc, trk = ntrk, pf = case when p_tracks = st.tracks then st.pf end where id = p_id;   -- 番線の数が変われば ホームの形は おまかせ（DB の更新107）
  delete from mp_occ where what = 'sta' and ref = p_id;
  perform _mp_occ_set(p_id, 'sta', tiles);
  perform _mp_lease_set('sta', p_id, st.own_u, st.own_c, false);
  if p_plat <> st.plat then begin perform _mp_prof_redo(st.seg); exception when others then raise warning 'mp sta level: %', sqlerrm; end; end if;   -- 駅のところを水平に（DB の更新108）
  for rr in select r.id from mp_routes r where p_id = any(r.stops) loop perform _mp_resched(rr); end loop;
  perform _mp_chg('sta', p_id, 'set', box(point(st.x / 100.0 - 3, st.y / 100.0 - 3), point(st.x / 100.0 + 3, st.y / 100.0 + 3)));
  return jsonb_build_object('ok', true, 'cost', addc, 'plat', p_plat, 'tracks', p_tracks);
end $$;

-- だれが呼べるか（作りなおした関数）
revoke all on function public._mp_run_mark(bigint, int, text, int) from public, anon, authenticated;
revoke all on function public._mp_resched(bigint) from public, anon, authenticated;
revoke all on function public._mp_tick_hour(timestamptz) from public, anon, authenticated;
revoke all on function public._mp_unko_rt(bigint, float8, float8) from public, anon, authenticated;
revoke all on function public._mp_unko_trn(jsonb, bigint[], jsonb, jsonb, int, float8, bigint, float8, float8) from public, anon, authenticated;
revoke all on function public._mp_seg_join2(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.mp_unko_list(text) from public, anon;
grant execute on function public.mp_unko_list(text) to authenticated;
revoke all on function public.mp_dia(bigint) from public, anon;
grant execute on function public.mp_dia(bigint) to authenticated;
revoke all on function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int, boolean) from public, anon;
grant execute on function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int, boolean) to authenticated;
revoke all on function public.mp_seg_join(bigint, bigint, boolean) from public, anon;
grant execute on function public.mp_seg_join(bigint, bigint, boolean) to authenticated;
revoke all on function public.mp_seg_merge(bigint, bigint, bigint, boolean, boolean) from public, anon;
grant execute on function public.mp_seg_merge(bigint, bigint, bigint, boolean, boolean) to authenticated;
revoke all on function public.mp_sta_resize(bigint, int, int, boolean, boolean) from public, anon;
grant execute on function public.mp_sta_resize(bigint, int, int, boolean, boolean) to authenticated;
-- 待つ時間（作りなおすと消えるので もういちど）：線の設定・つなぐ・1本にする 60秒・ホームの長さ 20秒
alter function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int, boolean) set statement_timeout = '60s';
alter function public.mp_seg_join(bigint, bigint, boolean) set statement_timeout = '60s';
alter function public.mp_seg_merge(bigint, bigint, bigint, boolean, boolean) set statement_timeout = '60s';
alter function public.mp_sta_resize(bigint, int, int, boolean, boolean) set statement_timeout = '20s';

-- 通勤時間帯の混雑：いままでの1時間ごとの成績（7日まで。いちばん新しいもの）から はじめの速さ
update mp_routes ro set rush = q.rr from (
  select z.route, jsonb_object_agg(z.hs::text, z.rate) rr from (
    select distinct on (h.route, x.hs) h.route, x.hs, _mp_rush_rate(x.hs, h.served, h.cap) rate
      from mp_hours h cross join lateral (select ((extract(hour from h.hour at time zone 'Asia/Tokyo')::int + 23) % 24) hs) x
     where h.hour > now() - interval '7 days' and x.hs in (7, 8, 9, 17, 18, 19)
     order by h.route, x.hs, h.hour desc) z
   where z.rate < 1 group by z.route) q
 where ro.id = q.route and ro.kind = 'rail';
-- 走ろうとする：編成が まにあわなくて走れなかった列車のある系統は、時刻を組みなおす（遅れて走る）
do $$
declare zr bigint;
begin
  for zr in select distinct t.route from mp_trains t where t.bad and t.form is not null order by 1 loop
    begin
      perform _mp_resched(zr);
    exception when others then raise warning 'mp 117 resched %: %', zr, sqlerrm;
    end;
  end loop;
end $$;
