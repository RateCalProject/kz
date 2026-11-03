-- 変電所：電化した線路には、変電所から電気をとどける（同じ持ち主・同じ方式。とどく遠さは 直流 10km・交流 40km）。電気が来ない区間がある電車は走れない。
--   いまの電化区間には、変電所を自動でおく（無料。容量は いまのダイヤに合わせて大きめ）。変電所が受けもつ区間のさかいは エアセクション（地図のしるしだけ）。
--   毎時：変電所ごとの負荷を計算し、容量をこえると電圧の低下（徐行・遅れ）、1.5倍をこえると停止（運転見合わせ 45分）。運行情報の遅延理由に「電圧の低下」「変電所の停止」。
--   維持費は1日 小 2万〜大 6万 X（交流は2割高い）

create table if not exists public.mp_subs (   -- 変電所（DB の更新89）：電化した線路に電気をとどける。とどく遠さは 直流 10km・交流 40km
  id     bigserial primary key,
  seg    bigint references public.mp_segs(id) on delete set null,   -- つくった線（線がなくなっても、変電所はのこる）
  x      int not null, y int not null,                              -- 場所（1/100 マス）
  own_u  uuid references public.profiles(id) on delete cascade,
  own_c  int references public.companies(id) on delete cascade,
  gov    boolean not null default false,
  ps     smallint not null default 0,                               -- 方式（0 直流・1 交流50Hz・2 交流60Hz）
  sz     smallint not null default 1,                               -- 大きさ（0 小・1 中・2 大）
  cap    int not null,                                              -- 容量（kW）
  upk    int not null default 0,                                    -- 維持費（1日）
  name   text not null default '',
  cost   bigint not null default 0,
  auto   boolean not null default false,                            -- いまの電化区間に自動でおいたもの（DB の更新89）
  load   int,                                                       -- いちばん新しい1時間の負荷（いちばん多いとき。kW）
  ev_at  timestamptz,                                               -- さいごに電圧の低下・停止がおきた時刻
  trip   timestamptz,                                               -- 止まっている（この時刻まで）
  at     timestamptz not null default now()
);
create index if not exists mp_subs_own on public.mp_subs (own_u, own_c, ps);
alter table public.mp_subs enable row level security;
revoke all on public.mp_subs from public, anon, authenticated;
revoke all on sequence public.mp_subs_id_seq from public, anon, authenticated;

-- 変電所の大きさ（DB の更新89）：容量（kW）・工事費・維持費（1日）。直流は 小 3MW・中 6MW・大 12MW、交流は 小 10MW・中 20MW・大 40MW
create or replace function public._mp_sub_spec(ps smallint, sz smallint) returns jsonb
language sql immutable as $$
  select case when ps = 0 then jsonb_build_object('cap', (array[3000, 6000, 12000])[sz + 1], 'cost', (array[60000000, 110000000, 200000000])[sz + 1], 'upk', (array[20000, 35000, 60000])[sz + 1])
              else jsonb_build_object('cap', (array[10000, 20000, 40000])[sz + 1], 'cost', (array[90000000, 160000000, 290000000])[sz + 1], 'upk', (array[24000, 42000, 72000])[sz + 1]) end
$$;
-- 変電所が電気をとどけられる遠さ（マス）：直流 10km・交流 40km
create or replace function public._mp_sub_r(ps smallint) returns real
language sql immutable as $$ select (case when ps = 0 then 200 else 800 end)::real $$;
-- 電化した線路に電気をとどける変電所（同じ持ち主・同じ方式で、とどく遠さの中の いちばん近いもの。なければ null。DB の更新89）
create or replace function public._mp_feed(sid bigint) returns bigint
language sql stable set search_path = public as $$
  select v.id from mp_segs s join mp_subs v on v.ps = s.ps and v.own_u is not distinct from s.own_u and v.own_c is not distinct from s.own_c and v.gov = s.gov
   where s.id = sid and s.kind = 'rail' and s.elec and (s.bb <-> point(v.x / 100.0, v.y / 100.0)) <= _mp_sub_r(s.ps)
   order by s.bb <-> point(v.x / 100.0, v.y / 100.0), v.id limit 1
$$;
-- 系統の駅と駅のあいだごとに、電化した線ぜんぶに電気が来ているか（DB の更新89）
create or replace function public._mp_leg_fed(legs jsonb) returns boolean[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select bool_and(_mp_feed(s.id) is not null) from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint where s.elec), true) order by k), '{}')
    from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) with ordinality q(l, k)
$$;
-- 系統が通る線路のうち、変電所ごとの長さの割合（{変電所: 割合}。電化した線だけ。DB の更新89）
create or replace function public._mp_route_feed(legs jsonb) returns jsonb
language sql stable set search_path = public as $$
  with g as (select (e ->> 0)::bigint sid, abs(coalesce((e ->> 2)::real, 0) - coalesce((e ->> 1)::real, 0)) ln
               from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) e),
       t as (select greatest(sum(ln), 0.001) tot from g),
       f as (select _mp_feed(g.sid) sub, g.ln from g join mp_segs s on s.id = g.sid where s.elec)
  select jsonb_object_agg(z.sub::text, z.fr) from (select f.sub, round((sum(f.ln) / max(t.tot))::numeric, 4) fr from f, t where f.sub is not null group by f.sub) z
$$;
-- 変電所の名前：いちばん近い駅の名前 ＋「変電所」
create or replace function public._mp_sub_name(px int, py int) returns text
language sql stable set search_path = public as $$
  select coalesce((select s.name from mp_stations s where s.kind = 'rail' order by (s.x - px)::float8 ^ 2 + (s.y - py)::float8 ^ 2 limit 1), '') || '変電所'
$$;
-- いまの電化区間に、変電所を自動でおく（DB の更新89。無料）：電気の来ていない電化した線路がなくなるまで、その線のまん中に大きい変電所をおく。
--   容量は、いまのダイヤのいちばん多い1時間の電気（の 1.6倍）の 1.3倍まで大きくする（すぐに電圧の低下がおきないように）
create or replace function public._mp_sub_auto() returns int
language plpgsql set search_path = public as $$
declare s mp_segs; p record; n int := 0; sp jsonb; ro record; rsh jsonb; pk real; kw real; rtm real; k text; v real; est jsonb := '{}'::jsonb;
begin
  loop
    select x.* into s from mp_segs x where x.kind = 'rail' and x.elec and _mp_feed(x.id) is null order by x.gov, x.own_u nulls last, x.own_c nulls last, x.id limit 1;
    exit when not found or n > 3000;
    select * into p from _mp_at(s.pts, s.len / 2);
    sp := _mp_sub_spec(s.ps, 2::smallint);
    insert into mp_subs(seg, x, y, own_u, own_c, gov, ps, sz, cap, upk, name, auto)
      values (s.id, round(p.x * 100), round(p.y * 100), s.own_u, s.own_c, s.gov, s.ps, 2, (sp ->> 'cap')::int, (sp ->> 'upk')::int, _mp_sub_name(round(p.x * 100)::int, round(p.y * 100)::int), true);
    n := n + 1;
  end loop;
  -- いちばん多い1時間の見つもり：系統ごとに（1時間に出る列車のいちばん多い本数 × 電車の出力の平均 × 0.45 × 走る時間の割合 × 長さの割合）
  for ro in select r.id, r.legs from mp_routes r where r.kind = 'rail' and r.ok loop
    rsh := _mp_route_feed(ro.legs);
    continue when rsh is null;
    select max(c) into pk from (select (t.dep / 3600) hh, count(*) c from mp_trains t where t.route = ro.id and t.day is null and t.form is not null and not t.bad group by 1) z;
    select avg((pf ->> 'kw')::real) filter (where (pf ->> 'elec')::boolean), avg(least(3600, coalesce(rt, 1800))) into kw, rtm
      from (select _mp_form_perf(t.form) pf, (select max(coalesce((e ->> 1)::int, (e ->> 2)::int)) - t.dep from jsonb_array_elements(t.sched) e) rt
              from mp_trains t where t.route = ro.id and t.day is null and t.form is not null and not t.bad) z;
    continue when pk is null or kw is null;
    for k, v in select key, value::real from jsonb_each_text(rsh) loop
      est := est || jsonb_build_object(k, coalesce((est ->> k)::real, 0) + pk * kw * 0.45 * rtm / 3600 * v);
    end loop;
  end loop;
  update mp_subs x set cap = greatest(x.cap, (ceil(coalesce((est ->> x.id::text)::real, 0) * 1.6 * 1.3 / 1000) * 1000)::int) where x.auto;
  return n;
end $$;
-- 変電所の電気が足りない（DB の更新89）：この変電所が電気をとどける線を通る系統に、運行の乱れを起こす。
--   容量の 1.5倍まで：電圧の低下（徐行・遅れ）。それより多い：変電所が止まる（運転見合わせ。45分）
create or replace function public._mp_sub_event(sid bigint, ld int) returns bigint
language plpgsql set search_path = public as $$
declare v mp_subs; rts bigint[]; st record; tr boolean; zid bigint; pc int;
begin
  select * into v from mp_subs where id = sid;
  if not found or v.cap <= 0 then return null; end if;
  rts := array(select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and _mp_feed((g ->> 0)::bigint) = sid);
  if coalesce(array_length(rts, 1), 0) = 0 then return null; end if;
  select s.id, s.x, s.y into st from mp_stations s where s.id in (select unnest(ro.stops) from mp_routes ro where ro.id = any(rts))
   order by (s.x - v.x)::float8 ^ 2 + (s.y - v.y)::float8 ^ 2, s.id limit 1;
  tr := ld > v.cap * 1.5; pc := round(100.0 * ld / v.cap);
  zid := _mp_unko_new(case when tr then 'power' else 'volt' end,
                      case when tr then format('%sの停止（電気の使いすぎ・容量の %s%%）', v.name, pc) else format('%sの電圧の低下（電気の使いすぎ・容量の %s%%）', v.name, pc) end,
                      st.id, st.x, st.y, rts, case when tr then 2 else 1 end, pc::real, pc::real, case when tr then 2700 else 1800 end, v.own_u, v.own_c);
  update mp_subs set ev_at = now(), trip = case when tr then now() + interval '45 minutes' else trip end where id = sid;
  return zid;
end $$;

create or replace function public._mp_li_put(rid bigint) returns void
language plpgsql set search_path = public as $$
declare r mp_routes;
begin
  select * into r from mp_routes where id = rid;
  if not found or r.kind <> 'rail' then perform set_config('mp.li_r', '', true); return; end if;
  perform set_config('mp.li_q', coalesce(_mp_leg_quad(r.legs)::text, ''), true);
  perform set_config('mp.li_pm', coalesce(_mp_leg_pm(r.legs)::text, ''), true);
  perform set_config('mp.li_dz', coalesce(_mp_leg_dz(r.legs)::text, ''), true);
  perform set_config('mp.li_fd', coalesce(_mp_leg_fed(r.legs)::text, ''), true);   -- 変電所から電気が来ているか（DB の更新89）
  perform set_config('mp.li_r', rid::text, true);
end $$;

create or replace function public._mp_unko_new(p_kind text, p_sub text, p_sta bigint, p_x int, p_y int, p_routes bigint[], p_lv int, p_sev real, p_sevmax real, p_dur int,
                                               p_ou uuid, p_oc int) returns bigint
language plpgsql set search_path = public as $$
declare z mp_unko; ts0 float8 := extract(epoch from now()); human boolean; prov float8; who uuid; q record; txt text; fc text; md text; tag text;
begin
  human := (p_ou is not null and not exists (select 1 from profiles where id = p_ou and ai is not null))
        or (p_oc is not null and exists (select 1 from companies c where c.id = p_oc and c.ai is null and not coalesce(c.official, false)
                                           and not exists (select 1 from profiles p where p.id = c.owner and p.ai is not null)));
  md := coalesce((select kind from mp_routes where id = p_routes[1]), 'rail');
  tag := case md when 'air' then '【運航】' when 'ship' then '【運航】' else '【運行】' end;
  prov := case when p_kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail', 'atc', 'traffic', 'volt') then 0.6 else 0 end;   -- えらぶまで：天気・混雑は徐行（待つ）、ほかは その場で止まる
  insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode, zs)
    values (p_kind, coalesce(p_sub, ''), p_sta, p_x, p_y, p_routes, p_ou, p_oc, p_lv, p_sev, p_sevmax, p_dur, to_timestamp(ts0 + 600),
            jsonb_build_array(jsonb_build_array(ts0, ts0 + 600, prov, 0, 'v')), to_timestamp(ts0 + 600), md,
            _mp_unko_zone(p_kind, p_sta, p_x, p_y, p_routes))   -- 場所の駅（列車がきくのは、この駅と となりの駅のあいだ。DB の更新60）
    returning * into z;
  fc := case when z.kind in ('wind', 'rain', 'snow') and z.sevmax > z.sev + 0.5 then format('（これから %s ぐらいまで強くなる予報）',
          case z.kind when 'wind' then round(z.sevmax) || 'm/s' when 'rain' then round(z.sevmax) || 'mm' else round(z.sevmax) || 'cm' end)
             when z.kind = 'fog' and z.sevmax < z.sev - 20 then format('（これから 見通し %sm ぐらいまで悪くなる予報）', round(z.sevmax))   -- DB の更新66
             when z.kind = 'heat' and z.sevmax > z.sev + 0.5 then format('（これから %s℃ ぐらいまで上がる予報）', round(z.sevmax)) else '' end;
  txt := _mp_unko_where(z) || 'で' || _mp_unko_why(z);
  update mp_unko set log = jsonb_build_array(jsonb_build_array(ts0, txt || fc)) where id = z.id;
  if not human then perform _mp_unko_apply(z.id, case p_lv when 1 then 1 when 2 then 3 else 5 end, true); end if;   -- 人でない（国・AI・国営）：すぐに よい対応
  -- 知らせ（🔔）。えらぶ人には「えらんでください」
  if human then
    who := coalesce(p_ou, (select owner from companies where id = p_oc));
    perform _notice_l(who, format(tag || '%s：%s%s。対応をえらんでください（10分以内。あとから変えられます。国土 → 🚦運行情報）',
                                  (select string_agg(r.name, '・' order by r.id) from mp_routes r where r.id = any(p_routes) and r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc),
                                  txt, fc), jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
  end if;
  for q in select coalesce(r.own_u, c.owner) u, string_agg(r.name, '・' order by r.id) nm from mp_routes r left join companies c on c.id = r.own_c
            where r.id = any(p_routes) and not (r.own_u is not distinct from p_ou and r.own_c is not distinct from p_oc) and (r.own_u is not null or r.own_c is not null)
            group by 1 loop
    if q.u is not null and q.u is distinct from who then
      perform _notice_l(q.u, format(tag || '%sで%sのため、%sにも遅れが出ています（国土 → 🚦運行情報）', _mp_unko_where(z), _mp_unko_why(z), q.nm),
                        jsonb_build_object('go', 'map', 'k', 'unko', 'id', z.id), null);
    end if;
  end loop;
  return z.id;
end $$;

create or replace function public._mp_unko_apply(p_id bigint, p_pick int, p_auto boolean) returns void
language plpgsql set search_path = public as $$
declare z mp_unko; td float8 := extract(epoch from now()); t0 float8; te float8; ww jsonb := '[]'::jsonb; e jsonb; fit text; f float8; len float8; tr text; lg jsonb;
        rate float8; thin int; ed float8; md text; who text; first boolean; tg text; stopt text; wd int;
begin
  select * into z from mp_unko where id = p_id for update;
  if not found or z.st = 'done' then return; end if;
  first := z.st = 'ask'; md := coalesce(z.mode, 'rail');
  wd := case when z.wide then 1 else 0 end;   -- 全線（窓の6つめ。DB の更新60）
  t0 := extract(epoch from z.t0); te := t0 + z.dur; td := greatest(td, t0);
  -- いままでの窓：過ぎたところはのこす（いまをまたぐものは、いまで切る）。はじまったトラブルはそのまま、まだのトラブル・これからの対応はすてる
  for e in select v from jsonb_array_elements(z.wins) v loop
    tg := coalesce(e ->> 4, 'p');
    if (e ->> 0)::float8 >= td then continue; end if;
    if tg <> 't' and (e ->> 1)::float8 > td then e := jsonb_set(e, '{1}', to_jsonb(td)); end if;
    if (e ->> 1)::float8 > (e ->> 0)::float8 then ww := ww || jsonb_build_array(e); end if;
  end loop;
  fit := _mp_unko_fit(z.lv, p_pick);
  rate := case p_pick when 1 then 1 when 2 then 0.85 when 3 then 0.6 when 4 then 0.75 else 0 end;
  thin := case when p_pick = 4 then 1 else 0 end;
  ed := greatest(td + case when p_pick >= 4 then 600 else 300 end, te) + case when p_pick = 5 then 600 else 0 end;   -- 見合わせは、あとの点検10分
  if fit = 'over' then ed := ed + 900; end if;
  who := case when p_auto and z.own_u is null and z.own_c is null then '国' when p_auto then '現場の判断' else _mp_pname(z.own_u, z.own_c, false) end;
  lg := jsonb_build_array(jsonb_build_array(td, format('%s：%s%s%s%s（%s）', case when first then '対応' else '対応を変えました' end, _mp_unko_pickt(p_pick, md), case when z.wide then '・全線' else '' end,
                          case when z.det is not null and not z.wide then '・迂回' else '' end, case when z.ori and not z.wide then '・区間の外は折り返し運転' else '' end, who)));   -- DB の更新82
  stopt := case md when 'air' then '欠航しています' when 'ship' then '欠航しています' when 'bus' then '運休しています' else '運転を見合わせています' end;
  if fit = 'under' and td < te then
    f := case when z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick > 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, rate, thin, 'p', wd)); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0, 0, 't', wd));
    tr := case z.kind when 'wind' then case md when 'ship' then '高い波で船が大きくゆれ、港へもどりました' when 'air' then '強い横風で着陸をやりなおし、空港を閉じました' when 'bus' then '強風で倒れた木が道路をふさぎました' else '架線に飛来物がひっかかりました' end
                      when 'rain' then case md when 'bus' then '冠水した道路で車両が動けなくなりました' when 'air' then '雷雲で出発できなくなりました' else '線路に土砂が流れこみました' end
                      when 'snow' then case md when 'bus' then '雪でバスが立ち往生しました' when 'air' then '滑走路の除雪がおいつかなくなりました' else 'ポイントが雪で動かなくなりました' end
                      when 'fog' then case md when 'air' then '霧で着陸をやりなおし、ほかの空港へ向かいました' when 'ship' then '霧で前が見えず、港へもどりました' when 'bus' then '霧で前が見えず、追突事故が起きました' else '霧で信号が見えにくくなりました' end
                      when 'heat' then '暑さでレールがゆがみました' when 'hail' then 'ひょうで機体がへこみ、点検が必要になりました'
                      when 'person' then '現場の確認がやりなおしになりました' when 'car' then case md when 'air' then '機材の不具合が大きくなりました（交換の機体を手配します）' when 'ship' then 'エンジンの不具合が大きくなりました' else '車両の故障が大きくなりました（車両を交換します）' end
                      when 'signal' then '信号の故障が広がりました' when 'bird' then '機体の点検で、ほかにも傷が見つかりました' when 'rwy' then '滑走路に落下物が見つかり、閉鎖しました'
                      when 'atc' then '管制の混雑がひどくなりました' when 'wave' then 'うねりが大きくなり、港へもどりました' when 'accident' then '事故の処理に時間がかかっています' when 'traffic' then '渋滞がひどくなりました'
                      when 'volt' then '電圧がさらに下がり、電車が動けなくなりました' when 'power' then '変電所の復旧に時間がかかっています'   -- DB の更新89
                      else '安全確認がやりなおしになりました' end;
    lg := lg || jsonb_build_array(jsonb_build_array(td + f, tr || '。' || stopt));
    if not z.pen then
      update mp_routes set trust = greatest(0.7, trust - 0.03) where id = any(z.routes) and own_u is not distinct from z.own_u and own_c is not distinct from z.own_c;
      update mp_unko set pen = true where id = p_id;
    end if;
  elsif p_pick > 1 then
    ww := ww || jsonb_build_array(jsonb_build_array(td, ed, rate, thin, 'p', wd));
    if fit = 'over' then lg := lg || jsonb_build_array(jsonb_build_array(greatest(td + 60, ed - 900), '念のため、点検・確認をつづけています')); end if;
  end if;
  ed := coalesce((select max((x ->> 1)::float8) from jsonb_array_elements(ww) x), td);
  -- 記録：これからの予定（前の対応のトラブルなど）はけして、新しいものを足す
  update mp_unko set pick = p_pick, pick_at = to_timestamp(td), pick_auto = p_auto, wins = ww, t_end = to_timestamp(greatest(ed, td)), st = 'run',
         log = (select coalesce(jsonb_agg(l order by o), '[]'::jsonb) from jsonb_array_elements(log) with ordinality x(l, o) where (l ->> 0)::float8 <= td + 1) || lg
   where id = p_id;
end $$;

create or replace function public._mp_unko_zone(p_kind text, p_sta bigint, p_x int, p_y int, p_routes bigint[]) returns bigint[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct q.sid), '{}'::bigint[])
    from (select s.id sid from mp_routes ro, unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid
           where ro.id = any(p_routes) and p_kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail', 'volt', 'power') and abs(s.x - p_x) <= 20000 and abs(s.y - p_y) <= 20000
             and (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2 <= 400000000::float8
          union all
          select p_sta where p_sta is not null
          union all
          select (select s.id from unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid order by (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2, s.id limit 1)
            from mp_routes ro where ro.id = any(p_routes)) q
   where q.sid is not null
$$;

create or replace function public.mp_area(p_x0 int, p_y0 int, p_x1 int, p_y1 int, p_lod int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); b box; r jsonb; me_cs int[];
begin
  perform _mp_ok(u);
  if p_x1 - p_x0 > 6000 or p_y1 - p_y0 > 6000 then raise exception '範囲が広すぎます'; end if;
  if p_lod = 0 and (p_x1 - p_x0) * (p_y1 - p_y0) > 360000 then p_lod := 1; end if;
  b := box(point(p_x0, p_y0), point(p_x1, p_y1));
  me_cs := array(select id from companies where owner = u);
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
                  || case when s.kind = 'rail' and s.elec then jsonb_strip_nulls(jsonb_build_object('fd', _mp_feed(s.id))) else '{}'::jsonb end), '[]'::jsonb)   -- 電気をとどける変電所（DB の更新89）
               from mp_segs s where s.bb && b and (p_lod = 0 or s.kind = 'rail' or s.cls in ('exp', 'nat', 'pref') or (p_lod = 1 and s.art))
                 and (p_lod < 2 or s.kind = 'rail' or s.cls in ('exp', 'nat'))
                 and (p_lod < 3 or s.kind = 'rail' or s.cls = 'exp')),   -- lod 3（とても遠く。t108）：線路と高速だけ
    'nodes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'k', n.kind, 'x', n.x, 'y', n.y, 'n', n.name, 'nk', n.nk)), '[]'::jsonb)
               from mp_nodes n where p_lod < 3 and (n.name is not null or p_lod = 0) and n.x between p_x0 * 100 and p_x1 * 100 and n.y between p_y0 * 100 and p_y1 * 100
                 and (n.name is not null or exists (select 1 from mp_segs s where s.n0 = n.id and not s.gov) or exists (select 1 from mp_segs s where s.n1 = n.id and not s.gov))),
    'stas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'k', s.kind, 'seg', s.seg, 'at', s.at, 'x', s.x, 'y', s.y, 'a', s.ang, 'pl', s.plat, 'tr', s.tracks, 'n', s.name, 'ln', s.lend, 'b', s.bld,
                  'tk', case when s.kind = 'rail' then _mp_sta_trk(s) end,
                  'mine', coalesce(s.own_u = u or s.own_c = any(me_cs), false), 'o', case when s.own_u is not null then 'u:' || s.own_u when s.own_c is not null then 'c:' || s.own_c else 'gov' end,
                  'rt', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'c', ro.color, 'n', ro.name)), '[]'::jsonb) from mp_routes ro where s.id = any(ro.stops)))
                  || case when s.melt then jsonb_build_object('ml', 1) else '{}'::jsonb end
                  || case when s.water then jsonb_build_object('wt', 1) else '{}'::jsonb end || case when s.coal then jsonb_build_object('cl', 1) else '{}'::jsonb end   -- 給水・給炭（DB の更新78）
                  || coalesce((select jsonb_build_object('sn', round(sn.dep)) from mp_snow sn where sn.sta = s.id and sn.dep >= 1), '{}'::jsonb)
                  || case when s.kind = 'rail' then coalesce((select jsonb_build_object('zl', v) from (select _mp_sta_lv(s.seg, s.at, s.x, s.y) v) q where v is not null), '{}'::jsonb) else '{}'::jsonb end), '[]'::jsonb)
               from mp_stations s where s.x between (p_x0 - 5) * 100 and (p_x1 + 5) * 100 and s.y between (p_y0 - 5) * 100 and (p_y1 + 5) * 100 and (p_lod < 2 or s.kind in ('rail', 'air'))),
    'deps', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'k', d.kind, 'seg', d.seg, 'at', d.at, 'side', d.side, 'sz', d.size, 'x', d.x, 'y', d.y, 'a', d.ang, 'n', d.name, 'cap', d.cap, 'b', d.bld,
                  'mine', coalesce(d.own_u = u or d.own_c = any(me_cs), false)) || case when d.plows > 0 then jsonb_build_object('pw', d.plows) else '{}'::jsonb end), '[]'::jsonb)
               from mp_depots d where d.x between (p_x0 - 13) * 100 and (p_x1 + 13) * 100 and d.y between (p_y0 - 13) * 100 and (p_y1 + 13) * 100 and p_lod < 2),
    -- 航路（t54o）：海の上の折れ線（区間ごと。1/100 マス）
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'k', r.kind, 'c', r.color, 'n', r.name, 'ok', r.ok, 'mine', coalesce(r.own_u = u or r.own_c = any(me_cs), false),
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
    -- 建物：[id, 筆, 種類, 階, 区画 [X0, Y0, …], 名前, 入っている部屋の割合（%）, 1 他人・2 自分・3 国]
    'blds', case when p_lod > 0 then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(b.id, b.parcel, b.kind, b.floors, to_jsonb(b.cells), b.name,
                  (select round(100.0 * count(*) filter (where x.t_kind is not null or x.mode = 'self') / greatest(count(*), 1)) from mp_units x where x.bld = b.id),
                  case when pa.gov then 3 when coalesce(pa.own_u = u or pa.own_c = any(me_cs), false) then 2 else 1 end)), '[]'::jsonb)
               from mp_blds b join mp_parcels pa on pa.id = b.parcel where pa.bb && box(point(p_x0 * 5, p_y0 * 5), point(p_x1 * 5, p_y1 * 5))) end,
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
    -- 変電所（DB の更新89）：[id, 場所, 名前, 方式, 大きさ, 容量, 負荷, 止まっている, 自分の, 持ち主のキー]
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'x', ss.x, 'y', ss.y, 'n', ss.name, 'ps', ss.ps, 'sz', ss.sz, 'cap', ss.cap, 'ld', ss.load,
                  'tr', coalesce(ss.trip > now(), false), 'mine', coalesce(ss.own_u = u or ss.own_c = any(me_cs), false) or (ss.gov and _is_admin(u)),
                  'o', case when ss.gov then 'gov' when ss.own_u is not null then 'u:' || ss.own_u else 'c:' || ss.own_c end)), '[]'::jsonb)
               from mp_subs ss where p_lod < 2 and ss.x between (p_x0 - 3) * 100 and (p_x1 + 3) * 100 and ss.y between (p_y0 - 3) * 100 and (p_y1 + 3) * 100),
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1, 'subs2', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）・subs2：変電所（DB の更新89）
  return r;
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
  -- 変電所（DB の更新89）：走る区間に、電気の来ていない（変電所から遠い）電化した線があれば走れない
  if perf is not null and r.kind = 'rail' and (perf ->> 'elec')::boolean
     and exists (select 1 from unnest(case when current_setting('mp.li_r', true) = r.id::text then nullif(current_setting('mp.li_fd', true), '')::boolean[] else _mp_leg_fed(r.legs) end) with ordinality x(f, lo)
                  where x.lo >= least(ord[k0], ord[k1]) and x.lo < greatest(ord[k0], ord[k1]) and not x.f) then   -- 組みなおしのあいだは系統ごとに1回だけ計算したもの
    ws := ws || '変電所から遠く、電気が来ていない区間があります（変電所をつくってください。電車は走れません）'::text;
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
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    xg := 0; xa := 0; xb := 0; xrm := 0; xdin := 0; xlng := 0; xbag := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null; nwk := 0; nrun := 0; nsub := 0;
    lfd := case when r.kind = 'rail' then _mp_leg_fed(r.legs) end; rsh := case when r.kind = 'rail' then _mp_route_feed(r.legs) end;   -- 変電所（DB の更新89）
    begin upc := _mp_unko_rt(r.id, h0, h0 + 3600 * 8); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）。乱れの区間つき（DB の更新60）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
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
    lastj := lastj || jsonb_strip_nulls(jsonb_build_object('fee', nullif(round(xfee), 0), 'meal', nullif(round(xmeal), 0), 'bag', nullif(round(xbagr), 0), 'sub', nullif(nsub, 0)));   -- sub：代走の本数（DB の更新80）   -- うち料金・食堂・荷物と郵便（DB の更新72）
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
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when quad then 2.6 when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
      union all select own_u, own_c, upk, '変電所' from mp_subs where not gov   -- 変電所（DB の更新89）
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

-- 変電所をつくる（DB の更新89）：自分の電化した線路の上に。大きさ p_sz（0 小・1 中・2 大）。名前（なければ近い駅の名前＋変電所）。
--   電気が新しく来るようになった線を通る系統の時刻（走れるか）を計算しなおす
create or replace function public.mp_sub_build(p_seg bigint, p_x real, p_y real, p_sz int, p_name text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; q record; p record; sp jsonb; sz smallint := least(2, greatest(0, coalesce(p_sz, 1)))::smallint; nm text; rr real; nid bigint;
        newf bigint[]; rid bigint; nr int := 0; cst bigint; x record;
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_seg;
  if not found or sg.kind <> 'rail' then raise exception '線路が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線路ではありません'; end if;
  if not sg.elec then raise exception '電化した線路にだけ つくれます'; end if;
  select * into q from _mp_proj(sg.pts, p_x, p_y);
  if q.dist > 1 then raise exception '線路の上をえらんでください'; end if;
  select * into p from _mp_at(sg.pts, q.s);
  if exists (select 1 from mp_subs v where (v.x - p.x * 100)::float8 ^ 2 + (v.y - p.y * 100)::float8 ^ 2 < 40000) then raise exception 'すぐ近く（100m 以内）に変電所があります'; end if;
  sp := _mp_sub_spec(sg.ps, sz); rr := _mp_sub_r(sg.ps);
  cst := case when sg.gov then 0 else (sp ->> 'cost')::bigint end;
  nm := left(coalesce(nullif(btrim(p_name), ''), _mp_sub_name(round(p.x * 100)::int, round(p.y * 100)::int)), 30);
  -- 電気が新しく来る線（いまは来ていない、同じ持ち主・方式の電化した線で、とどくところ）
  newf := array(select x2.id from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = sg.ps and x2.own_u is not distinct from sg.own_u and x2.own_c is not distinct from sg.own_c
                  and x2.gov = sg.gov and (x2.bb <-> point(p.x, p.y)) <= rr and _mp_feed(x2.id) is null);
  if p_dry then
    return jsonb_build_object('cost', cst, 'cap', sp -> 'cap', 'upk', sp -> 'upk', 'ps', sg.ps, 'name', nm, 'newfed', coalesce(array_length(newf, 1), 0), 'km', round((rr * 50 / 1000)::numeric));
  end if;
  perform _mp_lock(sg.own_u, sg.own_c);
  if cst > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, cst, 'rail', format('変電所「%s」の工事（%s）', nm, case sz when 0 then '小' when 1 then '中' else '大' end)); end if;
  insert into mp_subs(seg, x, y, own_u, own_c, gov, ps, sz, cap, upk, name, cost)
    values (sg.id, round(p.x * 100), round(p.y * 100), sg.own_u, sg.own_c, sg.gov, sg.ps, sz, (sp ->> 'cap')::int, (sp ->> 'upk')::int, nm, cst) returning id into nid;
  -- 地図：変電所のまわりと、電気をうけとる線（エアセクションが変わる）
  perform _mp_chg('seg', sg.id, 'set', box(point(p.x - 3, p.y - 3), point(p.x + 3, p.y + 3)));
  for x in select x2.id, x2.bb from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = sg.ps and x2.own_u is not distinct from sg.own_u and x2.own_c is not distinct from sg.own_c
             and x2.gov = sg.gov and (x2.bb <-> point(p.x, p.y)) <= rr loop
    perform _mp_chg('seg', x.id, 'set', x.bb);
  end loop;
  for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
              where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = any(newf) loop
    perform _mp_resched(rid); nr := nr + 1;
  end loop;
  return jsonb_build_object('id', nid, 'cost', cst, 'name', nm, 'routes', nr);
end $$;
-- 変電所の大きさ・名前を変える（DB の更新89）：大きくするのは差の工事費。小さくするのは無料（返金なし）
create or replace function public.mp_sub_set(p_id bigint, p_sz int, p_name text, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); v mp_subs; me_cs int[]; nsz smallint; sp jsonb; sp0 jsonb; cst bigint := 0;
begin
  perform _mp_ok(u);
  select * into v from mp_subs where id = p_id;
  if not found then raise exception '変電所が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(v.own_u = u or v.own_c = any(me_cs) or (v.gov and _is_admin(u)), false) then raise exception 'あなたの変電所ではありません'; end if;
  nsz := least(2, greatest(0, coalesce(p_sz, v.sz)))::smallint;
  sp := _mp_sub_spec(v.ps, nsz); sp0 := _mp_sub_spec(v.ps, v.sz);
  if not v.gov and nsz > v.sz then cst := greatest(0, (sp ->> 'cost')::bigint - (sp0 ->> 'cost')::bigint); end if;
  if p_dry then return jsonb_build_object('cost', cst, 'cap', greatest((sp ->> 'cap')::int, case when nsz >= v.sz then v.cap else 0 end), 'upk', sp -> 'upk'); end if;
  perform _mp_lock(v.own_u, v.own_c);
  if cst > 0 then perform _mp_pay(v.own_u, v.own_c, v.gov, cst, 'rail', format('変電所「%s」を大きく', v.name)); end if;
  update mp_subs set sz = nsz, cap = greatest((sp ->> 'cap')::int, case when nsz >= v.sz then v.cap else 0 end), upk = (sp ->> 'upk')::int, cost = cost + cst,
                     name = coalesce(left(nullif(btrim(p_name), ''), 30), name) where id = p_id;
  perform _mp_chg('seg', coalesce(v.seg, 0), 'set', box(point(v.x / 100.0 - 3, v.y / 100.0 - 3), point(v.x / 100.0 + 3, v.y / 100.0 + 3)));
  return jsonb_build_object('id', p_id, 'cost', cst);
end $$;
-- 変電所をこわす（DB の更新89。返金なし）：電気が来なくなる線を通る系統の時刻（走れるか）を計算しなおす
create or replace function public.mp_sub_del(p_id bigint, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); v mp_subs; me_cs int[]; lost bigint[]; rid bigint; nr int := 0; rts bigint[]; x record;
begin
  perform _mp_ok(u);
  select * into v from mp_subs where id = p_id;
  if not found then raise exception '変電所が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(v.own_u = u or v.own_c = any(me_cs) or (v.gov and _is_admin(u)), false) then raise exception 'あなたの変電所ではありません'; end if;
  -- この変電所だけが電気をとどけている線（こわすと電気が来なくなる）
  lost := array(select x2.id from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = v.ps and x2.own_u is not distinct from v.own_u and x2.own_c is not distinct from v.own_c
                  and x2.gov = v.gov and _mp_feed(x2.id) = p_id
                  and not exists (select 1 from mp_subs w where w.id <> p_id and w.ps = x2.ps and w.own_u is not distinct from x2.own_u and w.own_c is not distinct from x2.own_c and w.gov = x2.gov
                                    and (x2.bb <-> point(w.x / 100.0, w.y / 100.0)) <= _mp_sub_r(x2.ps)));
  rts := array(select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = any(lost));
  if p_dry then return jsonb_build_object('lost', coalesce(array_length(lost, 1), 0), 'routes', coalesce(array_length(rts, 1), 0)); end if;
  perform _mp_lock(v.own_u, v.own_c);
  for x in select x2.id, x2.bb from mp_segs x2 where x2.kind = 'rail' and x2.elec and x2.ps = v.ps and x2.own_u is not distinct from v.own_u and x2.own_c is not distinct from v.own_c
             and x2.gov = v.gov and _mp_feed(x2.id) = p_id loop
    perform _mp_chg('seg', x.id, 'set', x.bb);
  end loop;
  delete from mp_subs where id = p_id;
  perform _mp_chg('seg', coalesce(v.seg, 0), 'set', box(point(v.x / 100.0 - 3, v.y / 100.0 - 3), point(v.x / 100.0 + 3, v.y / 100.0 + 3)));
  foreach rid in array coalesce(rts, '{}'::bigint[]) loop perform _mp_resched(rid); nr := nr + 1; end loop;
  return jsonb_build_object('id', p_id, 'lost', coalesce(array_length(lost, 1), 0), 'routes', nr);
end $$;

-- いまの電化区間に変電所をおく（無料）
select _mp_sub_auto() subs_placed;
-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_sub_spec', '_mp_sub_r', '_mp_feed', '_mp_leg_fed', '_mp_route_feed', '_mp_sub_name', '_mp_sub_auto', '_mp_sub_event',
                                                         '_mp_li_put', '_mp_unko_new', '_mp_unko_apply', '_mp_unko_zone', '_mp_train_times', '_mp_tick_hour', 'mp_area', 'mp_sub_build', 'mp_sub_set', 'mp_sub_del') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 変電所をつくる・こわすと、通る系統の時刻を計算しなおすので60秒まで
alter function public.mp_sub_build(bigint, real, real, int, text, boolean) set statement_timeout = '60s';
alter function public.mp_sub_del(bigint, boolean) set statement_timeout = '60s';
