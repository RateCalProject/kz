-- t62（2026-10-31）：スタイル。テーマを7つ足す（桜 sakura・海 ocean・森 forest・液晶ゲーム風 lcd・黒と金 luxury・雪 snow・サイバー cyber）。
--   書体（font：テーマとは別にえらぶ）もおぼえる。画面（index.html）はもう出してあり、この更新の前は、その端末にだけおぼえている
--   関数を作りなおすだけ（権限はそのまま。20秒まで待つ一覧には入っていない）
-- 設定を保存（わたしたものだけ上書き）
create or replace function public.prefs_save(p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); p jsonb := coalesce(p_prefs, '{}'::jsonb); cur jsonb; x jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception '設定が正しくありません'; end if;
  select prefs into cur from profiles where id = u;
  cur := coalesce(cur, '{}'::jsonb);
  if p ? 'shortcuts' then
    if jsonb_typeof(p->'shortcuts') <> 'array' or jsonb_array_length(p->'shortcuts') > 16 then raise exception 'ショートカットは16個までです'; end if;
    for x in select * from jsonb_array_elements(p->'shortcuts') loop
      if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[A-Za-z0-9_]{1,30}(:[A-Za-z0-9_]{1,30})?$' then raise exception 'ショートカットが正しくありません'; end if;
    end loop;
    cur := cur || jsonb_build_object('shortcuts', p->'shortcuts');
  end if;
  if p ? 'theme' then
    if coalesce(p->>'theme', '') not in ('std', 'net2000', 'famicom', 'wa', 'night', 'neon', 'pastel', 'chalk', 'casino', 'win95', 'paper', 'citypop',
                                         'sakura', 'ocean', 'forest', 'lcd', 'luxury', 'snow', 'cyber') then
      raise exception 'テーマが正しくありません';
    end if;
    cur := cur || jsonb_build_object('theme', p->>'theme');
  end if;
  if p ? 'font' then   -- t62：書体（テーマとは別）
    if coalesce(p->>'font', '') not in ('auto', 'gothic', 'kaku', 'ud', 'maru', 'mincho', 'hand', 'pop', 'brush', 'dot') then raise exception '書体が正しくありません'; end if;
    cur := cur || jsonb_build_object('font', p->>'font');
  end if;
  if p ? 'cvd' then
    if coalesce(p->>'cvd', '') not in ('off', 'mark', 'safe') then raise exception '色覚サポートの設定が正しくありません'; end if;
    cur := cur || jsonb_build_object('cvd', p->>'cvd');
  end if;
  if p ? 'lang' then
    if coalesce(p->>'lang', '') not in ('ja', 'en', 'zh-TW', 'zh-CN', 'ko', 'ko-Hani') then raise exception '言語が正しくありません'; end if;
    cur := cur || jsonb_build_object('lang', p->>'lang');
  end if;
  update profiles set prefs = cur where id = u;
  return cur;
end $$;
