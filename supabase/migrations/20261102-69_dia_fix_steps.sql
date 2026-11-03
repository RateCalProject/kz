-- ダイヤの「重なりを直す」が、列車の多い系統で「通信がとぎれました（Load failed）」になるのを直す：
--   スマホのブラウザは、60秒たっても返事がないと通信を切る。前は 1回目の直し（組みなおし2回）が長くて、見つもりから60秒をこえていた
--   1回の呼び出しは40秒まで（組みなおしの時間を見て、とちゅうで切りあげる）。のこっていれば more を返し、画面が p_cont（つづき）で呼びなおす
--   つづきは、はじめの組みなおしと「取り消す」の記録をしない（取り消し1回で、直す前にもどる）。前の形（引数4こ）は消す

drop function if exists public.mp_dia_fix(bigint, text, text, boolean);
-- ダイヤの重なりを直す（2026-10-28）：同じ駅・同じ番線に（30秒の余裕をふくめて）重なる列車を、この系統の列車をうごかして直す
--   p_mode：trk（空いている番線にふりかえる。本線から）・time（前の駅で待って時刻をずらす。始発駅なら発車をおくらせる）・both（ふりかえ → だめならずらす）
--   ゆずるのは優先番号の大きい列車（同じなら、あとから着く列車）。ほかの系統の列車とかさなるときは、この系統の列車がゆずる（ほかの人の時刻は変えない）
--   1回に1列車1か所ずつ直して時刻を組みなおす（10回まで）。15分より長く待たないと直らないところは、そのまま。
--   重なりの数がへらない回・走れない列車がふえる回は、その回を取り消して終わる
--   p_dry は見つもり（さいごに取り消す）。直したあとは「↶ 取り消す」でもどせる
--   （DB の更新69）1回の呼び出しは40秒まで（スマホのブラウザは60秒で通信を切る）。列車の多い系統は、とちゅうで more を返し、
--   画面が p_cont（つづき）で呼びなおす。つづきは、はじめの組みなおしと「取り消す」の記録をしない（取り消し1回で、直す前にもどる）
--   時間：はじめの組みなおし（rs 秒）のあと、1回分（直す＋組みなおし）が 20秒の目安をこえそうなら、つぎの回はしない。
--   直すとちゅうも、組みなおしの時間をのこして 40秒の上限までに切りあげる（のこりは つぎの回・つぎの呼び出しで）。組みなおしの時間がまだわからないときは 20秒とみる
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
                                                      and (c.yday is null or z.day is null or z.day = c.yday) and c.yta - 30 < z.td + 30)
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

alter function public.mp_dia_fix(bigint, text, text, boolean, boolean) set statement_timeout = '60s';   -- 作りなおしたので、待ち時間をつけなおす
revoke all on function public.mp_dia_fix(bigint, text, text, boolean, boolean) from public, anon;
grant execute on function public.mp_dia_fix(bigint, text, text, boolean, boolean) to authenticated;
