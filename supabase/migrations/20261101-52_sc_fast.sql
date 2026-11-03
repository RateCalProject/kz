-- 施設の客の計算（学校・ホテル・病院・娯楽・神社・寺など。毎時）を速く：同じ種類の近くの施設を索引でさがす（答えは今と同じ）
--   国土を 5×5 に広げると施設が4倍ぐらいになり、毎時の処理が 12秒ほどかかるため（なおすと 1秒ぐらい）

create or replace function public._mp_sc_school_calc(h timestamptz, p_only bigint default null) returns void
language plpgsql set search_path = public as $$
declare kd jsonb := _mp_sc_kinds(); mo int := extract(month from h at time zone 'Asia/Tokyo')::int;
begin
  -- 駅の1日の乗り降り（系統の24時間の乗った人 × 2 を、止まる駅で分ける）
  drop table if exists _sflow;
  create temp table _sflow on commit drop as
    select st.id, st.x / 100.0 sx, st.y / 100.0 sy, sum(coalesce(hs.s, 0) * 2.0 / greatest(array_length(r.stops, 1), 1)) flow
      from mp_routes r join mp_stations st on st.id = any(r.stops)
      left join lateral (select sum(hh.served) s from mp_hours hh where hh.route = r.id and hh.hour > h - interval '24 hours') hs on true
     where r.ok group by st.id, st.x, st.y;
  drop table if exists _scs;
  create temp table _scs on commit drop as
    select s.bld, s.grp, s.x, s.y, s.lv, op.ok, op.npc, op.gv, op.m2,
           -- t59h：町の景色（AIの会社・国営の会社）の施設は、客を分けあわない（プレイヤーの施設の客をへらさない）
           case when (op.ok or op.npc) and not (p.own_c is not null and _mp_ai_quiet(p.own_c)) then floor(op.m2 / (kd -> s.grp ->> 'spp')::real)::int else 0 end cap, 0::real pool, 1::real acc,
           coalesce((b.dem -> 'fx' ->> (kd -> s.grp ->> 'use'))::real, 0) fxv, p.val::numeric / greatest(p.n * 100, 1) lvm2
      from mp_sc s join mp_blds b on b.id = s.bld join mp_parcels p on p.id = b.parcel, lateral _mp_sc_op(s.bld, h) op
     where s.grp is not null and kd ? s.grp;
  create index on _scs (grp, x);   -- 5×5（DB の更新52）：同じ種類の近くの施設を、索引でさがす（施設が多くなっても速く）
  analyze _scs;
  -- 駅で通えるか：列車の走る駅が 750m 以内 → 1・バス停が 500m 以内 → 0.8・どちらもない → 0.5（acc の種類だけ）
  update _scs t set acc = case when not coalesce((kd -> t.grp ->> 'acc')::boolean, false) then 1
      when exists (select 1 from mp_stations st where st.kind = 'rail' and st.x between (t.x - 15) * 100 and (t.x + 15) * 100 and st.y between (t.y - 15) * 100 and (t.y + 15) * 100
                     and (st.x / 100.0 - t.x) ^ 2 + (st.y / 100.0 - t.y) ^ 2 <= 225 and exists (select 1 from mp_routes r where r.ok and st.id = any(r.stops))) then 1
      when exists (select 1 from mp_stations st where st.kind = 'bus' and st.x between (t.x - 10) * 100 and (t.x + 10) * 100 and st.y between (t.y - 10) * 100 and (t.y + 10) * 100
                     and (st.x / 100.0 - t.x) ^ 2 + (st.y / 100.0 - t.y) ^ 2 <= 100 and exists (select 1 from mp_routes r where r.ok and st.id = any(r.stops))) then 0.8
      else 0.5 end
   where cap > 0 and (p_only is null or t.bld = p_only);
  -- 来る人：まわりの人 × わりあい ＋ 近くの駅の乗り降り × わりあい。駅で通えるか・まわりの建物の効果（fx）・季節
  update _scs t set pool = (_mp_catch(t.x, t.y, (kd -> t.grp ->> 'r')::real) * (kd -> t.grp ->> 'age')::real
                            + coalesce((kd -> t.grp ->> 'rs')::real, 0) * coalesce((select sum(f.flow) from _sflow f where f.sx between t.x - 15 and t.x + 15 and f.sy between t.y - 15 and t.y + 15
                                                                                     and (f.sx - t.x) ^ 2 + (f.sy - t.y) ^ 2 <= 225), 0))
                           * t.acc * greatest(0.1, 1 + t.fxv)
                           * case when coalesce(kd -> t.grp -> 'pk', '[]'::jsonb) @> to_jsonb(mo) then 1.3 when coalesce(kd -> t.grp -> 'op', '[]'::jsonb) @> to_jsonb(mo) then 0.75 else 1 end
   where cap > 0 and (p_only is null or t.bld = p_only);
  -- 同じ種類の施設で分けあう（通える範囲の中の定員のわりあい）。人・会社の施設は、値段の水準が高いと減る。値段（1人・1日）：地価が高いと高い（loc の種類）
  update mp_sc s set st = jsonb_build_object('n', q.n, 'cap', q.cap, 'pool', round(q.pool), 'acc', q.acc, 'at', h, 'fee', round((kd -> q.grp ->> 'fee')::numeric * round(q.lv::numeric, 2) * q.locf))
    from (select t.bld, t.grp, t.lv, t.cap, t.pool, t.acc,
                 case when coalesce((kd -> t.grp ->> 'loc')::boolean, false) then greatest(0.6, least(8, sqrt(t.lvm2 / 2500.0))) else 1 end locf,
                 case when t.cap = 0 then 0 else least(t.cap, floor(t.pool * t.cap
                   / greatest(1, (select sum(u.cap) from _scs u where u.grp = t.grp and u.cap > 0 and u.x between t.x - (kd -> t.grp ->> 'r')::real and t.x + (kd -> t.grp ->> 'r')::real
                                     and u.y between t.y - (kd -> t.grp ->> 'r')::real and t.y + (kd -> t.grp ->> 'r')::real
                                     and (u.x - t.x) ^ 2 + (u.y - t.y) ^ 2 <= ((kd -> t.grp ->> 'r')::real) ^ 2))
                   * power(case when t.ok and not t.gv then greatest(t.lv, 0.5) else 1 end, -1.5)))::int end n
            from _scs t where p_only is null or t.bld = p_only) q
   where s.bld = q.bld;
  drop table if exists _scs; drop table if exists _sflow;
end $$;
revoke all on function public._mp_sc_school_calc(timestamptz, bigint) from public, anon, authenticated;
