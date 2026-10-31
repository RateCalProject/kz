-- 国土 5×5（t60）の準備：標高の段を 64 → 72 にふやす（2825m〜3875m。瑠璃富士 3775m など）
-- 文字は '.~!*()+='（いまのチャンクには出てこないので、いまの地図は何も変わらない）。何度流しても同じ
create or replace function public._mp_cell(px int, py int, out t text, out z text, out a text, out e int)
language plpgsql stable set search_path = public as $$
declare c mp_chunks; k int := (py & 63) * 64 + (px & 63) + 1; w jsonb;
begin
  select * into c from mp_chunks where cx = px >> 6 and cy = py >> 6;
  if not found then
    w := _mp_world();
    if (px >> 6) between (w ->> 'cx0')::int and (w ->> 'cx1')::int and (py >> 6) between (w ->> 'cy0')::int and (w ->> 'cy1')::int then
      t := 'D'; z := '-'; a := null; e := -190; return;
    end if;
    t := null; return;
  end if;
  t := substr(c.t, k, 1);
  z := coalesce((select mz.z::text from mp_zone mz where mz.x = px and mz.y = py), substr(c.z, k, 1));
  a := c.ap[position(substr(c.a, k, 1) in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')];
  e := _mp_edec(position(substr(c.e, k, 1) in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~!*()+=') - 1);   -- 64〜71 段は高い山（2825m〜）
end $$;
