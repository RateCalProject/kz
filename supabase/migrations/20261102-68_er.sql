-- 救急：119番の よび出し（まちの人の多さ・時刻・天気・道路の事故から。1日に 300件ぐらい）に、近くの病院の救急車が出動して、病院へ運ぶ。
--   救急車は 救急病院・大病院・総合病院に（床の広さで 1〜8台。だれの病院でも）。病院の救急車がないときは消防署（国）の救急車。猛暑は熱中症・雪は転倒・台風はけがが ふえる
--   運ばれた病院は、救急の患者の分の売上（軽症 2万・中等症 5万・重症 12万 X。施設の売上）。道が混んでいると救急車も遅れる
--   地図の救急車（mp_er_now）・救急情報（mp_er_list）・病院の救急（mp_er_bld）

-- ---------------------------------------------------------------------
-- 救急（DB の更新68）：119番の よび出し（まちの人の多さ・時刻・天気・事故から）→ 近くの病院の救急車が出動 → 病院へ運ぶ
--   救急車は 救急病院（1,500㎡ に1台）・大病院（3,000㎡ に1台）・総合病院（5,000㎡ に1台）に（1〜8台。動いている病院だけ）。
--   病院の救急車が近く（15km）にないか、みな出ているときは、消防署（国。2台）か、その市区町村の消防の救急車が出動して、近くの病院（40km まで）へ運ぶ。
--   運ばれた病院は、救急の患者の分の売上（軽症 2万・中等症 5万・重症 12万 X）が入る（自分で使う・会社が借りているとき。施設の売上）
-- ---------------------------------------------------------------------
create table if not exists public.mp_er (
  id   bigserial primary key,
  t0   timestamptz not null default now(),   -- よばれた
  x    int not null, y int not null,          -- よばれた場所（×100 マス）
  pl   text not null default '',              -- 市区町村
  why  text not null,                         -- 急病・けが・交通事故・熱中症・雪で転倒・強風でけが
  sev  smallint not null,                     -- 1 軽症・2 中等症・3 重症
  ub   bigint,                                -- 出動した救急車の建物（病院・消防署）
  un   text not null default '',              -- その名前
  ux   int, uy int,                           -- 出動したところ（×100 マス）
  hb   bigint,                                -- 運んだ病院（建物）。null は近くの病院
  hn   text not null default '',              -- その名前
  hx   int, hy int,
  t1   timestamptz, t2 timestamptz, t3 timestamptz, t4 timestamptz,   -- 着いた・出た・病院に着いた・救急車がもどった
  fee  bigint not null default 0,             -- 病院の売上
  hu   uuid, hc int,                          -- 売上を受けとる名義（病院を動かしている人・会社）
  paid boolean not null default false
);
create index if not exists mp_er_t0 on public.mp_er (t0);
create index if not exists mp_er_t4 on public.mp_er (t4);
create index if not exists mp_er_ub on public.mp_er (ub, t4);
create index if not exists mp_er_hb on public.mp_er (hb, t0);
alter table public.mp_er enable row level security;
revoke all on public.mp_er from public, anon, authenticated;
revoke all on sequence public.mp_er_id_seq from public, anon, authenticated;

-- 救急車のいるところ：病院（救急のできるもの・動いているもの）と消防署（国）。n 台数・busy 出ている台数・hosp 患者を受けられる
create or replace function public._mp_er_units(h timestamptz) returns table (bld bigint, kind text, nm text, x float8, y float8, n int, busy int, hosp boolean, pu uuid, pc int, pay boolean)
language sql stable set search_path = public as $$
  select b.id, b.kind, coalesce(nullif(b.name, ''), case b.kind when 'erhosp' then '救急病院' when 'bighosp' then '大病院' when 'hospital' then '総合病院' else '消防署' end),
         (b.cells[1] + 0.5) / 5.0, (b.cells[2] + 0.5) / 5.0,
         case b.kind when 'firest' then 2 else least(8, greatest(1, ceil(o.m2::float8 / case b.kind when 'erhosp' then 1500 when 'bighosp' then 3000 else 5000 end)))::int end,
         (select count(*)::int from mp_er e where e.ub = b.id and e.t4 > h),
         b.kind <> 'firest', o.pu, o.pc, o.ok and not o.gv
    from mp_blds b cross join lateral _mp_sc_op(b.id, h) o
   where b.kind in ('erhosp', 'bighosp', 'hospital', 'firest') and (o.ok or o.npc or o.gv)
$$;

-- 1件：場所 (x, y)（マス）・原因・重さ。出動する救急車をえらび、時刻を決めて記録する
--   救急車：15km 以内の病院（あいているもの）→ 15km 以内の消防署 → その市区町村の消防（まん中から。いつも出られる）
--   運ぶ病院：病院の救急車なら その病院。ほかは 40km 以内の いちばん近い病院（なければ近くの病院）
create or replace function public._mp_er_call(px float8, py float8, p_why text, p_sev int, h timestamptz) returns bigint
language plpgsql set search_path = public as $$
declare u record; hq record; v float8; d1 float8; d2 float8; d3 float8; t0 float8 := extract(epoch from h); t1 float8; t2 float8; t3 float8; t4 float8;
        o record; pl text; plx float8; ply float8; fee bigint; id bigint; ub bigint; un text; ux float8; uy float8; uhosp boolean := false;
begin
  -- 速さ（km/h）：ふつう 45。まわりが混んでいると遅く（いちばん半分）、雪だと 7割
  v := 45 * (1 - 0.5 * _mp_jam_idx(px, py));
  begin o := _wx_core(px, py, 0, floor(t0 * 1000)::bigint, true); if o.kind = 'snow' then v := v * 0.7; end if; exception when others then null; end;
  select case when p.k = 'ward' then coalesce((select q.name || coalesce(q.type, '') from mp_places q where q.id = p.parent), '') else '' end || p.name || coalesce(p.type, ''), p.x, p.y
    into pl, plx, ply from mp_places p where p.k in ('ward', 'muni') order by p.pt <-> point(px, py) limit 1;
  -- 救急車
  select * into u from _er_u e where e.hosp and e.busy < e.n and (e.x - px) ^ 2 + (e.y - py) ^ 2 < 90000::float8 order by (e.x - px) ^ 2 + (e.y - py) ^ 2 limit 1;
  if found then ub := u.bld; un := u.nm; ux := u.x; uy := u.y; uhosp := true;
  else
    select * into u from _er_u e where not e.hosp and e.busy < e.n and (e.x - px) ^ 2 + (e.y - py) ^ 2 < 90000::float8 order by (e.x - px) ^ 2 + (e.y - py) ^ 2 limit 1;
    if found then ub := u.bld; un := u.nm; ux := u.x; uy := u.y;
    else ub := null; un := coalesce(pl, '') || '消防'; ux := coalesce(plx, px); uy := coalesce(ply, py);   -- 市区町村の消防（まん中から）
    end if;
  end if;
  if ub is not null then update _er_u e set busy = busy + 1 where e.bld = ub; end if;
  -- 運ぶ病院
  if uhosp then hq := u;
  else select * into hq from _er_u e where e.hosp and (e.x - px) ^ 2 + (e.y - py) ^ 2 < 640000::float8 order by (e.x - px) ^ 2 + (e.y - py) ^ 2 limit 1; end if;
  d1 := least(40, sqrt((ux - px) ^ 2 + (uy - py) ^ 2) * 0.05 * 1.3);   -- km（道なりで 1.3倍。市区町村の消防は 40km まで）
  d2 := case when hq.bld is null then 5 else sqrt((hq.x - px) ^ 2 + (hq.y - py) ^ 2) * 0.05 * 1.3 end;
  d3 := case when hq.bld is null or uhosp then 0 else least(50, sqrt((hq.x - ux) ^ 2 + (hq.y - uy) ^ 2) * 0.05 * 1.3) end;
  t1 := t0 + 60 + d1 / v * 3600;            -- 出るまで1分
  t2 := t1 + 600 + 120 * p_sev;             -- その場の手当て
  t3 := t2 + d2 / v * 3600;
  t4 := t3 + 600 + d3 / 45 * 3600;          -- 引きついで、もどる
  fee := case p_sev when 3 then 120000 when 2 then 50000 else 20000 end;
  insert into mp_er(t0, x, y, pl, why, sev, ub, un, ux, uy, hb, hn, hx, hy, t1, t2, t3, t4, fee, hu, hc, paid)
    values (to_timestamp(t0), round(px * 100)::int, round(py * 100)::int, coalesce(pl, ''), p_why, p_sev, ub, un, round(ux * 100)::int, round(uy * 100)::int,
            hq.bld, coalesce(hq.nm, '近くの病院'), round(coalesce(hq.x, px) * 100)::int, round(coalesce(hq.y, py) * 100)::int,
            to_timestamp(t1), to_timestamp(t2), to_timestamp(t3), to_timestamp(t4),
            case when hq.bld is not null and hq.pay then fee else 0 end, case when hq.pay then hq.pu end, case when hq.pay then hq.pc end, not coalesce(hq.pay, false))
    returning mp_er.id into id;
  return id;
end $$;

-- 5分ごと：病院に着いた患者の売上・新しい よび出し（1日に 300件ぐらい。昼に多く夜は少ない。猛暑は熱中症・雪は転倒・台風はけが・道路の事故は交通事故）・古い記録をけす（3日）
create or replace function public._mp_er_tick() returns void
language plpgsql set search_path = public as $$
declare h timestamptz := now(); lt timestamp := now() at time zone 'Asia/Tokyo'; hr float8; lam float8; n int := 0; k int; c record; e record; px float8; py float8;
        o record; why text; sev int; r float8; wxok boolean := exists (select 1 from mp_wx_k); ms bigint := floor(extract(epoch from now()) * 1000)::bigint; fz float8; tm float8;
begin
  -- 1) 病院に着いた：売上
  for e in select * from mp_er where not paid and t3 <= h order by id loop
    if e.fee > 0 and (e.hu is not null or e.hc is not null) then
      perform _mp_earn(e.hu, e.hc, false, e.fee, 'fee', format('救急の患者（%s・%s）%s', e.why, case e.sev when 3 then '重症' when 2 then '中等症' else '軽症' end, e.hn));
    end if;
    update mp_er set paid = true where id = e.id;
  end loop;
  -- 2) 新しい よび出し
  drop table if exists _er_u;
  create temp table _er_u on commit drop as select * from _mp_er_units(h);
  if not exists (select 1 from _er_u) then return; end if;
  hr := extract(hour from lt) + extract(minute from lt) / 60.0;
  lam := 1.15 * (0.55 + 0.6 * exp(-((hr - 10) / 4) * ((hr - 10) / 4)) + 0.3 * exp(-((hr - 19) / 3) * ((hr - 19) / 3)));   -- 5分あたり
  -- 何件か（ポアソン）
  r := random(); tm := exp(-lam); fz := tm;
  while r > fz and n < 12 loop n := n + 1; tm := tm * lam / n; fz := fz + tm; end loop;
  for k in 1..n loop
    select * into c from mp_centers where dp > 0 order by -ln(random()) / dp limit 1;
    if not found then exit; end if;
    px := c.x + c.sg * 0.7 * sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random());
    py := c.y + c.sg * 0.7 * sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random());
    r := random(); why := case when r < 0.62 then '急病' when r < 0.86 then 'けが' else '交通事故' end;
    if wxok then
      begin
        o := _wx_core(px, py, 0, ms);
        if o.t >= 31 and random() < least(0.8, (o.t - 29) / 8) then why := '熱中症';
        elsif (o.kind = 'snow' or o.ec >= 0.5) and o.t <= 1 and random() < 0.35 then why := '雪で転倒';
        elsif o.tyn > 0 and o.tya < 1.5 and random() < 0.4 then why := '強風でけが'; end if;
        -- 猛暑・大雪の日は よび出しがふえる（もう1件）
        if (o.t >= 35 or (o.kind = 'snow' and o.inten > 0.6)) and random() < 0.5 then perform _mp_er_call(px + 3, py + 3, case when o.t >= 35 then '熱中症' else '雪で転倒' end, 1 + (random() < 0.3)::int, h); end if;
      exception when others then null; end;
    end if;
    r := random(); sev := case when why = '熱中症' then case when r < 0.65 then 1 when r < 0.93 then 2 else 3 end
                               when why = '交通事故' then case when r < 0.5 then 1 when r < 0.85 then 2 else 3 end
                               else case when r < 0.6 then 1 when r < 0.9 then 2 else 3 end end;
    perform _mp_er_call(px, py, why, sev, h);
  end loop;
  -- 道路の事故（この5分に はじまったもの）：半分ぐらいで救急車
  for e in select j.x, j.y from mp_jam m join mp_jseg j on j.seg = m.seg where m.why = '事故' and m.t0 > h - interval '5 minutes' loop
    if random() < 0.5 then perform _mp_er_call(e.x, e.y, '交通事故', case when random() < 0.5 then 1 when random() < 0.7 then 2 else 3 end, h); end if;
  end loop;
  -- 3) 古い記録（3日より前）
  delete from mp_er where t0 < h - interval '3 days';
end $$;

-- 地図の救急車：いま出ているもの（もどって10分まで）。見えているところ（マス。なければ国じゅう）
--   [id, よばれた場所 x, y, 出たところ x, y, 病院 x, y, t0, t1（着いた）, t2（出た）, t3（病院）, t4（もどった）, 原因, 重さ]（×100 マス・1970年からの秒）
create or replace function public.mp_er_now(p_x0 real, p_y0 real, p_x1 real, p_y1 real) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g();
begin
  return jsonb_build_object('now', extract(epoch from now()),
    'list', coalesce((select jsonb_agg(jsonb_build_array(e.id, e.x, e.y, e.ux, e.uy, e.hx, e.hy, extract(epoch from e.t0), extract(epoch from e.t1), extract(epoch from e.t2),
                                                          extract(epoch from e.t3), extract(epoch from e.t4), e.why, e.sev) order by e.id)
                        from mp_er e where e.t4 > now() - interval '10 minutes' and e.t0 <= now()
                          and (p_x0 is null or ((e.x / 100.0 between p_x0 and p_x1 and e.y / 100.0 between p_y0 and p_y1)
                                             or (e.ux / 100.0 between p_x0 and p_x1 and e.uy / 100.0 between p_y0 and p_y1)
                                             or (e.hx / 100.0 between p_x0 and p_x1 and e.hy / 100.0 between p_y0 and p_y1)))), '[]'::jsonb));
end $$;

-- 救急情報（一覧）：この3時間の よび出し（新しい順に p_n こ・50まで）と、きょうの数（原因ごと）
create or replace function public.mp_er_list(p_n int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g(); n int := least(greatest(coalesce(p_n, 20), 1), 50); d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
begin
  return jsonb_build_object('now', extract(epoch from now()),
    'today', (select jsonb_build_object('n', count(*), 'why', coalesce((select jsonb_object_agg(z.why, z.c) from (select why, count(*) c from mp_er where t0 >= d0 and t0 <= now() group by why) z), '{}'::jsonb),
                                        'sev3', count(*) filter (where sev = 3), 'busy', count(*) filter (where t4 > now()))
                from mp_er where t0 >= d0 and t0 <= now()),
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 't0', extract(epoch from e.t0), 'pl', e.pl, 'why', e.why, 'sev', e.sev, 'un', e.un, 'hn', e.hn,
                                                          't1', extract(epoch from e.t1), 't3', extract(epoch from e.t3), 't4', extract(epoch from e.t4), 'x', e.x / 100, 'y', e.y / 100) order by e.t0 desc)
                        from (select * from mp_er where t0 > now() - interval '3 hours' and t0 <= now() order by t0 desc limit n) e), '[]'::jsonb));
end $$;

-- 病院・消防署の救急（建物のシート）：救急車の台数・出ている台数・きょう運んだ患者（受けた病院として）。売上は、その病院を動かしている名義の人だけ
create or replace function public.mp_er_bld(p_bld bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := _me_g(); b mp_blds; o record; nn int; d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'; mine boolean := false;
begin
  select * into b from mp_blds where id = p_bld;
  if not found or b.kind not in ('erhosp', 'bighosp', 'hospital', 'firest') then return null; end if;
  select * into o from _mp_sc_op(b.id, now());
  nn := case b.kind when 'firest' then 2 else least(8, greatest(1, ceil(o.m2::float8 / case b.kind when 'erhosp' then 1500 when 'bighosp' then 3000 else 5000 end)))::int end;
  mine := u is not null and o.ok and not o.gv and ((o.pu is not null and o.pu = u) or (o.pc is not null and exists (select 1 from companies c where c.id = o.pc and c.owner = u)));
  return jsonb_build_object('n', case when o.ok or o.npc or o.gv then nn else 0 end, 'run', o.ok or o.npc or o.gv,
    'busy', (select count(*) from mp_er e where e.ub = b.id and e.t4 > now() and e.t0 <= now()),
    'today', (select count(*) from mp_er e where e.hb = b.id and e.t3 >= d0 and e.t3 <= now()),
    'out', (select count(*) from mp_er e where e.ub = b.id and e.t0 >= d0 and e.t0 <= now()),
    'fee', case when mine then (select coalesce(sum(e.fee), 0) from mp_er e where e.hb = b.id and e.t3 >= d0 and e.t3 <= now()) end,
    'hosp', b.kind <> 'firest');
end $$;

-- 5分ごと：救急（pg_cron があるとき）
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('ailinax-er', '*/5 * * * *', 'select public._mp_er_tick()');
  end if;
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない。地図の救急車・救急情報・病院の救急は、ログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_er_units', '_mp_er_call', '_mp_er_tick', 'mp_er_now', 'mp_er_list', 'mp_er_bld') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
