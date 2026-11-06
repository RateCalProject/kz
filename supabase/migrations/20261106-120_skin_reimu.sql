-- DB の更新120：見た目（スキン）に MMD のモデル「博麗霊夢（鈴奈庵風）」の 春服・冬服を足す（SR。スキンガチャで当たる）
--   東方Project の二次創作（原作：上海アリス幻樂団）。モデル：モンテコア（モデルに「改変、再配布可」。自作ゲームなど あらゆる用途に使える）
--   歩くときは 持ち物（武器の材質）を見せない。スキンガチャの確率は N 50%・R 25%・SR 25%（SR は うか・霊夢 春服・霊夢 冬服）

-- 見た目：霊夢（鈴奈庵風）の 春服・冬服（DB の更新120。東方Project の二次創作。モデル：モンテコア）
insert into public.av_skins(code, name, kind, rare, w, look, file, credit, sort) values
  ('mmd_reimu_s', '霊夢（春服）', 'mmd', 'SR', 1000, '{"h":1.52,"m":["まばたき"],"hide":["武器"]}', 'map/skins/reimu/R_spring.pmx',
   '東方Project の二次創作（原作：上海アリス幻樂団）／MMD モデル「博麗霊夢（鈴奈庵風）」ver.1.1：モンテコア', 101),
  ('mmd_reimu_w', '霊夢（冬服）', 'mmd', 'SR', 1000, '{"h":1.52,"m":["まばたき"],"hide":["武器"]}', 'map/skins/reimu/R_winter.pmx',
   '東方Project の二次創作（原作：上海アリス幻樂団）／MMD モデル「博麗霊夢（鈴奈庵風）」ver.1.1：モンテコア', 102)
on conflict (code) do nothing;
