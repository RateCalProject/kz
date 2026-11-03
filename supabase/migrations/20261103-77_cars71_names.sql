-- 更新71の車両（架空の名前）がのこっていたら（更新72の前に買った人がいたとき）：
--   系列の説明から、ほかの車両の名前をけす。更新74の系列と同じ名前なら、名前に「（初代）」をつけて見分ける
--   のこっていなければ、何も変わらない
update public.mp_series set note = '特急形電車。最高120km/h・リクライニングシート・冷房・トイレ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる' where code = '178' and yr is null;
update public.mp_series set note = '特急形電車。最高130km/h・VVVF・リクライニングシート・冷房・トイレ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる' where code = '379' and yr is null;
update public.mp_series set note = '急行形電車。最高110km/h・ボックスシート・トイレ。冷房はグリーン車だけ。Mp と M で1組（ユニット）。グリーン車（T）も入れられる。168系ともつなげる' where code = '166' and yr is null;
update public.mp_series set note = '急行形電車。最高110km/h・ボックスシート・冷房・トイレ・ブレーキが強い。Mp と M で1組（ユニット）。グリーン車（T）も入れられる。166系ともつなげる' where code = '168' and yr is null;
update public.mp_series set note = '客車（急行・団体むけ）。最高110km/h・ボックスシート・冷房・トイレ。機関車がひっぱる' where code = '15PC' and yr is null;
update public.mp_series set note = '客車（普通列車むけ）。最高95km/h・セミクロスシート・トイレ。冷房なし。機関車がひっぱる' where code = '52PC' and yr is null;
update public.mp_series set note = '電気機関車（直流）。2,550kW・最高110km/h。客車をひっぱる。電化した線だけ' where code = 'EF68' and yr is null;
update public.mp_series set note = 'ディーゼル機関車。1,620kW・最高95km/h。客車をひっぱる。電化していない線も走れる' where code = 'DD52' and yr is null;
update public.mp_series set note = '急行形気動車。エンジン2基・最高95km/h・ボックスシート・トイレ。電化していない線も走れる。キハ44系ともつなげる' where code = 'KH62' and yr is null;
update public.mp_series set note = '急行形気動車。エンジン1基 420PS・最高110km/h・リクライニングシート・冷房・トイレ。電化していない線も走れる' where code = 'KH116' and yr is null;
update public.mp_series set note = '一般形気動車。エンジン1基 220PS・最高95km/h・セミクロスシート・トイレ。電化していない線も走れる。キハ62系ともつなげる' where code = 'KH44' and yr is null;
update public.mp_series set note = '一般形気動車。小さくて軽い・エンジン1基 330PS・最高95km/h・ロングシート・冷房・トイレ。電化していない線も走れる' where code = 'KH127' and yr is null;
update public.mp_series s set name = s.name || '（初代）'
 where s.code in ('178', '379', '166', '168', '15PC', '52PC', 'EF68', 'DD52', 'KH62', 'KH116', 'KH44', 'KH127') and s.yr is null and s.name not like '%（初代）'
   and exists (select 1 from public.mp_series x where x.yr is not null and x.name = s.name);
