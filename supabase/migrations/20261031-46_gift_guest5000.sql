-- お祝いの配布：ゲストのはじめての配布を 5,000 X に（本登録したときに 残りの 105,000 X。あわせて 110,000 X）
--   更新44のあとに入れる。額を決める関数（_gift_amt）の、ゲストの決まりの額だけを変える

create or replace function public._gift_amt(k text) returns bigint
language sql stable set search_path = public as $$
  select coalesce((select case when value ~ '^[0-9]{1,13}$' then value::bigint end from app_settings where key = 'gift_' || k),
                  case k when 'welcome' then 110000 when 'welcome_guest' then 5000 when 'holiday' then 80000 else 0 end)
$$;
revoke all on function public._gift_amt(text) from public, anon, authenticated;
