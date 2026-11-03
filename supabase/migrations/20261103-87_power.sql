-- 電化方式：線路ごとに 直流（1500V）・交流50Hz・交流60Hz（20kV）。方式がかわるところはデッドセクション（電気の来ない区間。惰行で通るので 1か所 6秒）。
--   車両は走れる方式を持つ（いまの電車・電気機関車は直流。178系・378系は交直流）。交流・交直流の車両を足す（772系・462系・ED96形・EF88形。名前は架空）。
--   走る区間の方式を編成が走れなければ、注意が出て走らない。mp_seg_opts は p_ps をうけとる（前の形は消す）

alter table public.mp_segs add column if not exists ps smallint not null default 0;   -- 電化方式（DB の更新87）：0 直流1500V・1 交流20kV 50Hz・2 交流20kV 60Hz（電化した線だけ）

-- 車両の電化方式（DB の更新87）：走れる方式のしるし（1 直流・2 交流50Hz・4 交流60Hz を足したもの）。電化のいらない車は見ない
alter table public.mp_types add column if not exists ps smallint not null default 1;
update public.mp_types set ps = 7 where series in ('E178', 'E378') and ps = 1;   -- 178系・378系は交直流（直流・交流50Hz・60Hz）
-- 交流・交直流の車両（DB の更新87。名前とコードは架空）
insert into public.mp_series(code, name, kind, note, ord, grp, yr, sets) values
  ('E772', '772系', 'emu', '交流近郊形電車（2000年代・VVVF）。交流 50Hz・60Hz のどちらの線も走れる（直流の線は走れない）。最高120km/h・セミクロスシート・冷房。Mpc77200（運転台・パンタグラフ）が先頭', 25, null, 2004,
   '[{"n":"2両","t":["E772-Mpc77200","E772-Tc77200"]},{"n":"4両","t":["E772-Mpc77200","E772-T77200","E772-Mp77200","E772-Tc77200"]}]'::jsonb),
  ('E462', '462系', 'emu', '交直流近郊形電車（1980年代）。直流・交流50Hz・交流60Hz のどの線も走れる。最高100km/h・セミクロスシート・冷房・トイレ。Mp46200（パンタグラフ・変圧器）と M46200 で1組', 26, null, 1986,
   '[{"n":"4両","t":["E462-Tc46200","E462-Mp46200","E462-M46200","E462-Tc46200"]},{"n":"8両","t":["E462-Tc46200","E462-Mp46200","E462-M46200","E462-Tc46200","E462-Tc46200","E462-Mp46200","E462-M46200","E462-Tc46200"]}]'::jsonb),
  ('LED96', 'ED96形', 'loco', '交流電気機関車（1,900kW）。交流 50Hz・60Hz の電化した線だけ（直流の線は走れない）。最高100km/h', 52, null, 1968, '[]'::jsonb),
  ('LEF88', 'EF88形', 'loco', '交直流電気機関車（2,550kW）。直流・交流50Hz・交流60Hz のどの電化した線も走れる。最高110km/h', 53, null, 1978, '[]'::jsonb)
on conflict (code) do nothing;
insert into public.mp_types(code, series, label, role, face, num_from, num_to, len, cap, seats, mass, power, panto, cab, vmax, acc, dec, elec, heat, ac, toilet, price, upkeep, life, note, ord, nbase, cls, rooms, fn, npad, ps) values
  ('E772-Mpc77200', 'E772', 'Mpc77200', 'Mp', '', 1, 999, 20.0, 130, 50, 40.0, 920, 1, true, 120, 2.2, 4.2, true, true, true, false, 125000000, 23000, 365, '制御電動車（運転台・パンタグラフ・変圧器・VVVF 230kW×4）。0001〜', 3500, '772', '', 0, '{}', 4, 6),
  ('E772-Mp77200', 'E772', 'Mp77200', 'Mp', '', 2001, 2999, 20.0, 140, 54, 39.0, 920, 1, false, 120, 2.2, 4.2, true, true, true, false, 115000000, 22000, 365, '電動車（パンタグラフ・変圧器・VVVF 230kW×4）。2001〜', 3510, '772', '', 0, '{}', 4, 6),
  ('E772-T77200', 'E772', 'T77200', 'T', '', 8001, 8999, 20.0, 140, 54, 31.0, 0, 0, false, 120, 2.2, 4.2, true, true, true, false, 85000000, 17000, 365, '付随車。8001〜', 3520, '772', '', 0, '{}', 4, 6),
  ('E772-Tc77200', 'E772', 'Tc77200', 'Tc', '', 5001, 5999, 20.0, 120, 46, 33.0, 0, 0, true, 120, 2.2, 4.2, true, true, true, true, 95000000, 18000, 365, '制御車（運転台・トイレ）。5001〜', 3530, '772', '', 0, '{}', 4, 6),
  ('E462-Tc46200', 'E462', 'Tc46200', 'Tc', '', 1, 1999, 20.0, 120, 60, 34.0, 0, 0, true, 100, 2.0, 3.5, true, true, true, true, 80000000, 20000, 365, '制御車（運転台・トイレ）。0001〜', 3550, '462', '', 0, '{}', 4, 7),
  ('E462-Mp46200', 'E462', 'Mp46200', 'Mp', '', 2001, 3999, 20.0, 140, 64, 48.0, 480, 1, false, 100, 2.0, 3.5, true, true, true, false, 95000000, 24000, 365, '電動車（パンタグラフ・変圧器・整流器・120kW×4。M46200 と1組）。2001〜', 3560, '462', '', 0, '{}', 4, 7),
  ('E462-M46200', 'E462', 'M46200', 'M', '', 4001, 5999, 20.0, 140, 64, 44.0, 480, 0, false, 100, 2.0, 3.5, true, true, true, false, 88000000, 22000, 365, '電動車（制御器・120kW×4。Mp46200 と1組）。4001〜', 3570, '462', '', 0, '{}', 4, 7),
  ('LED96-ED96', 'LED96', 'ED96', 'L', '', 1, 499, 14.3, 0, 0, 67.2, 1900, 1, true, 100, 1.5, 3.0, true, true, false, false, 230000000, 46000, 365, '交流電気機関車（50Hz・60Hz 両用）。最高100km/h', 3600, 'ED96', '', 0, '{}', 1, 6),
  ('LEF88-EF88', 'LEF88', 'EF88', 'L', '', 1, 499, 18.6, 0, 0, 100.8, 2550, 2, true, 110, 1.5, 3.0, true, true, false, false, 310000000, 58000, 365, '交直流電気機関車（直流・交流50Hz・60Hz）。最高110km/h・寝台特急の客車もひける', 3610, 'EF88', '', 0, '{}', 1, 7)
on conflict (code) do nothing;

-- 電化方式の名前（DB の更新87）：しるし（1 直流・2 交流50Hz・4 交流60Hz）を「直流・交流50Hz」のように
create or replace function public._mp_ps_names(m int) returns text
language sql immutable as $$
  select coalesce(nullif(concat_ws('・', case when m & 1 <> 0 then '直流' end, case when m & 2 <> 0 then '交流50Hz' end, case when m & 4 <> 0 then '交流60Hz' end), ''), 'なし')
$$;
-- 系統の駅と駅のあいだ（legs）ごとの電化方式のしるし（電化した線の方式を足したもの。電化した線がなければ 0。DB の更新87）
create or replace function public._mp_leg_pm(legs jsonb) returns int[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(coalesce((select bit_or(case when s.elec then 1 << s.ps::int else 0 end) from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g join mp_segs s on s.id = (g ->> 0)::bigint), 0) order by k), '{}')
    from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) with ordinality q(l, k)
$$;
-- 系統の駅と駅のあいだごとのデッドセクションの数（電化した線どうしで、方式がかわるところ。前の駅のあいだの最後の線とのさかいも、うしろのほうに数える。DB の更新87）
create or replace function public._mp_leg_dz(legs jsonb) returns int[]
language plpgsql stable set search_path = public as $$
declare out int[] := '{}'; l jsonb; g jsonb; s record; prev int := null; n int;
begin
  for l in select v from jsonb_array_elements(coalesce(legs, '[]'::jsonb)) v loop
    n := 0;
    for g in select v from jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) v loop
      select x.elec, x.ps into s from mp_segs x where x.id = (g ->> 0)::bigint;
      if not found or not s.elec then prev := null; continue; end if;
      if prev is not null and prev <> s.ps then n := n + 1; end if;
      prev := s.ps;
    end loop;
    out := out || n;
  end loop;
  return out;
end $$;

create or replace function public._mp_form_perf(fid bigint) returns jsonb
language plpgsql stable set search_path = public as $$
declare r record; acc real; rail boolean;
begin
  select count(*) n, sum(t.len) len, sum(t.cap) cap, sum(t.seats) seats, sum(t.mass) mass, sum(t.power) pw, min(t.vmax) vmax, min(t.dec) dcc,
         min(t.acc) bacc, bool_or(t.elec) elec, bool_and(c.ac) filter (where t.cap > 0) ac, bool_and(c.heat) filter (where t.cap > 0) heat,   -- 冷房・暖房は、人が乗る車で見る（機関車・電源車・荷物車をのぞく。DB の更新72）
         bool_or(c.toilet) toilet, min(c.cond) cond,
         bool_or(c.busy_until > now()) busy, min(t.series) series, bool_and(t.role not in ('Bus', 'Truck', 'Ship', 'Air')) israil, sum(t.upkeep) upkeep,
         bool_or(t.role = 'Ship') isship, sum(t.load) load, bool_or(t.role = 'Air') isair, max(t.rwy) rwy,
         -- 加速につかえる力（DB の更新71）：気動車はエンジンの力が液体変速機で6割、機関車は重い客車をひくので 電気45%・ディーゼル40%
         --   蒸気機関車は 50%（低い速さで力が出る。DB の更新78）
         sum(t.power * case when t.role in ('Dc', 'D') then 0.6 when t.role = 'L' then case when t.elec then 0.45 when 'stm' = any(t.fn) then 0.5 else 0.4 end else 1 end) epw,
         -- 料金の席と設備（DB の更新72）：グリーン席・A寝台・B寝台・個室の数・食堂車（ビュフェ）・ラウンジ・展望車・荷物車と郵便車の両数・電源車
         sum(case when t.cls = 'G' then t.cap else 0 end) xg, sum(case when t.cls = 'A' then t.cap else 0 end) xa, sum(case when t.cls = 'B' then t.cap else 0 end) xb, sum(t.rooms) xrm,
         bool_or(t.fn && array['din', 'buf']) xdin, bool_or('lng' = any(t.fn)) xlng, bool_or('obs' = any(t.fn)) xobs,
         count(*) filter (where t.fn && array['bag', 'mail']) xbag, bool_or('pow' = any(t.fn)) xpow,
         -- 機関車と客車の両数・蒸気機関車（水と石炭で走れる km。重連なら短いほう。DB の更新78）
         count(*) filter (where t.role = 'L') xnl, count(*) filter (where t.role = 'P') xnp,
         min(t.wkm) filter (where 'stm' = any(t.fn)) xwkm, min(t.ckm) filter (where 'stm' = any(t.fn)) xckm,
         bit_and(t.ps::int) filter (where t.elec) xps   -- 走れる電化方式（電化のいる車ぜんぶが走れるもの。DB の更新87）
    into r from mp_cars c join mp_types t on t.code = c.type where c.form = fid;
  if r.n = 0 then return null; end if;
  rail := r.israil;
  -- 加速度（km/h/s）：乗っている人（定員の半分・1人 55kg）もふくめた重さで
  --   上限は3.5と、形式の起動加速度（acc。特急形などは ゆっくり。DB の更新71）
  acc := case when rail then least(3.5, coalesce(r.bacc, 3.5), 0.38 * r.epw / greatest(1, r.mass + r.cap * 0.5 * 0.055)) else coalesce(r.bacc, 3.5) end;
  return jsonb_build_object('n', r.n, 'len', r.len, 'cap', r.cap, 'seats', r.seats, 'mass', round(r.mass::numeric, 1), 'kw', r.pw,
    'acc', round(acc::numeric, 2), 'dec', r.dcc, 'vmax', r.vmax, 'elec', r.elec, 'ac', coalesce(r.ac, false), 'heat', coalesce(r.heat, false), 'toilet', r.toilet,
    'cond', round(r.cond::numeric), 'busy', coalesce(r.busy, false), 'series', r.series, 'rail', rail, 'upkeep', r.upkeep,
    'ship', coalesce(r.isship, false), 'load', coalesce(r.load, 0), 'air', coalesce(r.isair, false), 'rwy', r.rwy)
    || jsonb_strip_nulls(jsonb_build_object('g', nullif(r.xg, 0), 'a', nullif(r.xa, 0), 'b', nullif(r.xb, 0), 'rooms', nullif(r.xrm, 0),
         'din', nullif(r.xdin, false), 'lng', nullif(r.xlng, false), 'obs', nullif(r.xobs, false), 'bag', nullif(r.xbag, 0), 'pow', nullif(r.xpow, false),
         'nl', nullif(r.xnl, 0), 'np', nullif(r.xnp, 0), 'wkm', r.xwkm, 'ckm', r.xckm, 'ps', r.xps));
end $$;

create or replace function public._mp_split(sid bigint, s real) returns bigint
language plpgsql set search_path = public as $$
declare sg mp_segs; q record; nid bigint; pa int[]; pb int[]; bid bigint; ta int[]; tb int[]; prev jsonb; fa real[]; fb real[];
begin
  select * into sg from mp_segs where id = sid for update;
  if s < 0.3 or s > sg.len - 0.3 then raise exception '線のはしの近くでは分けられません'; end if;
  select * into q from _mp_at(sg.pts, s);
  insert into mp_nodes(kind, x, y, z) values (sg.kind, round(q.x * 100), round(q.y * 100), case when sg.prof is not null then _mp_pz(sg.prof, s) end) returning id into nid;   -- 高さ（t108）
  pa := _mp_sub(sg.pts, 0, s); pb := _mp_sub(sg.pts, s, sg.len);
  fa := _mp_prof_sub(sg.prof, 0, s); fb := _mp_prof_sub(sg.prof, s, sg.len);   -- 縦断（なければ null）
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, net, art, cost, color, snowp, prof, st, rack, hm, hopt, sig, quad, ps)
  values (sg.kind, sg.cls, sg.name, sg.own_u, sg.own_c, sg.gov, null, pb, _mp_bb(pb), _mp_len(pb), sg.w, sg.lanes, sg.dbl, sg.elec,
          case when sg.kind = 'rail' then least(case when sg.rack then 30 else 300 end, _mp_vlim(_mp_minr(pb))) else sg.vlim end, nid, sg.n1, sg.net, sg.art, 0, sg.color,   -- color：路線カラーもそのまま（2026-10-29）
          sg.snowp, fb, _mp_st_of(pb, fb), sg.rack, sg.hm, sg.hopt, sg.sig, sg.quad, sg.ps)   -- 雪よけ・高さ・アプト式もそのまま（t108）。高さの数値も（DB の更新84）・信号の段も（85）
  returning id into bid;
  update mp_segs set pts = pa, ctl = null, bb = _mp_bb(pa), len = _mp_len(pa), vlim = case when kind = 'rail' then least(case when rack then 30 else 300 end, _mp_vlim(_mp_minr(pa))) else vlim end, n1 = nid,
                     prof = fa, st = _mp_st_of(pa, fa) where id = sid;
  ta := _mp_tiles(pa); tb := _mp_tiles(pb);
  delete from mp_occ where what = sg.kind and ref = sid;
  perform _mp_occ_set(sid, sg.kind, ta); perform _mp_occ_set(bid, sg.kind, tb);
  -- 使用料は、分けたあとの線ごとに区画で決めなおす（前から使っていた区画の使用料はそのまま）
  prev := (select jsonb_object_agg(e.x || ',' || e.y, e.fee) from mp_leases e where e.ref_kind = 'seg' and e.ref = sid);
  perform _mp_lease_set('seg', sid, sg.own_u, sg.own_c, sg.gov, prev);
  perform _mp_lease_set('seg', bid, sg.own_u, sg.own_c, sg.gov, prev);
  -- 駅・車庫は、後ろ半分にあるものを新しい線へ
  update mp_stations set seg = bid, at = at - s where seg = sid and at > s;
  update mp_depots set seg = bid, at = at - s where seg = sid and at > s;
  update mp_occ o set ref = o.ref where false;   -- （駅・車庫のマスは駅・車庫の番号なので、そのまま）
  perform _mp_chg('seg', sid, 'set', sg.bb);
  perform _mp_chg('seg', bid, 'set', sg.bb);
  return nid;
end $$;

create or replace function public._mp_seg_join2(xid bigint, yid bigint) returns bigint
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
  if x.rack <> y.rack then raise exception 'アプト式とそうでない線路のつなぎ目は、またげません（線路の高さの設定をそろえてください）'; end if;
  if x.elec and x.ps <> y.ps then raise exception '電化方式がかわるところ（デッドセクション）は、またげません'; end if;   -- DB の更新87
  if x.quad <> y.quad then raise exception '複線と複々線がかわるところは、またげません（線路の設定をそろえてください）'; end if;   -- DB の更新86
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
  if _mp_minr(_mp_sub(pm, greatest(0, lx - 1.5), least(_mp_len(pm), lx + 1.5))) < 3 then raise exception 'つなぎ目のカーブがきつすぎて、またげません'; end if;
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
                  || case when s.elec and s.ps > 0 then jsonb_build_object('ps', s.ps) else '{}'::jsonb end), '[]'::jsonb)   -- 電化方式（DB の更新87）
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
    'ver', coalesce((select max(ver) from mp_changes), 0), 'snow', 1, 'hgt', 1, 'sup', 1, 'hgt2', 1, 'sig', 1, 'quad', 1, 'pw', 1) into r;   -- sup：給水・給炭のあるサーバー（DB の更新78）・hgt2：平坦・高さを決める・勾配の上限・駅の高さ（DB の更新84）・sig：信号の段（DB の更新85）・quad：複々線（DB の更新86）・pw：電化方式（DB の更新87）
  return r;
end $$;

create or replace function public.mp_seg_build(p_kind text, p_cls text, p_ctl int[], p_pts int[], p_opts jsonb, p_as text, p_from jsonb, p_to jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare u uuid := _me(); pa record; tiles int[]; ters text[]; ln real; rmin real; cost numeric := 0; i int; lq record; n0 bigint; n1 bigint; sid bigint;
        dbl boolean := coalesce((p_opts ->> 'dbl')::boolean, false); quad boolean := coalesce((p_opts ->> 'quad')::boolean, false); pws smallint := least(2, greatest(0, coalesce((p_opts ->> 'ps')::int, 0)))::smallint; elec boolean := coalesce((p_opts ->> 'elec')::boolean, false); nm text := left(coalesce(p_opts ->> 'name', ''), 30);
        cls text := coalesce(p_cls, 'priv'); base numeric; np int := array_length(p_pts, 1) / 2; bad text; ln_ int := (p_opts ->> 'lanes')::int; cells int[]; sw real; need jsonb;
        md text := coalesce(p_opts ->> 'hm', 'auto'); rk boolean := coalesce((p_opts ->> 'rack')::boolean, false); upf real[]; pr jsonb; pf real[]; z0 real; z1 real; ea real; eb real; vl int; nhm text; ho jsonb;
begin
  perform _mp_ok(u);
  select * into pa from _mp_party(u, p_as);
  if p_kind not in ('road', 'rail') then raise exception '作るものがちがいます'; end if;
  if p_kind = 'rail' then cls := 'rail'; if pa.gv then raise exception '線路は人か会社で作ります'; end if; end if;
  if p_kind = 'road' then
    if pa.gv then if cls not in ('exp', 'nat', 'pref', 'city', 'lane') then cls := 'city'; end if;
    else cls := 'priv'; end if;
    dbl := false; elec := false; quad := false;
    ln_ := least(case when cls = 'priv' then 2 else 4 end, greatest(case when cls in ('exp', 'nat') then 2 else 0 end,
             coalesce(ln_, case cls when 'exp' then 2 when 'nat' then 2 when 'pref' then 1 when 'city' then 1 when 'lane' then 0 else 1 end)));
    if cls = 'lane' then ln_ := 0; end if;
  else ln_ := 0; end if;
  perform _mp_geom_ok(p_pts);
  if not p_dry then perform _mp_lock(pa.pu, pa.pc); end if;
  if exists (select 1 from mp_segs s where s.kind = p_kind and s.bb && _mp_bb(p_pts) and s.pts = p_pts) then raise exception '同じところに、同じ線がもうあります'; end if;
  tiles := _mp_tiles(p_pts); ln := _mp_len(p_pts); rmin := _mp_minr(p_pts);
  if p_kind = 'rail' and not pa.gv then   -- 鉄道の免許（t108）：免許のない市区町村には引けない
    bad := _mp_lic_need(pa.pu, pa.pc, tiles);
    if bad is not null then raise exception '鉄道の免許がない市区町村です（%）。国土 → ≡ →「🚃 鉄道の免許」で申請してください', bad; end if;
  end if;
  if array_length(tiles, 1) / 2 > _mp_rate('max_tiles') then raise exception '一度に引けるのは %マスまでです。分けて引いてください', _mp_rate('max_tiles'); end if;
  if p_kind = 'rail' and rmin < 3 then raise exception 'カーブがきつすぎます（半径 %m。線路は150m以上）', round(rmin * 50); end if;
  if p_kind = 'road' and rmin < 0.7 then raise exception 'カーブがきつすぎます'; end if;
  ters := _mp_ters(tiles);
  if '?' = any(ters) then raise exception '地図のないところには作れません'; end if;
  if 'D' = any(ters) then raise exception '深い海には作れません'; end if;
  if quad then dbl := true; end if;   -- 複々線（DB の更新86）は複線のうち
  sw := case when p_kind = 'rail' then case when quad then 0.8 when dbl then 0.5 else 0.36 end else _mp_road_w(cls, ln_) end;
  cells := _mp_seg_cells_arr(p_pts, p_kind, sw, dbl);
  -- 高さ（t108）：縦断を決める。交差する線（線路どうしは 10m 上か下。道路とは、どちらも地面なら踏切・交差点）・建物（屋根＋5m より上か、地面−15m より下）・
  --   駅のホーム・車庫・バス停（±10m）・滑走路（下だけ）は、上か下を通る（つなぐはしの 20m はのぞく）。はしの高さは、つなぐ先と同じ
  if md not in ('auto', 'el', 'ug', 'tn', 'fl', 'tz') then md := 'auto'; end if;   -- tn：トンネル優先（DB の更新81）・fl：平坦（地上）・tz：高さを決める（DB の更新84）
  if p_kind <> 'rail' then rk := false; end if;
  ho := _mp_hopt(md, p_opts, p_kind, rk);   -- 高さ・勾配の上限（DB の更新84）
  if md = 'tz' and not coalesce(ho ? 'zt', false) then md := 'auto'; end if;
  if jsonb_typeof(p_opts -> 'prof') = 'array' then upf := array(select v::real from jsonb_array_elements_text(p_opts -> 'prof') v); end if;
  nhm := case when upf is not null then 'man' else md end;
  z0 := _mp_att_z(p_from, p_pts[1], p_pts[2]); z1 := _mp_att_z(p_to, p_pts[2 * np - 1], p_pts[2 * np]);
  ea := case when p_from is null then 0 else least(0.4, ln / 3) end; eb := case when p_to is null then ln else ln - least(0.4, ln / 3) end;
  pr := _mp_prof_make2(p_pts, p_kind, cls, z0, z1, md, rk, upf, cells, tiles, ea, eb, null::bigint[], false, null::real[], ho);
  if not (pr ->> 'ok')::boolean then raise exception '%', pr ->> 'err'; end if;
  pf := array(select v::real from jsonb_array_elements_text(pr -> 'prof') v);
  -- 工事費：マスごとに、つくり（地面・高架・トンネル・橋）と地形の倍率 ×（1 ＋ まちの係数）。アプト式は 1.3倍
  base := case when p_kind = 'rail' then _mp_rate('rail') else _mp_rate('road') * _mp_road_mul(cls, ln_) end;
  if not pa.gv then   -- 国の工事は無料（t57b）：工事費の計算もしない
    cost := _mp_st_cost(tiles, ters, _mp_st_tiles(p_pts, pr ->> 'st'), rk, null, false, base, _mp_trmul(dbl, quad), case when elec then _mp_rate('elec') else 0 end);
  end if;
  cost := round(cost);
  vl := case when p_kind = 'rail' then case when rk then least(30, _mp_vlim(rmin)) else _mp_vlim(rmin) end else _mp_road_v(cls, ln_) end;
  select * into lq from _mp_lease_quote(cells, pa.pu, pa.pc, pa.gv);
  -- 他人の筆は、貸出料があるか申請が許可されているときだけ
  need := _mp_land_need(cells, pa.pu, pa.pc, pa.gv);
  if p_dry then
    return jsonb_build_object('cost', cost, 'lease', round(lq.fee), 'own', lq.own, 'other', lq.other, 'state', lq.state, 'pub', lq.pub,
      'tiles', array_length(tiles, 1) / 2, 'len_m', round(ln * 50), 'rmin_m', round(least(rmin, 99999) * 50),
      'vlim', vl, 'lanes', ln_,
      'vtop', case when p_kind = 'rail' then least(case when rk then 30 else 300 end, (select max((v ->> 1)::int) from jsonb_array_elements(_mp_vruns(p_pts, 0, ln)) v)) else _mp_road_v(cls, ln_) end,
      'need', need, 'hm', nhm, 'ho', ho, 'rack', rk, 'z0', z0, 'z1', z1, 'len', round(ln::numeric, 2)) || (pr - 'ok' - 'ns');   -- 高さ（t108）：縦断・つくり・地面・勾配・トンネル・高架・橋・踏切・交差
  end if;
  perform _mp_land_stop(need);
  perform _mp_pay(pa.pu, pa.pc, pa.gv, cost::bigint, p_kind, format('%sの工事（%sm）', case when p_kind = 'rail' then '線路' else '道路' end, round(ln * 50)));
  n0 := _mp_end(p_kind, p_from, p_pts[1], p_pts[2], pa.pu, pa.pc, pa.gv);
  n1 := _mp_end(p_kind, p_to, p_pts[2 * np - 1], p_pts[2 * np], pa.pu, pa.pc, pa.gv);
  insert into mp_segs(kind, cls, name, own_u, own_c, gov, ctl, pts, bb, len, w, lanes, dbl, elec, vlim, n0, n1, cost, prof, st, rack, hm, hopt, quad, ps)
  values (p_kind, cls, nm, pa.pu, pa.pc, pa.gv, p_ctl, p_pts, _mp_bb(p_pts), ln,
          sw, ln_,
          dbl, elec, vl, n0, n1, cost, pf, pr ->> 'st', rk, nhm, ho, quad, case when elec then pws else 0 end)
  returning id into sid;
  update mp_nodes set z = pf[2] where id = n0 and z is null;   -- はしの点の高さ（つないだ先は同じ高さ）
  update mp_nodes set z = pf[array_length(pf, 1)] where id = n1 and z is null;
  perform _mp_occ_set(sid, p_kind, tiles);
  perform _mp_lease_set('seg', sid, pa.pu, pa.pc, pa.gv);
  -- 系統の道すじは、行きどまりの線（はしの1つしか ほかの線とつながらない・線のとちゅうにつないでいない）では変わらないので、見なおさない（DB の更新81）
  if p_kind = 'rail' then
    perform _mp_renet(pa.pu, pa.pc);
    if coalesce(p_from ? 'seg', false) or coalesce(p_to ? 'seg', false)
       or (select count(*) from unnest(array[n0, n1]) e(nd) where exists (select 1 from mp_segs s where s.id <> sid and (s.n0 = e.nd or s.n1 = e.nd))) >= 2 then
      perform _mp_routes_fix(pa.pu, pa.pc);
    end if;
  end if;
  perform _mp_chg('seg', sid, 'set', _mp_bb(p_pts));
  return jsonb_build_object('id', sid, 'cost', cost, 'lease', round(lq.fee));
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
      if r.kind = 'air' and coalesce((perf ->> 'rwy')::int, 0) > (select min(s.plat) from mp_stations s where s.id = any(r.stops)) then continue; end if;   -- 滑走路（t54p）
      if r.kind = 'air' and tr.noslot is not null then continue; end if;   -- 発着口が足りない便は飛ばない（t57）
      ev := null; orf := null;
      if upc is not null then   -- 乱れの区間を通る列車だけ（DB の更新60）：見合わせ・間引き（番号が奇数）で運休（運賃なし・車両はいたまない）
        begin ev := _mp_unko_trn(upc, r.stops, r.legs, tr.sched, tr.dir, dep_abs, tr.id, dep_abs + rt); exception when others then ev := null; end;
        if ev ->> 'can' is not null then ncan := ncan + 1; continue; end if;
        if ev ->> 'ori' is not null then orf := (ev ->> 'ori')::real; cf := cf * orf; end if;   -- 区間折り返し（DB の更新82）：乱れの区間の外だけ走る（定員・運賃はその分）
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
  lq := case when r.kind = 'rail' then _mp_leg_quad(r.legs) end; qx := r.kind = 'rail' and _mp_kprio(r.own_u, r.own_c, tr.kind) <= 3;   -- 急行線を走る列車（優先番号 3 まで。DB の更新86）
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
    lpm := _mp_leg_pm(r.legs); ldz := _mp_leg_dz(r.legs); pm := coalesce((perf ->> 'ps')::int, 1);
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

-- 線の設定：前の形（p_ps なし）は消して、p_ps つきにする
drop function if exists public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean);
-- 線の設定：複線・電化・名前・車線。複々線（DB の更新86）：p_quad（線路だけ。複々線は複線のうち。null は いまのまま）。
--   電化方式（DB の更新87）：p_ps（0 直流・1 交流50Hz・2 交流60Hz。電化した線だけ。null は いまのまま）。方式を変えるのは 1マス 電化の 0.6倍。
--   工事費は つくりの倍率 ×（新しい倍率 − いまの倍率。単線 1・複線 dbl_mul・複々線 dbl_mul × 1.7）。はばが広がるところは建物・他人の筆を見る。
--   複々線・電化方式を変えると、通る系統の時刻（待避・続行・走れるか）を計算しなおす
create or replace function public.mp_seg_opts(p_id bigint, p_dbl boolean, p_elec boolean, p_name text, p_dry boolean, p_lanes int default null, p_quad boolean default null, p_ps int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); sg mp_segs; me_cs int[]; ters text[]; amt_ numeric := 0; i int; base numeric; nl int; what text := ''; mul real[]; what2 text; wc int[]; need jsonb;
        nq boolean; nd boolean; m0 numeric; m1 numeric; rid bigint; ne boolean; nps smallint;   -- ne・nps：電化・電化方式（DB の更新87）
begin
  perform _mp_ok(u);
  select * into sg from mp_segs where id = p_id for update;
  if not found then raise exception '線が見つかりません'; end if;
  me_cs := array(select id from companies where owner = u);
  if not coalesce(sg.own_u = u or sg.own_c = any(me_cs) or (sg.gov and _is_admin(u)), false) then raise exception 'あなたの線ではありません'; end if;
  ters := _mp_ters(_mp_tiles(sg.pts));
  if not sg.gov then mul := case when sg.st is null then _mp_cmuls(_mp_tiles(sg.pts), ters) else _mp_st_muls(sg.pts, ters, sg.st, sg.rack) end; end if;   -- 国の工事は無料（t57b）。縦断のある線は つくりの倍率（t108）
  nq := sg.kind = 'rail' and coalesce(p_quad, sg.quad);
  nd := sg.kind = 'rail' and (coalesce(p_dbl, sg.dbl) or nq);
  ne := sg.kind = 'rail' and coalesce(p_elec, sg.elec);
  nps := case when ne then least(2, greatest(0, coalesce(p_ps, sg.ps)))::smallint else sg.ps end;
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
    if what2 is not null then raise exception '建物のある土地（%）にかかるので、はばを広げられません', left(what2, 60); end if;
    -- 広げたところが他人の筆にかかるときは、貸出料があるか申請が許可されているときだけ
    need := _mp_land_need(wc, sg.own_u, sg.own_c, sg.gov, _mp_seg_cells_arr(sg.pts, sg.kind, sg.w, sg.dbl));
  end if;
  if p_dry then return jsonb_build_object('cost', amt_, 'lanes', nl, 'need', need, 'quad', nq, 'ps', nps); end if;
  perform _mp_land_stop(need);
  if amt_ > 0 then perform _mp_pay(sg.own_u, sg.own_c, sg.gov, amt_::bigint, sg.kind, case when sg.kind = 'rail' then '線路の' else '道路の' end || what); end if;
  update mp_segs set dbl = case when kind = 'rail' then nd else false end, quad = case when kind = 'rail' then nq else false end,
         elec = case when kind = 'rail' then coalesce(p_elec, elec) else false end, ps = nps,
         name = coalesce(left(p_name, 30), name),
         lanes = nl,
         w = case when kind = 'rail' then case when nq then 0.8 when nd then 0.5 else 0.36 end else _mp_road_w(cls, nl) end,
         vlim = case when kind = 'rail' then vlim else _mp_road_v(cls, nl) end,
         cost = cost + amt_::bigint
   where id = p_id;
  perform _mp_lease_set('seg', p_id, sg.own_u, sg.own_c, sg.gov);
  if sg.kind = 'rail' then perform _mp_routes_fix(sg.own_u, sg.own_c); end if;
  if sg.kind = 'rail' and (nq is distinct from sg.quad or nps is distinct from sg.ps) then   -- 複々線・電化方式（DB の更新87）：通る系統の時刻を計算しなおす（道すじは同じなので _mp_routes_fix ではしない）
    for rid in select distinct ro.id from mp_routes ro, jsonb_array_elements(ro.legs) l, jsonb_array_elements(coalesce(l -> 'g', '[]'::jsonb)) g
                where ro.kind = 'rail' and ro.ok and (g ->> 0)::bigint = p_id loop
      perform _mp_resched(rid);
    end loop;
  end if;
  perform _mp_chg('seg', p_id, 'set', sg.bb);
  return jsonb_build_object('id', p_id, 'cost', amt_, 'lanes', nl, 'quad', nq, 'ps', nps);
end $$;

-- 関数の権限：_ ではじまる関数は、ほかの関数の中からだけ。ほかはログインした人
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_mp_ps_names', '_mp_leg_pm', '_mp_leg_dz', '_mp_form_perf', '_mp_train_times', '_mp_tick_hour', '_mp_split', '_mp_seg_join2',
                                                         'mp_area', 'mp_seg_build', 'mp_seg_opts') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
-- 作りなおした関数のタイムアウト（create or replace で消えるので、もう一度）
alter function public.mp_seg_build(text, text, int[], int[], jsonb, text, jsonb, jsonb, boolean) set statement_timeout = '20s';
alter function public.mp_seg_opts(bigint, boolean, boolean, text, boolean, int, boolean, int) set statement_timeout = '20s';
