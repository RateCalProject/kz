-- 運行の乱れを、管理者がわざと起こせるように（駅をえらんで、原因・正しい対応・長さ）。起きたあとは、ふつうの乱れと同じ（持ち主が10分以内に対応をえらぶ）
--   地図の駅をタップ →「🚦 乱れを起こす（管理者）」。管理者のほかは使えない

-- 運行の乱れを起こす（管理者だけ）：p_sta 駅・p_route 系統（null ならこの駅にとまる系統ぜんぶ）・p_kind 原因・p_sub 理由（天気のときはなし）・
--   p_lv 正しい対応（1 いつもどおり・2 徐行・3 見合わせ）・p_min 長さ（分）
create or replace function public.mp_unko_make(p_sta bigint, p_route bigint, p_kind text, p_sub text, p_lv int, p_min int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s mp_stations; rs bigint[]; ou uuid; oc int; zid bigint; sev real; sub text;
begin
  perform _mp_ok(u);
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  if p_kind is null or p_kind not in ('person', 'sick', 'car', 'signal', 'track', 'wind', 'rain', 'snow') then raise exception '原因をえらんでください'; end if;
  if p_lv is null or p_lv not in (1, 2, 3) then raise exception '正しい対応を 1・2・3 からえらんでください'; end if;
  if p_min is null or p_min < 3 or p_min > 240 then raise exception '長さは 3〜240分にしてください'; end if;
  select * into s from mp_stations where id = p_sta and kind = 'rail';
  if not found then raise exception '鉄道の駅をえらんでください'; end if;
  -- かかわる系統：この駅にとまる、列車が走っている系統（p_route があれば、その系統だけ）
  rs := array(select ro.id from mp_routes ro
               where ro.ok and ro.kind = 'rail' and s.id = any(ro.stops) and (p_route is null or ro.id = p_route)
                 and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
               order by ro.id);
  if coalesce(cardinality(rs), 0) = 0 then raise exception 'この駅には、列車が走っている系統がありません'; end if;
  if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind = p_kind and (z.sta = s.id or z.routes && rs)) then
    raise exception 'ここでは、もう同じ原因の乱れが起きています（おわってから起こしてください）';
  end if;
  -- 対応をえらぶ人：駅の持ち主（なければ、はじめの系統の持ち主）。ふつうの乱れと同じ
  if s.own_u is not null or s.own_c is not null then ou := s.own_u; oc := s.own_c;
  else select ro.own_u, ro.own_c into ou, oc from mp_routes ro where ro.id = rs[1]; end if;
  sev := case p_kind when 'wind' then case p_lv when 3 then 27 when 2 then 22 else 16 end
                     when 'rain' then case p_lv when 3 then 60 when 2 then 36 else 20 end
                     when 'snow' then case p_lv when 3 then 9 when 2 then 4 else 2 end end;
  sub := case when p_kind in ('wind', 'rain', 'snow') then ''
              else left(coalesce(nullif(btrim(p_sub), ''), case p_kind when 'person' then '人と接触' when 'sick' then '急病のお客さまの救護' when 'car' then '車両の点検'
                                                                         when 'signal' then '信号の確認' else '線路内の点検' end), 40) end;
  zid := _mp_unko_new(p_kind, sub, s.id, s.x, s.y, rs, p_lv, sev, sev, p_min * 60, ou, oc);
  return jsonb_build_object('id', zid, 'routes', cardinality(rs), 'by', _mp_pname(ou, oc, false));
end $$;
revoke all on function public.mp_unko_make(bigint, bigint, text, text, int, int) from public, anon;
grant execute on function public.mp_unko_make(bigint, bigint, text, text, int, int) to authenticated;
