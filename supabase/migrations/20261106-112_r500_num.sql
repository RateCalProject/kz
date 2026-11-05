-- DB の更新112：500形の車番（501-000 のように）
--   形式ごとに 前の番号：Mc 501・Tc 502・Tcg 503。うしろは 000 から 999（3けた）。例：501-000・501-001・502-000
--   いまある 500形の車両の車番も つけなおす（持ち主ごと・形式ごとに 注文の順で 000 から）

update mp_types set nbase = v.nb, num_from = 0, num_to = 999, npad = 3,
       note = regexp_replace(note, '[0-9]+〜$', v.nb || '-000〜')
  from (values ('R500-Mc', '501'), ('R500-Tc', '502'), ('R500-Tcg', '503')) v(code, nb)
 where mp_types.code = v.code;

with zq as (
  select c.id, _mp_carnum(t, (row_number() over (partition by c.type, c.own_u, c.own_c order by c.id) - 1)::int) num
    from mp_cars c join mp_types t on t.code = c.type
   where c.type in ('R500-Mc', 'R500-Tc', 'R500-Tcg'))
update mp_cars c set num = zq.num from zq where c.id = zq.id and c.num is distinct from zq.num;
