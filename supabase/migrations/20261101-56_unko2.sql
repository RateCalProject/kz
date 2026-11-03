-- 運行の乱れ その2：対応を5つに（点検しながら・徐行・間引き運転＝一部の列車を運休・見合わせ）・あとから変えられる・「正しい対応」は見せない・
--   飛行機・船・バスにも乱れ（強風・大雪・大雨・機材・バードストライク・滑走路・管制・高波・交通事故・渋滞など）・管理者は続けて起こせる

alter table public.mp_unko add column if not exists mode text not null default 'rail';   -- rail・bus・ship・air（乗りもの）
alter table public.mp_unko add column if not exists pen boolean not null default false;  -- 線の信頼を下げたか（1回だけ）

drop function if exists public._mp_unko_pickt(int);
-- 対応の名前（乗りものごと）。1 いつもどおり・2 点検しながら・3 徐行（待つ）・4 一部を運休（間引き）・5 見合わせ（欠航・運休）
create or replace function public._mp_unko_pickt(p int, md text) returns text
language sql immutable as $$
  select case when md in ('air', 'ship') then case p when 1 then '定刻どおり運航する' when 2 then '点検してから運航する' when 3 then '出発を見合わせて待つ'
                                                    when 4 then '一部の便を欠航する' else '全便を欠航する' end
              when md = 'bus' then case p when 1 then 'いつもどおり運行する' when 2 then '安全を確認しながら運行する' when 3 then '徐行・迂回して運行する'
                                          when 4 then '一部の便を運休する' else '運休する' end
              else case p when 1 then 'いつもどおり運転する' when 2 then '点検しながら運転する' when 3 then '徐行運転する'
                          when 4 then '間引き運転（一部の列車を運休）' else '運転を見合わせる' end end
$$;
-- 対応のよしあし（画面には出さない）：ひどさ lv（1 軽い・2 ふつう・3 重い）と対応 p → ok・over（慎重すぎ）・under（あまい）
create or replace function public._mp_unko_fit(lv int, p int) returns text
language sql immutable as $$
  select case lv when 1 then case when p <= 3 then 'ok' else 'over' end
                 when 2 then case when p = 1 then 'under' when p = 5 then 'over' else 'ok' end
                 else case when p = 5 then 'ok' else 'under' end end
$$;
-- 時刻 t に、系統 rid の列車の一部を運休しているか（間引き。列車の番号が奇数のものを運休）
create or replace function public._mp_unko_thin_at(rid bigint, t float8) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from mp_unko z, jsonb_array_elements(z.wins) e
                  where z.routes @> array[rid] and z.st <> 'ask' and z.t0 < to_timestamp(t + 1) and coalesce(z.t_end, now() + interval '1 day') > to_timestamp(t - 1)
                    and coalesce((e ->> 3)::int, 0) = 1 and (e ->> 0)::float8 <= t and t < (e ->> 1)::float8)
$$;
-- ことば：場所（駅・空港・港・バス停）
create or replace function public._mp_unko_where(z mp_unko) returns text
language sql stable set search_path = public as $$
  select coalesce((select s.name || case s.kind when 'rail' then '駅' when 'bus' then '（バス停）' else '' end from mp_stations s where s.id = z.sta),
                  case coalesce(z.mode, 'rail') when 'rail' then '線路' when 'bus' then '道路' when 'ship' then '航路' else '空路' end)
         || case when z.kind in ('wind', 'rain', 'snow') then 'のあたり' else '' end
$$;
create or replace function public._mp_unko_why(z mp_unko) returns text
language sql stable set search_path = public as $$
  select case z.kind when 'wind' then case when z.mode = 'ship' then format('強い風と高い波（最大瞬間 %sm/s）', round(z.sev)) else format('強い風（最大瞬間 %sm/s）', round(z.sev)) end
                     when 'rain' then case when z.mode = 'bus' then format('大雨で道路が冠水（1時間に %smm）', round(z.sev)) else format('強い雨（1時間に %smm）', round(z.sev)) end
                     when 'snow' then case when z.mode = 'air' then format('大雪で滑走路の除雪（1時間に %scm）', round(z.sev)) else format('強い雪（1時間に %scm）', round(z.sev)) end
                     else z.sub end
$$;

-- 天気の強さ（乗りものごとの目安）。lv：2 気をつける・3 とても危ない
--   鉄道：風 20/25m/s・雨 30/50mm・雪 3/7cm　バス：風 25/30・雨 40/70（冠水）・雪 2/5　船：風 15/20（波）　飛行機：風 18/25（横風）・雪 2/5（除雪）・雨 60/90
create or replace function public._mp_unko_lvl(md text, k text, v float8) returns int
language sql immutable as $$
  select case
    when k = 'wind' then case md when 'bus' then case when v >= 30 then 3 when v >= 25 then 2 else 0 end
                                 when 'ship' then case when v >= 20 then 3 when v >= 15 then 2 else 0 end
                                 when 'air' then case when v >= 25 then 3 when v >= 18 then 2 else 0 end
                                 else case when v >= 25 then 3 when v >= 20 then 2 else 0 end end
    when k = 'rain' then case md when 'bus' then case when v >= 70 then 3 when v >= 40 then 2 else 0 end
                                 when 'ship' then 0
                                 when 'air' then case when v >= 90 then 3 when v >= 60 then 2 else 0 end
                                 else case when v >= 50 then 3 when v >= 30 then 2 else 0 end end
    when k = 'snow' then case md when 'bus' then case when v >= 5 then 3 when v >= 2 then 2 else 0 end
                                 when 'ship' then 0
                                 when 'air' then case when v >= 5 then 3 when v >= 2 then 2 else 0 end
                                 else case when v >= 7 then 3 when v >= 3 then 2 else 0 end end
    else 0 end
$$;
drop function if exists public._mp_unko_wxk(float8, float8, float8, bigint, text);
create or replace function public._mp_unko_wxk(x float8, y float8, e float8, ms bigint, k text, md text, out lv int, out sev float8)
language plpgsql stable set search_path = public as $$
declare o record; w record;
begin
  lv := 0; sev := 0;
  if k = 'wind' then w := _wx_wind(x, y, ms); sev := w.gust; lv := _mp_unko_lvl(md, 'wind', sev); return; end if;
  o := _wx_core(x, y, e, ms);
  if k = 'rain' and o.kind = 'rain' then sev := _wx_mm(o.inten); lv := _mp_unko_lvl(md, 'rain', sev); end if;
  if k = 'snow' and o.kind = 'snow' then sev := _wx_cm(o.inten); lv := _mp_unko_lvl(md, 'snow', sev); end if;
end $$;
drop function if exists public._mp_unko_wxat(float8, float8, float8, bigint);
create or replace function public._mp_unko_wxat(x float8, y float8, e float8, ms bigint, md text, out kind text, out lv int, out sev float8)
language plpgsql stable set search_path = public as $$
declare o record; w record; v float8; l int;
begin
  kind := null; lv := 0; sev := 0;
  o := _wx_core(x, y, e, ms);
  if o.kind = 'rain' then v := _wx_mm(o.inten); l := _mp_unko_lvl(md, 'rain', v); if l > lv then kind := 'rain'; lv := l; sev := v; end if; end if;
  if o.kind = 'snow' then v := _wx_cm(o.inten); l := _mp_unko_lvl(md, 'snow', v); if l > lv then kind := 'snow'; lv := l; sev := v; end if; end if;
  w := _wx_wind(x, y, ms); l := _mp_unko_lvl(md, 'wind', w.gust);
  if l > lv then kind := 'wind'; lv := l; sev := w.gust; end if;
end $$;

-- 対応を決める・変える（えらんだ・現場の判断）：これからの列車の窓を作りなおす（過ぎたところ・はじまったトラブルはそのまま）
--   窓：[はじめ, おわり, 速さ（0 止まる〜1）, 間引き（1 なら列車の半分を運休）, 印（v 決めるまで・p 対応・t トラブル）]
--   よい対応：予定どおり。慎重すぎ：15分ながく。あまい：しばらくすると、トラブルで長く止まる（のこりの1.5倍・30分より長く。線の信頼が下がる・1回だけ）
create or replace function public._mp_unko_apply(p_id bigint, p_pick int, p_auto boolean) returns void
language plpgsql set search_path = public as $$
declare z mp_unko; td float8 := extract(epoch from now()); t0 float8; te float8; ww jsonb := '[]'::jsonb; e jsonb; fit text; f float8; len float8; tr text; lg jsonb;
        rate float8; thin int; ed float8; md text; who text; first boolean; tg text; stopt text;
begin
  select * into z from mp_unko where id = p_id for update;
  if not found or z.st = 'done' then return; end if;
  first := z.st = 'ask'; md := coalesce(z.mode, 'rail');
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
  lg := jsonb_build_array(jsonb_build_array(td, format('%s：%s（%s）', case when first then '対応' else '対応を変えました' end, _mp_unko_pickt(p_pick, md), who)));
  stopt := case md when 'air' then '欠航しています' when 'ship' then '欠航しています' when 'bus' then '運休しています' else '運転を見合わせています' end;
  if fit = 'under' and td < te then
    f := case when z.kind in ('wind', 'rain', 'snow') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick > 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, rate, thin, 'p')); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0, 0, 't'));
    tr := case z.kind when 'wind' then case md when 'ship' then '高い波で船が大きくゆれ、港へもどりました' when 'air' then '強い横風で着陸をやりなおし、空港を閉じました' when 'bus' then '強風で倒れた木が道路をふさぎました' else '架線に飛来物がひっかかりました' end
                      when 'rain' then case md when 'bus' then '冠水した道路で車両が動けなくなりました' when 'air' then '雷雲で出発できなくなりました' else '線路に土砂が流れこみました' end
                      when 'snow' then case md when 'bus' then '雪でバスが立ち往生しました' when 'air' then '滑走路の除雪がおいつかなくなりました' else 'ポイントが雪で動かなくなりました' end
                      when 'person' then '現場の確認がやりなおしになりました' when 'car' then case md when 'air' then '機材の不具合が大きくなりました（交換の機体を手配します）' when 'ship' then 'エンジンの不具合が大きくなりました' else '車両の故障が大きくなりました（車両を交換します）' end
                      when 'signal' then '信号の故障が広がりました' when 'bird' then '機体の点検で、ほかにも傷が見つかりました' when 'rwy' then '滑走路に落下物が見つかり、閉鎖しました'
                      when 'atc' then '管制の混雑がひどくなりました' when 'wave' then 'うねりが大きくなり、港へもどりました' when 'accident' then '事故の処理に時間がかかっています' when 'traffic' then '渋滞がひどくなりました'
                      else '安全確認がやりなおしになりました' end;
    lg := lg || jsonb_build_array(jsonb_build_array(td + f, tr || '。' || stopt));
    if not z.pen then
      update mp_routes set trust = greatest(0.7, trust - 0.03) where id = any(z.routes) and own_u is not distinct from z.own_u and own_c is not distinct from z.own_c;
      update mp_unko set pen = true where id = p_id;
    end if;
  elsif p_pick > 1 then
    ww := ww || jsonb_build_array(jsonb_build_array(td, ed, rate, thin, 'p'));
    if fit = 'over' then lg := lg || jsonb_build_array(jsonb_build_array(greatest(td + 60, ed - 900), '念のため、点検・確認をつづけています')); end if;
  end if;
  ed := coalesce((select max((x ->> 1)::float8) from jsonb_array_elements(ww) x), td);
  -- 記録：これからの予定（前の対応のトラブルなど）はけして、新しいものを足す
  update mp_unko set pick = p_pick, pick_at = to_timestamp(td), pick_auto = p_auto, wins = ww, t_end = to_timestamp(greatest(ed, td)), st = 'run',
         log = (select coalesce(jsonb_agg(l order by o), '[]'::jsonb) from jsonb_array_elements(log) with ordinality x(l, o) where (l ->> 0)::float8 <= td + 1) || lg
   where id = p_id;
end $$;

-- 対応をえらぶ・変える（1〜5）。起きてから、乱れがおわるまで何度でも
create or replace function public.mp_unko_pick(p_id bigint, p_pick int, p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pa record; z mp_unko;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_pick is null or p_pick not between 1 and 5 then raise exception '1〜5 からえらんでください'; end if;
  select * into z from mp_unko where id = p_id for update;
  if not found then raise exception '運行情報が見つかりません'; end if;
  if not (z.own_u is not distinct from pa.pu and z.own_c is not distinct from pa.pc) or pa.gv then
    raise exception 'この対応をえらべるのは「%」です（名義を切りかえてください）', _mp_pname(z.own_u, z.own_c, false);
  end if;
  if z.st = 'done' or (z.st = 'run' and coalesce(z.t_end, now()) <= now() and now() >= z.t0 + make_interval(secs => z.dur)) then raise exception 'この乱れは、もうおわっています'; end if;
  if z.st = 'run' and z.pick = p_pick then raise exception 'いまと同じ対応です'; end if;
  perform _mp_unko_apply(z.id, p_pick, false);
  select * into z from mp_unko where id = p_id;
  return jsonb_build_object('ok', true, 'pick', z.pick, 'tend', extract(epoch from z.t_end));
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
  prov := case when p_kind in ('wind', 'rain', 'snow', 'atc', 'traffic') then 0.6 else 0 end;   -- えらぶまで：天気・混雑は徐行（待つ）、ほかは その場で止まる
  insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode)
    values (p_kind, coalesce(p_sub, ''), p_sta, p_x, p_y, p_routes, p_ou, p_oc, p_lv, p_sev, p_sevmax, p_dur, to_timestamp(ts0 + 600),
            jsonb_build_array(jsonb_build_array(ts0, ts0 + 600, prov, 0, 'v')), to_timestamp(ts0 + 600), md)
    returning * into z;
  fc := case when z.kind in ('wind', 'rain', 'snow') and z.sevmax > z.sev + 0.5 then format('（これから %s ぐらいまで強くなる予報）',
          case z.kind when 'wind' then round(z.sevmax) || 'm/s' when 'rain' then round(z.sevmax) || 'mm' else round(z.sevmax) || 'cm' end) else '' end;
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

create or replace function public._mp_unko_wxr(rid bigint, ms bigint) returns bigint
language plpgsql set search_path = public as $$
declare r record; uz mp_unko; q record; n int; m int; i int; sid bigint; sx int; sy int; se float8;
        blv int := 0; bsev float8 := 0; bkind text; bsid bigint; bx int; by_ int; be float8; mx int; mxs float8; kk int;
begin
  select ro.id, ro.own_u, ro.own_c, ro.stops, ro.kind into r from mp_routes ro where ro.id = rid;
  if not found or coalesce(array_length(r.stops, 1), 0) < 2 then return null; end if;
  n := array_length(r.stops, 1); m := least(n, 6);
  for i in 0..m - 1 loop
    sid := r.stops[1 + (i * (n - 1)) / greatest(1, m - 1)];
    select x, y into sx, sy from mp_stations where id = sid;
    if not found then continue; end if;
    se := coalesce((_mp_cell(floor(sx / 100.0)::int, floor(sy / 100.0)::int)).e, 0);
    q := _mp_unko_wxat(sx / 100.0, sy / 100.0, se, ms, r.kind);
    if q.lv > blv or (q.lv = blv and q.lv > 0 and q.sev > bsev) then blv := q.lv; bsev := q.sev; bkind := q.kind; bsid := sid; bx := sx; by_ := sy; be := se; end if;
  end loop;
  if blv < 2 then return null; end if;
  select * into uz from mp_unko where st <> 'done' and kind = bkind and mode = r.kind and own_u is not distinct from r.own_u and own_c is not distinct from r.own_c
     and t0 > now() - interval '30 minutes' and abs(x - bx) < 80000 and abs(y - by_) < 80000 order by id desc limit 1;
  if found then update mp_unko set routes = routes || r.id where id = uz.id and not (routes @> array[r.id]); return uz.id; end if;
  mx := blv; mxs := bsev; kk := 0;
  while kk < 16 loop
    q := _mp_unko_wxk(bx / 100.0, by_ / 100.0, be, ms + (kk + 1) * 900000, bkind, r.kind);
    exit when q.lv < 2;
    kk := kk + 1; mx := greatest(mx, q.lv); mxs := greatest(mxs, q.sev);
  end loop;
  return _mp_unko_new(bkind, '', bsid, bx, by_, array[r.id], mx, bsev::real, mxs::real, (kk + 1) * 900, r.own_u, r.own_c);
end $$;

-- 5分ごと：対応の期限・おわり・天気（鉄道・バス・船・飛行機）・人と接触など（駅・空港・港・バス停ごと）・1日1回の信頼のもどり
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
                   ["traffic", "渋滞", 1, 15, 40, 3], ["car", "車両の点検", 2, 10, 30, 2], ["sick", "急病のお客さまの救護", 1, 5, 15, 2]]}'::jsonb;
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
  -- 3) 天気：系統ごと（15分に1回）。鉄道・バス・船・飛行機
  for r in select ro.id from mp_routes ro
            where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and ro.id % 3 = bk and coalesce(array_length(ro.stops, 1), 0) >= 2
              and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
              and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[ro.id] and z.kind in ('wind', 'rain', 'snow')) loop
    perform _mp_unko_wxr(r.id, ms);
  end loop;
  -- 4) 人と接触・急病・機材・事故など：駅・空港・港・バス停ごと（人の多さ・朝夕は多く、夜は少ない）
  hw := case when hh < 5 then 0.15 when hh = 5 then 0.6 when hh between 6 and 9 or hh between 16 and 19 then 1.6 else 1 end;
  for s in select st.id, st.x, st.y, st.own_u, st.own_c, w.rs, w.pop, w.k
             from (select u.sid, ro.kind k, array_agg(distinct ro.id order by ro.id) rs, max((ro.catch ->> u.sid::text)::real) pop
                     from mp_routes ro, unnest(ro.stops) u(sid)
                    where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
                    group by u.sid, ro.kind) w join mp_stations st on st.id = w.sid loop
    pr := case s.k when 'rail' then 0.0002 when 'air' then 0.0003 when 'ship' then 0.0002 else 0.00003 end;   -- バス停は数が多いので少なく
    if random() >= pr / 12 * hw * greatest(0.3, least(3, coalesce(s.pop, 5000) / 20000.0)) then continue; end if;
    if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind not in ('wind', 'rain', 'snow') and (z.sta = s.id or z.routes && s.rs)) then continue; end if;
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
    perform _mp_unko_new(tpk ->> 0, tpk ->> 1, s.id, s.x, s.y, s.rs, (tpk ->> 2)::int, null, null, dd, ou, oc);
  end loop;
  -- 5) 1日1回（朝4時台）：信頼が1％もどる。30日より前の記録はけす
  if hh = 4 and not exists (select 1 from mp_state where k = 'unko_day' and v >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') then
    update mp_routes set trust = least(1, trust + 0.01) where trust < 1;
    delete from mp_unko where st = 'done' and t_end < now() - interval '30 days';
    insert into mp_state values ('unko_day', now()) on conflict (k) do update set v = excluded.v;
  end if;
end $$;

create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int;
begin
  begin select x.pu, x.pc into pu, pc from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; end;
  return jsonb_build_object('now', extract(epoch from now()), 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi)) order by r.id), '[]'::jsonb)
                 from mp_routes r where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'));
end $$;

-- 運行の乱れを起こす（管理者だけ。続けて起こせる）：p_sta 駅・空港・港・バス停・p_route 系統（null ならここにとまる系統ぜんぶ）・p_kind 原因・p_sub 理由（天気のときはなし）・
--   p_lv ひどさ（1 軽い・2 ふつう・3 重い。画面には出さない）・p_min 長さ（分）
create or replace function public.mp_unko_make(p_sta bigint, p_route bigint, p_kind text, p_sub text, p_lv int, p_min int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s mp_stations; rs bigint[]; ou uuid; oc int; zid bigint; sev real; sub text; md text;
begin
  perform _mp_ok(u);
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  select * into s from mp_stations where id = p_sta;
  if not found then raise exception '駅・空港・港・バス停をえらんでください'; end if;
  md := s.kind;
  if p_kind is null or not (p_kind = any(case md when 'air' then array['wind', 'rain', 'snow', 'car', 'bird', 'rwy', 'atc', 'sick']
                                                when 'ship' then array['wind', 'car', 'wave', 'sick']
                                                when 'bus' then array['wind', 'rain', 'snow', 'accident', 'traffic', 'car', 'sick']
                                                else array['person', 'sick', 'car', 'signal', 'track', 'wind', 'rain', 'snow'] end)) then raise exception '原因をえらんでください'; end if;
  if p_lv is null or p_lv not in (1, 2, 3) then raise exception 'ひどさを 1・2・3 からえらんでください'; end if;
  if p_min is null or p_min < 3 or p_min > 240 then raise exception '長さは 3〜240分にしてください'; end if;
  rs := array(select ro.id from mp_routes ro
               where ro.ok and ro.kind = md and s.id = any(ro.stops) and (p_route is null or ro.id = p_route)
                 and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
               order by ro.id);
  if coalesce(cardinality(rs), 0) = 0 then raise exception 'ここには、走っている系統（便）がありません'; end if;
  -- 押しまちがい（同じものを1分以内に2回）だけはふせぐ
  if exists (select 1 from mp_unko z where z.sta = s.id and z.kind = p_kind and z.t0 > now() - interval '1 minute') then raise exception 'さっき同じものを起こしました（1分たってから）'; end if;
  if s.own_u is not null or s.own_c is not null then ou := s.own_u; oc := s.own_c;
  else select ro.own_u, ro.own_c into ou, oc from mp_routes ro where ro.id = rs[1]; end if;
  sev := case p_kind when 'wind' then case p_lv when 3 then 28 when 2 then 22 else 16 end
                     when 'rain' then case p_lv when 3 then 75 when 2 then 45 else 20 end
                     when 'snow' then case p_lv when 3 then 9 when 2 then 4 else 2 end end;
  sub := case when p_kind in ('wind', 'rain', 'snow') then ''
              else left(coalesce(nullif(btrim(p_sub), ''), case p_kind when 'person' then '人と接触' when 'sick' then '急病のお客さまの救護'
                                                                         when 'car' then case md when 'air' then '機材の点検' when 'ship' then 'エンジンの点検' else '車両の点検' end
                                                                         when 'signal' then '信号の確認' when 'track' then '線路内の点検' when 'bird' then 'バードストライク（機体の点検）'
                                                                         when 'rwy' then '滑走路の点検' when 'atc' then '管制の混雑' when 'wave' then 'うねりで揺れが大きい'
                                                                         when 'accident' then '交通事故' when 'traffic' then '渋滞' else '点検' end), 40) end;
  zid := _mp_unko_new(p_kind, sub, s.id, s.x, s.y, rs, p_lv, sev, sev, p_min * 60, ou, oc);
  return jsonb_build_object('id', zid, 'routes', cardinality(rs), 'by', _mp_pname(ou, oc, false));
end $$;

create or replace function public._mp_tick_hour(h timestamptz) returns void
language plpgsql set search_path = public as $$
declare r mp_routes; hh int := extract(hour from h at time zone 'Asia/Tokyo')::int; mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
        t0 int; tr record; perf jsonb; ntr int; tph1 real; tph2 real; cap1 bigint; cap2 bigint; cf real; ia int; ib int; catch jsonb; pop real; dem real; dem1 real; dem2 real; served bigint; rev bigint;
        km real; trip real; fare real; spd real; q real; share real; comf real; acn real; htn real; toil real; nok int; broke int; o record; amt bigint; rt real;
        lastj jsonb; secs real; d0 date := ((h - interval '1 hour') at time zone 'Asia/Tokyo')::date; ce jsonb; cperf jsonb; crt real; ccap real;
        upc jsonb; dep_abs float8; ncan int; dsum float8; nd int; lost real; h0 float8 := extract(epoch from h - interval '1 hour');
begin
  -- この1時間（h-1 〜 h）に始発を出た列車（毎日おなじダイヤ。0時をまたぐのも見る）。臨時列車はその日だけ
  t0 := (extract(epoch from (h - interval '1 hour') at time zone 'Asia/Tokyo')::bigint % 86400)::int;
  for r in select * from mp_routes where ok loop
    if r.catch is null then catch := _mp_route_catch(r.id); else catch := r.catch; end if;
    km := coalesce((select sum((l ->> 'd')::real) from jsonb_array_elements(r.legs) l), 0) / 1000;
    tph1 := 0; tph2 := 0; cap1 := 0; cap2 := 0; acn := 0; htn := 0; toil := 0; nok := 0; broke := 0; secs := 0;
    -- 運行の乱れ（DB の更新51）：運転見合わせ中に始発駅を出る列車は運休・遅れ
    ncan := 0; dsum := 0; nd := 0; upc := null;
    begin upc := _mp_unko_pc(r.id, h0, h0 + 3600 * 4); exception when others then upc := null; end;   -- うまくいかなくても、ふだんどおり（鉄道・バス・船・飛行機。t108）
    for tr in select t.*, f.id fid from mp_trains t left join mp_forms f on f.id = t.form
               where t.route = r.id and ((t.dep - t0 + 86400) % 86400) < 3600 and (t.day is null or t.day = d0) loop
      if tr.fid is null or tr.bad then continue; end if;
      perf := _mp_form_perf(tr.fid);
      if perf is null or (perf ->> 'busy')::boolean then continue; end if;
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
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      if upc is not null then
        dep_abs := h0 + ((tr.dep - t0 + 86400) % 86400);
        if _mp_unko_rate(upc, dep_abs) = 0 then ncan := ncan + 1; continue; end if;   -- 運転見合わせで運休（運賃なし・車両はいたまない）
        if tr.id % 2 = 1 and _mp_unko_thin_at(r.id, dep_abs) then ncan := ncan + 1; continue; end if;   -- 間引き運転：列車の半分（番号が奇数）を運休（t108）
      end if;
      -- 故障（状態が 40 より悪いと、ときどき）
      if (perf ->> 'cond')::real < 40 and random() < (40 - (perf ->> 'cond')::real) / 300 then
        broke := broke + 1;
        update mp_trains set warn = concat_ws(' / ', nullif(split_part(coalesce(warn, ''), ' / 故障', 1), ''), format('故障で運休（%s）', to_char(h at time zone 'Asia/Tokyo', 'MM/DD HH24時'))) where id = tr.id;
        continue;
      end if;
      -- 走った時間の分、車両がいたむ（寿命をすぎると2倍）
      rt := coalesce((select max(coalesce((s.v ->> 1)::int, (s.v ->> 2)::int)) - tr.dep from jsonb_array_elements(tr.sched) s(v)), 1800);
      update mp_cars c set cond = greatest(0, cond - 0.035 * rt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
       where form = tr.fid;
      -- 連結している編成（つなぐ駅から切りはなす駅まで）：その分いたみ、定員は走る時間のわりあいで足す
      ccap := 0;
      for ce in select c.v from jsonb_array_elements(tr.cplx) c(v)
                 where coalesce((c.v ->> 'ok')::boolean, false) and exists (select 1 from mp_ops ox where ox.id = (c.v ->> 'op')::bigint and ox.form = (c.v ->> 'f')::bigint) loop
        cperf := _mp_form_perf((ce ->> 'f')::bigint);
        if cperf is null or (cperf ->> 'busy')::boolean then continue; end if;
        crt := greatest(60, coalesce((ce ->> 'tb')::int - (ce ->> 'ta')::int, rt));
        update mp_cars c set cond = greatest(0, cond - 0.035 * crt / 3600.0 * case when now() - born > make_interval(days => (select life from mp_types where code = c.type) * (1 + renewed) / 1) then 2 else 1 end)
         where form = (ce ->> 'f')::bigint;
        ccap := ccap + (cperf ->> 'cap')::int * least(1, crt / greatest(rt, 1));
      end loop;
      if upc is not null then dsum := dsum + _mp_unko_dly(upc, dep_abs, dep_abs + rt); nd := nd + 1; end if;   -- 終点での遅れ（秒）
      if tr.kind in ('回送', '試運転') then continue; end if;   -- お客は乗せない
      nok := nok + 1; secs := secs + rt / cf;
      if tr.dir = 1 then tph1 := tph1 + cf; cap1 := cap1 + round(((perf ->> 'cap')::int + ccap) * cf)::int; else tph2 := tph2 + cf; cap2 := cap2 + round(((perf ->> 'cap')::int + ccap) * cf)::int; end if;
      acn := acn + case when (perf ->> 'ac')::boolean then 1 else 0 end; htn := htn + case when (perf ->> 'heat')::boolean then 1 else 0 end;
      toil := toil + case when (perf ->> 'toilet')::boolean then 1 else 0 end;
    end loop;
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
      update mp_routes set last = jsonb_build_object('at', h, 'tph', 0, 'demand', 0, 'served', 0, 'revenue', 0, 'broke', broke, 'cancel', ncan, 'trust', round(r.trust::numeric, 2)) where id = r.id;
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
    rev := floor(served * fare);
    lastj := jsonb_build_object('at', h, 'tph', case when tph1 + tph2 = floor(tph1 + tph2) then to_jsonb((tph1 + tph2)::int) else to_jsonb(round((tph1 + tph2)::numeric, 1)) end, 'demand', round(dem), 'served', served, 'revenue', rev, 'cap', (cap1 + cap2) * 3, 'fare', round(fare),
             'load', case when cap1 + cap2 > 0 then round(100.0 * served / ((cap1 + cap2) * case when r.kind = 'air' then 1 else 2 end)) else 0 end, 'broke', broke, 'speed', round(spd::numeric, 1),
             'cancel', ncan, 'delay', round((dsum / greatest(nd, 1) / 60)::numeric), 'trust', round(r.trust::numeric, 2));
    update mp_routes set last = lastj where id = r.id;
    insert into mp_hours(route, hour, tph, cap, demand, served, revenue) values (r.id, date_trunc('hour', h), tph1 + tph2, (cap1 + cap2)::int, round(dem)::int, served, rev)
      on conflict (route, hour) do update set tph = excluded.tph, cap = excluded.cap, demand = excluded.demand, served = excluded.served, revenue = excluded.revenue;
  end loop;

  -- 運賃（持ち主ごとにまとめて）
  for o in select r2.own_u pu, r2.own_c pc, sum(x.revenue) amt, count(*) n, sum(x.served) ppl from mp_hours x join mp_routes r2 on r2.id = x.route
            where x.hour = date_trunc('hour', h) and x.revenue > 0 group by r2.own_u, r2.own_c loop
    perform _mp_earn(o.pu, o.pc, false, o.amt::bigint, 'fare', format('運賃（%s時台・%s系統・%s人）', hh, o.n, o.ppl));
  end loop;
  -- 維持費・使用料（1日分の 1/24 ずつ）
  for o in
    select pu, pc, sum(a)::bigint amt, string_agg(distinct k, '・') ks from (
      select own_u pu, own_c pc, len * _mp_rate(case when kind = 'rail' then 'up_rail' else 'up_road' end) * case when dbl then 1.6 else 1 end * case when elec then 1.3 else 1 end a, '線路・道路' k
        from mp_segs where not gov and (kind = 'rail' or cls = 'priv')
      union all select own_u, own_c, case when kind = 'rail' then _mp_rate('up_sta') * (1 + 0.25 * (tracks - 1)) when kind = 'ship' then _mp_rate('up_port') when kind = 'air' then _mp_rate('up_air') * greatest(1, tracks / 2.0) else _mp_rate('up_stop') end, '駅' from mp_stations
      union all select own_u, own_c, case when kind in ('ship', 'air') then 0 else _mp_rate(case when kind = 'rail' then 'up_dep' else 'up_bdep' end) end * case when size like 'T%' then greatest(1, cap / 24.0) when size = 'L' then 5 when size = 'M' then 2.5 else 1 end, '車庫' from mp_depots
      union all select c.own_u, c.own_c, t.upkeep, '車両' from mp_cars c join mp_types t on t.code = c.type
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
      join lateral (select count(*) n from mp_trains x where x.route = ro.id and not x.bad and x.form is not null
                       and ((x.dep - t0 + 86400) % 86400) < 3600 and (x.day is null or x.day = d0)) cnt on cnt.n > 0
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

revoke all on function public._mp_unko_pickt(int, text) from public, anon, authenticated;
revoke all on function public._mp_unko_fit(int, int) from public, anon, authenticated;
revoke all on function public._mp_unko_thin_at(bigint, float8) from public, anon, authenticated;
revoke all on function public._mp_unko_lvl(text, text, float8) from public, anon, authenticated;
revoke all on function public._mp_unko_wxk(float8, float8, float8, bigint, text, text) from public, anon, authenticated;
revoke all on function public._mp_unko_wxat(float8, float8, float8, bigint, text) from public, anon, authenticated;
