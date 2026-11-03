-- 変な天気（日本の季節に合わせて、たまに）：寒波（12〜3月。首都でも毎冬なんどか雪が積もり、南へも少し）・季節外れの雪・猛暑（7〜8月に 35℃をこえる）・
--   台風（6〜11月。1年に10こ。南の海から北へ。強い風・大雨）・ゲリラ豪雨・ひょう・竜巻（夏の午後の雷雲）・濃霧（夜明け）・黄砂（春）。map/wx.js と同じ式
--   運行の乱れ：濃霧（飛行機・船・バス）・高温でレールがのびる（鉄道）・ひょう（飛行機）。台風の風・雨は「台風N号の」、竜巻・ゲリラ豪雨も書く
--   _wx_core は出力が ふえる（たしかめた関数はそのまま使える）。積もった雪の計算は軽いまま（台風などを見ない）

-- ---------------------------------------------------------------------
-- 変な天気（DB の更新66）：map/wx.js と同じ式
-- ---------------------------------------------------------------------
-- 雷雲（10km ぐらい・1時間ぐらい）・霧・黄砂（西から）の雑音。寒波・猛暑は「何日もつづくずれ」（_wx_na）の はし
create or replace function public._wx_nv(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select _wx_noise(xk - 15 * th, yk - 3 * th, th, 12, 1.4::float8, 51) $$;
create or replace function public._wx_nf(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select _wx_noise(xk - 8 * th, yk, th, 30, 8, 61) + 0.5::float8 * _wx_noise(xk - 8 * th, yk, th, 9, 3, 62) $$;
create or replace function public._wx_nd(xk float8, yk float8, th float8) returns float8
language sql immutable parallel safe as $$ select 0.8::float8 * _wx_noise(xk - 30 * th, yk - 5 * th, th, 520, 40, 71) + 0.4::float8 * _wx_noise(xk - 30 * th, yk - 5 * th, th, 170, 14, 72) $$;
-- 雑音のちらばり（wx.js の SV・SF・SD）。いつも同じ点ではかるので、だれでも同じ
do $$
declare q float8; v float8; i int;
begin
  if exists (select 1 from mp_wx_k where k = 'sv') then return; end if;
  q := 0; for i in 0..2999 loop v := _wx_nv(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; insert into mp_wx_k values ('sv', sqrt(q / 3000)) on conflict (k) do update set v = excluded.v;
  q := 0; for i in 0..2999 loop v := _wx_nf(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; insert into mp_wx_k values ('sf', sqrt(q / 3000)) on conflict (k) do update set v = excluded.v;
  q := 0; for i in 0..2999 loop v := _wx_nd(i * 37.3::float8, i * 11.7::float8, i * 53.1::float8); q := q + v * v; end loop; insert into mp_wx_k values ('sd', sqrt(q / 3000)) on conflict (k) do update set v = excluded.v;
end $$;
-- 季節の山：d（1月1日が 0 の日）が c 日のとき 1、はば w 日（年をまたぐ）。wx.js の bump
create or replace function public._wx_bump(d float8, c float8, w float8) returns float8
language sql immutable parallel safe as $$
  select exp(-(z.x / w) * (z.x / w)) from (select case when d - c > 182.625::float8 then d - c - 365.25::float8 when d - c < -182.625::float8 then d - c + 365.25::float8 else d - c end x) z
$$;
-- 台風（wx.js の tyYear・tyState・tyAt）：時刻 ms（その年 yy・1月1日からの日 d）にいる台風を [号, x, y（km）, 中心の気圧の下がり（hPa）, 大きさ r0（km）, …] の順に
--   1年に 10こ。生まれる日は 235 + 15 × ln(q ÷ (1 − q))（6月なかば〜10月おわり。8月下旬に多い）。5〜7日で消える
create or replace function public._wx_ty(ms bigint, yy int, d float8) returns float8[]
language plpgsql immutable parallel safe as $$
declare out float8[] := '{}'; i int; q float8; g float8; y0 float8; t0 float8; ll float8; tau float8; v1 float8; py float8; tr float8; s float8; rr float8;
        x0 float8; vx1 float8; vy1 float8; vx2 float8; vy2 float8; dd float8; uu float8; x float8; y float8; r0 float8; lo float8; hi float8;
begin
  if not (d >= 145 and d < 335) then return out; end if;
  y0 := (((make_date(yy, 1, 1) - date '1970-01-01')::bigint * 86400000) - 32400000)::float8;
  for i in 0..9 loop
    -- 生まれる日の はば（先にしぼる。ハッシュを計算しない）
    lo := 235 + 15 * ln(((i::float8 + 0.1::float8) / 10) / (1 - (i::float8 + 0.1::float8) / 10));
    hi := 235 + 15 * ln(((i::float8 + 0.9::float8) / 10) / (1 - (i::float8 + 0.9::float8) / 10));
    if d < lo - 0.01::float8 or d > hi + 7.2::float8 then continue; end if;
    q := (i::float8 + 0.5::float8 + 0.4::float8 * _wx_h3(yy, i, 1, 91)) / 10;
    g := 235 + 15 * ln(q / (1 - q));
    t0 := y0 + g * 86400000;
    ll := 140 + 30 * _wx_h3(yy, i, 2, 91);
    tau := (ms::float8 - t0) / 3600000;
    if not (tau >= 0 and tau <= ll) then continue; end if;
    v1 := 17 + 5 * _wx_h3(yy, i, 6, 91); py := 1350 + 250 * _wx_h3(yy, i, 4, 91); uu := (_wx_h3(yy, i, 10, 91) + 1) / 2;
    x0 := -300 + 1300 * _wx_h3(yy, i, 3, 91); vx1 := -6 + 7 * _wx_h3(yy, i, 5, 91); vy1 := -v1;
    tr := (py - (400 + 500 * _wx_h3(yy, i, 7, 91))) / v1;
    vx2 := 24 + 12 * _wx_h3(yy, i, 8, 91); vy2 := -24 - 10 * _wx_h3(yy, i, 9, 91);
    dd := 25 + 50 * uu * uu; r0 := 90 + 20 * _wx_h3(yy, i, 11, 91);
    s := tau - tr; rr := 0.5::float8 * (s + sqrt(s * s + 900));   -- 向きを変えるところを なめらかに
    x := x0 + vx1 * tau + (vx2 - vx1) * rr; y := py + vy1 * tau + (vy2 - vy1) * rr;
    dd := dd * (0.25::float8 + 0.75::float8 * least(1::float8, tau / 48)) * greatest(0.3::float8, least(1::float8, (y + 650) / 900)) * least(1::float8, (ll - tau) / 18);
    r0 := r0 * (1 + 0.3::float8 * greatest(0::float8, least(1::float8, s / 36)));
    out := out || array[(i + 1)::float8, x, y, dd, r0];
  end loop;
  return out;
end $$;
-- 台風のぶん、気圧が下がる（hPa）。ty は _wx_ty の答え。wx.js の tyP（フジタの式）
create or replace function public._wx_typ(xk float8, yk float8, ty float8[]) returns float8
language plpgsql immutable parallel safe as $$
declare p float8 := 0; i int; dx float8; dy float8;
begin
  for i in 0..coalesce(cardinality(ty), 0) / 5 - 1 loop
    dx := xk - ty[i * 5 + 2]; dy := yk - ty[i * 5 + 3];
    p := p - ty[i * 5 + 4] / sqrt(1 + (dx * dx + dy * dy) / (ty[i * 5 + 5] * ty[i * 5 + 5]));
  end loop;
  return p;
end $$;

-- その時刻・その場所の天気：T（℃）・wet（雨か雪が降っている）・inten（強さ 0〜1）・cl（雲）・p（hPa）・kind（snow・sleet・rain・''）
--   x・y はマス、e は標高 m、ms は 1970年からのミリ秒。lite：積もった雪の計算用（台風・雷雲・霧・黄砂を見ない）
--   変な天気（DB の更新66）：sg（突風のもとになる雨の強さ）・ec 寒波・eh 猛暑（0〜1）・cv 雷雲（0〜1）・hail ひょう・torn 竜巻（0〜1）・fg 霧（0〜1）・ds 黄砂（0〜1）・
--   tyn いちばん近い台風の号・tya 中心からの距離 ÷ 大きさ・tyd 中心の気圧の下がり（hPa）・ux 季節外れの雪
drop function if exists public._wx_core(float8, float8, float8, bigint);
create or replace function public._wx_core(x float8, y float8, e float8, ms bigint, lite boolean default false,
    out t float8, out wet boolean, out inten float8, out cl float8, out p float8, out kind text, out zp float8,
    out sg float8, out ec float8, out eh float8, out cv float8, out hail boolean, out torn float8, out fg float8, out ds float8,
    out tyn int, out tya float8, out tyd float8, out ux boolean)
language plpgsql stable parallel safe set search_path = public as $$
declare jj bigint := ms + 32400000; yy int; y0 bigint; y1 bigint; th float8; c float8; s float8; c2 float8; hr float8; h float8;
        xk float8 := x * 0.05::float8; yk float8 := y * 0.05::float8; dn float8 := (54 - y) * 0.05::float8; base float8; pw float8; cu float8; amp float8; an float8; tc float8; g float8;
        d float8; n float8; v float8; dur float8; uu float8; nc float8;
        sa float8; sc float8; sp float8; sv float8; sf float8; sdd float8; na float8; hh2 float8;
        ssk float8; ssh float8; ssv float8; ssd float8; ws float8; fs float8; aa float8; lo float8;
        ty float8[]; i int; dx float8; dy float8; d2 float8; ta float8; rr float8; rmax float8; band float8; typ float8 := 0;
        hv float8; fx float8; fy float8; ft float8; li int; lj int; lk int; hh float8; hf float8; kf float8;
begin
  select max(case when q.k = 'sa' then q.v end), max(case when q.k = 'sc' then q.v end), max(case when q.k = 'sp' then q.v end),
         max(case when q.k = 'sv' then q.v end), max(case when q.k = 'sf' then q.v end), max(case when q.k = 'sd' then q.v end)
    into sa, sc, sp, sv, sf, sdd from mp_wx_k q;
  -- 季節・時刻（日本時間）：wx.js の tinfo
  yy := extract(year from (date '1970-01-01' + (jj / 86400000)::int));
  y0 := ((make_date(yy, 1, 1) - date '1970-01-01')::bigint) * 86400000; y1 := ((make_date(yy + 1, 1, 1) - date '1970-01-01')::bigint) * 86400000;
  d := (jj - y0)::float8 / 86400000;
  th := 2 * pi() * ((jj - y0)::float8 / (y1 - y0)::float8 - 14.5::float8 / 365.25::float8);
  c := cos(th); s := sin(th); c2 := cos(2 * th); hr := (jj % 86400000)::float8 / 3600000; h := ms::float8 / 3600000;
  ssk := _wx_bump(d, 28, 42); ssh := _wx_bump(d, 215, 28); ssv := _wx_bump(d, 205, 50); ssd := _wx_bump(d, 100, 25);   -- 寒波・猛暑・雷雲・黄砂の季節
  zp := _wx_np(xk, yk, h) / sp;
  base := 21.35::float8 - 7.83::float8 * c + 0.944::float8 * s + 0.785::float8 * c2;
  -- 寒波・猛暑の強さ（0〜1）：何日もつづく寒い・暑い（_wx_na）が とても強いとき。その季節のまん中ほど起きやすい
  na := _wx_na(xk, yk, h);
  ec := case when ssk > 0.004::float8 then greatest(0::float8, least(1::float8, (-na / sa - (0.9::float8 + 1.5::float8 * (1 - ssk))) / 0.9::float8)) else 0 end;
  eh := case when ssh > 0.02::float8 then greatest(0::float8, least(1::float8, (na / sa - (2 - ssh)) / 0.9::float8)) else 0 end;
  ws := greatest(0::float8, least(1::float8, (300 - dn) / 150)) * greatest(0::float8, least(1::float8, (dn + 450) / 250));
  -- 雨・雪の降る割合：wx.js の wetP。寒波のときは南の海の低気圧で、首都のあたりも ふえる。猛暑のときは晴れやすい
  pw := 0.13::float8 + 0.11::float8 * exp(-(((d - 170) / 20) * ((d - 170) / 20))) + 0.05::float8 * exp(-(((d - 255) / 18) * ((d - 255) / 18))) - 0.03::float8 * c;
  n := greatest(0::float8, least(1::float8, dn / 300));
  pw := pw + n * (0.05::float8 + 0.22::float8 * greatest(0::float8, c));
  if dn < 0 then pw := pw + 0.03::float8 * least(1::float8, -dn / 300); end if;
  pw := greatest(0.05::float8, least(0.6::float8, pw));
  pw := greatest(0.05::float8, least(0.6::float8, pw + 0.3::float8 * ec * ws - 0.05::float8 * eh));
  nc := _wx_nc(xk, yk, h);
  cu := _wx_cdf(0.75::float8 * nc / sc - 0.65::float8 * zp);
  wet := cu > 1 - pw; inten := case when wet then (cu - (1 - pw)) / pw else 0 end;
  cl := case when wet then 1 when cu > 1 - pw - 0.28::float8 then 1 when cu > 1 - pw - 0.5::float8 then 0.5 else 0 end;
  sg := inten;
  -- 台風：中心のまわり（目のかべ）と、外のうずまき（雲のかたまりで まだら）に強い雨
  tyn := 0; tya := 99; tyd := 0;
  ty := case when lite then '{}'::float8[] else _wx_ty(ms, yy, d) end;
  if cardinality(ty) > 0 then
    rmax := 0;
    band := greatest(0::float8, least(1::float8, 0.4::float8 + 0.5::float8 * nc / sc));
    for i in 0..cardinality(ty) / 5 - 1 loop
      dx := xk - ty[i * 5 + 2]; dy := yk - ty[i * 5 + 3]; d2 := dx * dx + dy * dy; ta := sqrt(d2) / ty[i * 5 + 5];
      typ := typ - ty[i * 5 + 4] / sqrt(1 + d2 / (ty[i * 5 + 5] * ty[i * 5 + 5]));
      if ta < tya then tya := ta; tyn := ty[i * 5 + 1]::int; tyd := ty[i * 5 + 4]; end if;
      rr := ty[i * 5 + 4] / 50 * greatest(exp(greatest(-700::float8, -((ta - 0.8::float8) / 0.6::float8) * ((ta - 0.8::float8) / 0.6::float8))), 0.55::float8 * exp(-ta / 3.5::float8) * band);   -- exp は −700 まで（0 になるとエラー）
      if rr > rmax then rmax := rr; end if;
    end loop;
    if rmax > 0.05::float8 then cl := 1; end if;
    if rmax > 0.15::float8 then
      inten := greatest(inten, 1 - power((least(100::float8, 2 + 70 * power(rmax - 0.15::float8, 1.3::float8)) - 0.3::float8) / 2.5::float8 + 1, -1.6666666666666667::float8));
      wet := true;
    end if;
  end if;
  amp := (3.75::float8 + 0.75::float8 * c) * (case when wet then 0.4::float8 when cl = 1 then 0.6::float8 when cl > 0 then 0.9::float8 else 1.2::float8 end);
  an := (2.4::float8 + 1.6::float8 * c) * na / sa;
  -- 1日の気温の形：wx.js の diurnal
  if hr >= 6 and hr < 14.5 then dur := -cos(pi() * (hr - 6) / 8.5::float8);
  else uu := hr - 14.5::float8 + 24; if uu >= 24 then uu := uu - 24; end if; uu := uu / 15.5::float8; dur := cos(pi() * power(uu, 0.6::float8)); end if;
  -- 寒波で下がる（首都 15℃・北 10℃・南の 100km より先は だんだん半分まで）。首都の冬の最低は −2℃ から −5℃ まで（南の 400km より先は −2℃ のまま）。猛暑は 6℃（南の島は 3℃）まで上がる
  --   寒波・猛暑で平年がずれないように、冬は少し暖かく・夏は少し涼しくしておく（首都の平年 冬14℃・夏28℃ のまま）
  fs := 1 - greatest(0::float8, least(1::float8, (-dn - 100) / 300));
  aa := (15 - 5 * greatest(0::float8, least(1::float8, dn / 450))) * (0.5::float8 + 0.5::float8 * fs);
  hh2 := 6 - 3 * greatest(0::float8, least(1::float8, -dn / 400));
  v := base + amp * dur + an - (case when wet and c < 0 then 1.2::float8 else 0 end) - aa * ec + 0.112::float8 * ssk * ssk * aa - 0.125::float8 * ssh * ssh * hh2;
  lo := -2 - 3 * ec * fs;
  -- 上と下をなめらかにおさえる：wx.js の soft(v, lo, 31, 3)。猛暑は そのあと
  if v > 31 - 3 then tc := 31 - 3 + 3 * tanh((v - 31 + 3) / 3);
  elsif v < lo + 3 then tc := lo + 3 + 3 * tanh((v - lo - 3) / 3);
  else tc := v; end if;
  tc := tc + hh2 * eh;
  g := case when dn > 0 then (0.028::float8 + 0.012::float8 * c) * dn else (0.008::float8 + 0.004::float8 * c) * dn end;
  t := tc - g - 0.0065::float8 * greatest(0::float8, coalesce(e, 0));
  -- 雷雲（夏の午後）：ゲリラ豪雨。初夏の強いものは ひょう。とても強い雷雲の まん中の 0.1％ぐらいに竜巻（まわり 1.2km・前後 12分）
  cv := 0; hail := false; torn := 0;
  if not lite and ssv > 0.05::float8 and hr >= 11 and hr < 22 and t >= 18 then
    hv := exp(-((hr - 16) / 2.8::float8) * ((hr - 16) / 2.8::float8));
    cv := greatest(0::float8, least(1::float8, (_wx_nv(xk, yk, h) / sv - (3.1::float8 - ssv * hv - 0.4::float8 * greatest(0::float8, least(1::float8, (t - 26) / 6)))) / 0.7::float8));
    if cv > 0 then
      uu := 1 - power((8 + 82 * cv * cv - 0.3::float8) / 2.5::float8 + 1, -1.6666666666666667::float8);
      inten := greatest(inten, uu); sg := greatest(sg, uu); wet := true; cl := 1;
      t := t - 3 * cv;
      hail := cv > 0.45::float8 and d < 200 and t <= 29;
      if cv > 0.85::float8 and d >= 170 then
        fx := (xk - 15 * h) / 12; fy := (yk - 3 * h) / 12; ft := h / 1.4::float8;
        li := floor(fx + 0.5::float8); lj := floor(fy + 0.5::float8); lk := floor(ft + 0.5::float8);
        if _wx_h3(li, lj, lk, 53) > 0.9985::float8 then
          dx := (fx - li) * 12; dy := (fy - lj) * 12;
          torn := greatest(0::float8, least(1::float8, 1 - sqrt(dx * dx + dy * dy) / 1.2::float8)) * greatest(0::float8, least(1::float8, 1 - abs(ft - lk) * 1.4::float8 / 0.2::float8));
        end if;
      end if;
    end if;
  end if;
  -- 霧（夜明けごろ。高気圧で雨のないとき。秋に多い）・黄砂（春。雨のないとき。西ほど こい）
  fg := 0; ds := 0;
  if not lite and not wet then
    hh := case when hr >= 18 then hr - 24 else hr end;
    hf := exp(-((hh - 6) / 2.4::float8) * ((hh - 6) / 2.4::float8));
    kf := hf * greatest(0::float8, least(1::float8, 0.5::float8 + zp)) * (0.6::float8 + 0.4::float8 * cos(2 * pi() * (d - 300) / 365.25::float8));
    if kf > 0.02::float8 then fg := greatest(0::float8, least(1::float8, (_wx_nf(xk, yk, h) / sf - (2.4::float8 - 1.4::float8 * kf)) / 0.7::float8)); end if;
    if ssd > 0.03::float8 then
      ds := greatest(0::float8, least(1::float8, (_wx_nd(xk, yk, h) / sdd * greatest(0.6::float8, least(1.25::float8, 1 - xk / 1600)) - (2 - 0.9::float8 * ssd)) / 0.9::float8));
    end if;
  end if;
  p := 1013 - 7 * zp + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * (yk / 400) + typ;
  kind := case when not wet then '' when t <= 0.6::float8 then 'snow' when t < 2.4::float8 then 'sleet' else 'rain' end;
  ux := kind = 'snow' and ssk < 0.15::float8 - 0.149::float8 * greatest(0::float8, least(1::float8, dn / 330));
end $$;
-- 風：地上の平均風速（m/s）・最大瞬間・ふいてくる向き（北 0・東 90）。wx.js の wind と同じ（台風の気圧（風は 1.8 倍）・竜巻の突風も。DB の更新66）
create or replace function public._wx_wind(x float8, y float8, ms bigint, out spd float8, out gust float8, out dir int)
language plpgsql stable parallel safe set search_path = public as $$
declare o record; xk float8 := x * 0.05::float8; yk float8 := y * 0.05::float8; h float8 := ms::float8 / 3600000; c float8; sp float8; gx float8; gy float8; st float8; ue float8; vn float8;
        jj bigint := ms + 32400000; yy int; y0 bigint; y1 bigint; th float8; ty float8[];
begin
  select q.v into sp from mp_wx_k q where q.k = 'sp';
  yy := extract(year from (date '1970-01-01' + (jj / 86400000)::int));
  y0 := ((make_date(yy, 1, 1) - date '1970-01-01')::bigint) * 86400000; y1 := ((make_date(yy + 1, 1, 1) - date '1970-01-01')::bigint) * 86400000;
  th := 2 * pi() * ((jj - y0)::float8 / (y1 - y0)::float8 - 14.5::float8 / 365.25::float8); c := cos(th);
  ty := _wx_ty(ms, yy, (jj - y0)::float8 / 86400000);
  gx := ((1013 - 7 * (_wx_np(xk + 20, yk, h) / sp) + 6 * greatest(0::float8, c) * (-(xk + 20) / 400) + 4 * greatest(0::float8, -c) * (yk / 400) + 1.8::float8 * _wx_typ(xk + 20, yk, ty))
       - (1013 - 7 * (_wx_np(xk - 20, yk, h) / sp) + 6 * greatest(0::float8, c) * (-(xk - 20) / 400) + 4 * greatest(0::float8, -c) * (yk / 400) + 1.8::float8 * _wx_typ(xk - 20, yk, ty))) / 40 * 100;
  gy := ((1013 - 7 * (_wx_np(xk, yk + 20, h) / sp) + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * ((yk + 20) / 400) + 1.8::float8 * _wx_typ(xk, yk + 20, ty))
       - (1013 - 7 * (_wx_np(xk, yk - 20, h) / sp) + 6 * greatest(0::float8, c) * (-xk / 400) + 4 * greatest(0::float8, -c) * ((yk - 20) / 400) + 1.8::float8 * _wx_typ(xk, yk - 20, ty))) / 40 * 100;
  o := _wx_core(x, y, 0, ms);
  st := case when o.sg > 0.8 then 10 * ((o.sg - 0.8::float8) / 0.2::float8) * ((o.sg - 0.8::float8) / 0.2::float8) else 0 end;   -- 強い雨・雪・雷雲の突風（台風の雨はのぞく）
  spd := 0.6::float8 + sqrt(gx * gx + gy * gy) + st;
  gust := case when o.torn > 0 then greatest(spd * 1.6::float8, 30 + 30 * o.torn) else spd * 1.6::float8 end;   -- 竜巻
  ue := gy * 0.8660254037844387::float8 - gx * 0.5::float8; vn := gy * 0.5::float8 + gx * 0.8660254037844387::float8;
  dir := ((round(atan2(ue, vn) * 180 / pi())::int + 180) % 360 + 360) % 360;
end $$;
-- 積もっている雪（cm）：map/wx.js の snowAt と同じ。150日前から6時間ごとに、降った雪をたして、暖かいととかす
create or replace function public._wx_snow(x float8, y float8, e float8, ms bigint) returns float8
language plpgsql stable set search_path = public as $$
declare st bigint := 6 * 3600000; t1 bigint := floor(ms::float8 / st)::bigint * st; tt bigint; o record; dep float8 := 0;
begin
  tt := t1 - 150 * 4 * st;
  while tt <= t1 loop
    o := _wx_core(x, y, e, tt + 3 * 3600000, true);   -- 台風・雷雲・霧・黄砂は見ない（wx.js の snowAt と同じ。DB の更新66）
    if o.kind = 'snow' then dep := dep + (0.25 + 1.5 * o.inten) * 6;
    elsif o.kind = 'sleet' then dep := dep + (0.2 + 0.8 * o.inten) * 6 * 0.4; end if;
    if o.t > 0 then dep := dep - (0.12 * 6 * o.t + case when o.kind = 'rain' then 1.5 else 0 end); end if;
    dep := case when dep > 0 then dep * 0.988 else 0 end;
    tt := tt + st;
  end loop;
  return dep;
end $$;

-- ---------------------------------------------------------------------
-- 運行の乱れ：変な天気も（DB の更新66）
-- ---------------------------------------------------------------------
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
    when k = 'fog' then case md when 'air' then case when v < 150 then 3 when v < 400 then 2 else 0 end   -- 濃霧：見通し（m。DB の更新66）
                                when 'ship' then case when v < 200 then 3 when v < 500 then 2 else 0 end
                                when 'bus' then case when v < 100 then 2 else 0 end
                                else 0 end
    when k = 'heat' then case when md = 'rail' and v >= 36 then 2 else 0 end   -- 高温：レールがのびる（℃）
    when k = 'hail' then case when md = 'air' then 2 else 0 end                -- ひょう：機体の点検
    else 0 end
$$;
-- 天気の強さ（その場所・その時刻）
--   濃霧（見通し m）は 飛行機 400m・150m、船 500m・200m、バス 100m。高温は鉄道 36℃。ひょうは飛行機（DB の更新66）
create or replace function public._mp_unko_wxk(x float8, y float8, e float8, ms bigint, k text, md text, out lv int, out sev float8)
language plpgsql stable set search_path = public as $$
declare o record; w record;
begin
  lv := 0; sev := 0;
  if k = 'wind' then w := _wx_wind(x, y, ms); sev := w.gust; lv := _mp_unko_lvl(md, 'wind', sev); return; end if;
  o := _wx_core(x, y, e, ms);
  if k = 'rain' and o.kind = 'rain' then sev := _wx_mm(o.inten); lv := _mp_unko_lvl(md, 'rain', sev); end if;
  if k = 'snow' and o.kind = 'snow' then sev := _wx_cm(o.inten); lv := _mp_unko_lvl(md, 'snow', sev); end if;
  if k = 'fog' and o.fg > 0 then sev := round(60 + 1940 * (1 - o.fg) * (1 - o.fg)); lv := _mp_unko_lvl(md, 'fog', sev); end if;   -- 見通し（m。DB の更新66）
  if k = 'hail' and o.hail then sev := o.cv; lv := _mp_unko_lvl(md, 'hail', sev); end if;
  if k = 'heat' then sev := o.t; lv := _mp_unko_lvl(md, 'heat', sev); end if;
end $$;
-- いちばんひどいもの（風・雨・雪・濃霧・高温・ひょう のどれか）。sub：台風N号（台風の風・雨）・竜巻・ゲリラ豪雨
drop function if exists public._mp_unko_wxat(float8, float8, float8, bigint, text);
create or replace function public._mp_unko_wxat(x float8, y float8, e float8, ms bigint, md text, out kind text, out lv int, out sev float8, out sub text)
language plpgsql stable set search_path = public as $$
declare o record; w record; v float8; l int; tys text;
begin
  kind := null; lv := 0; sev := 0; sub := '';
  o := _wx_core(x, y, e, ms);
  tys := case when o.tyn > 0 and o.tya < 3 and o.tyd >= 12 then format('台風%s号', o.tyn) else '' end;
  if o.kind = 'rain' then v := _wx_mm(o.inten); l := _mp_unko_lvl(md, 'rain', v); if l > lv then kind := 'rain'; lv := l; sev := v; sub := case when o.cv > 0 then 'ゲリラ豪雨' else tys end; end if; end if;
  if o.kind = 'snow' then v := _wx_cm(o.inten); l := _mp_unko_lvl(md, 'snow', v); if l > lv then kind := 'snow'; lv := l; sev := v; sub := ''; end if; end if;
  if o.fg > 0 then v := round(60 + 1940 * (1 - o.fg) * (1 - o.fg)); l := _mp_unko_lvl(md, 'fog', v); if l > lv then kind := 'fog'; lv := l; sev := v; sub := ''; end if; end if;
  if o.hail then l := _mp_unko_lvl(md, 'hail', o.cv); if l > lv then kind := 'hail'; lv := l; sev := o.cv; sub := ''; end if; end if;
  l := _mp_unko_lvl(md, 'heat', o.t); if l > lv then kind := 'heat'; lv := l; sev := o.t; sub := ''; end if;
  w := _wx_wind(x, y, ms); l := _mp_unko_lvl(md, 'wind', w.gust);
  if l > lv then kind := 'wind'; lv := l; sev := w.gust; sub := case when o.torn > 0 then '竜巻' else tys end; end if;
end $$;
-- ことば：原因（台風N号の・竜巻・ゲリラ豪雨・濃い霧・高温・ひょう）・場所
create or replace function public._mp_unko_why(z mp_unko) returns text
language sql stable set search_path = public as $$
  select case z.kind when 'wind' then case when z.sub = '竜巻' then format('竜巻（最大瞬間 %sm/s）', round(z.sev))
                                            else coalesce(nullif(z.sub, '') || 'の', '') || case when z.mode = 'ship' then format('強い風と高い波（最大瞬間 %sm/s）', round(z.sev)) else format('強い風（最大瞬間 %sm/s）', round(z.sev)) end end
                     when 'rain' then case when z.sub = 'ゲリラ豪雨' then case when z.mode = 'bus' then format('ゲリラ豪雨で道路が冠水（1時間に %smm）', round(z.sev)) else format('ゲリラ豪雨（1時間に %smm）', round(z.sev)) end
                                            else coalesce(nullif(z.sub, '') || 'の', '') || case when z.mode = 'bus' then format('大雨で道路が冠水（1時間に %smm）', round(z.sev)) else format('強い雨（1時間に %smm）', round(z.sev)) end end
                     when 'snow' then case when z.mode = 'air' then format('大雪で滑走路の除雪（1時間に %scm）', round(z.sev)) else format('強い雪（1時間に %scm）', round(z.sev)) end
                     when 'fog' then format('濃い霧（見通し %sm）', round(z.sev))
                     when 'heat' then format('暑さでレールがのびるおそれ（%s℃）', round(z.sev))
                     when 'hail' then 'ひょう（機体の点検）'
                     else z.sub end
$$;
create or replace function public._mp_unko_where(z mp_unko) returns text
language sql stable set search_path = public as $$
  select coalesce((select s.name || case s.kind when 'rail' then '駅' when 'bus' then '（バス停）' else '' end from mp_stations s where s.id = z.sta),
                  case coalesce(z.mode, 'rail') when 'rail' then '線路' when 'bus' then '道路' when 'ship' then '航路' else '空路' end)
         || case when z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail', 'stuck', 'snowstop') then 'のあたり' else '' end
$$;
-- 乱れの場所の駅：天気（風・雨・雪・濃霧・高温・ひょう）は、かかわる系統の駅のうち まわり約10km
create or replace function public._mp_unko_zone(p_kind text, p_sta bigint, p_x int, p_y int, p_routes bigint[]) returns bigint[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct q.sid), '{}'::bigint[])
    from (select s.id sid from mp_routes ro, unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid
           where ro.id = any(p_routes) and p_kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') and abs(s.x - p_x) <= 20000 and abs(s.y - p_y) <= 20000
             and (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2 <= 400000000::float8
          union all
          select p_sta where p_sta is not null
          union all
          select (select s.id from unnest(ro.stops) u(sid) join mp_stations s on s.id = u.sid order by (s.x - p_x)::float8 ^ 2 + (s.y - p_y)::float8 ^ 2, s.id limit 1)
            from mp_routes ro where ro.id = any(p_routes)) q
   where q.sid is not null
$$;
-- 天気：系統の駅を6つまで見て、いちばんひどいところで運行の乱れを作る（台風N号・竜巻・ゲリラ豪雨をそえる。霧は見通しのいちばん短いところまで予報）
create or replace function public._mp_unko_wxr(rid bigint, ms bigint) returns bigint
language plpgsql set search_path = public as $$
declare r record; uz mp_unko; q record; n int; m int; i int; sid bigint; sx int; sy int; se float8;
        blv int := 0; bsev float8 := 0; bkind text; bsid bigint; bx int; by_ int; be float8; mx int; mxs float8; kk int;
        sf float8; ql int; qk text; qs float8; w record; wl int; qsub text; bsub text := '';
begin
  select ro.id, ro.own_u, ro.own_c, ro.stops, ro.kind into r from mp_routes ro where ro.id = rid;
  if not found or coalesce(array_length(r.stops, 1), 0) < 2 then return null; end if;
  if exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[rid] and z.kind in ('snowstop', 'stuck')) then return null; end if;
  n := array_length(r.stops, 1); m := least(n, 6);
  for i in 0..m - 1 loop
    sid := r.stops[1 + (i * (n - 1)) / greatest(1, m - 1)];
    select x, y into sx, sy from mp_stations where id = sid;
    if not found then continue; end if;
    se := coalesce((_mp_cell(floor(sx / 100.0)::int, floor(sy / 100.0)::int)).e, 0);
    q := _mp_unko_wxat(sx / 100.0, sy / 100.0, se, ms, r.kind);
    qk := q.kind; ql := q.lv; qs := q.sev; qsub := q.sub;   -- 台風N号・竜巻・ゲリラ豪雨（DB の更新66）
    if qk = 'snow' and ql >= 2 and r.kind in ('rail', 'bus') then
      if sf is null then sf := _mp_snow_fac(rid); end if;
      ql := _mp_unko_lvl(r.kind, 'snow', qs * sf);
      if ql < 2 then   -- 雪が弱く数えられたら、風のほうがひどいかもしれない
        w := _wx_wind(sx / 100.0, sy / 100.0, ms); wl := _mp_unko_lvl(r.kind, 'wind', w.gust);
        if wl > ql then qk := 'wind'; ql := wl; qs := w.gust; qsub := ''; end if;
      end if;
    end if;
    if ql > blv or (ql = blv and ql > 0 and qs > bsev) then blv := ql; bsev := qs; bkind := qk; bsid := sid; bx := sx; by_ := sy; be := se; bsub := qsub; end if;
  end loop;
  if blv < 2 then return null; end if;
  select * into uz from mp_unko where st <> 'done' and kind = bkind and mode = r.kind and own_u is not distinct from r.own_u and own_c is not distinct from r.own_c
     and t0 > now() - interval '30 minutes' and abs(x - bx) < 80000 and abs(y - by_) < 80000 order by id desc limit 1;
  if found then   -- その系統のいちばんひどい駅のまわりも、場所の駅に（DB の更新60）
    update mp_unko set routes = routes || r.id,
           zs = case when zs is null then null else array(select distinct q from unnest(zs || _mp_unko_zone(bkind, bsid, bx, by_, array[r.id])) q) end
     where id = uz.id and not (routes @> array[r.id]);
    return uz.id;
  end if;
  mx := blv; mxs := bsev; kk := 0;
  while kk < 16 loop
    q := _mp_unko_wxk(bx / 100.0, by_ / 100.0, be, ms + (kk + 1) * 900000, bkind, r.kind);
    ql := q.lv;
    if bkind = 'snow' and sf is not null then ql := _mp_unko_lvl(r.kind, 'snow', q.sev * sf); end if;
    exit when ql < 2;
    kk := kk + 1; mx := greatest(mx, ql); mxs := case when bkind = 'fog' then least(mxs, q.sev) else greatest(mxs, q.sev) end;   -- 霧は見通しが短いほど ひどい
  end loop;
  return _mp_unko_new(bkind, coalesce(bsub, ''), bsid, bx, by_, array[r.id], mx, bsev::real, mxs::real, (kk + 1) * 900, r.own_u, r.own_c);
end $$;
-- 対応を決める：あまい対応のあとのトラブルに、霧・高温・ひょうも
create or replace function public._mp_unko_apply(p_id bigint, p_pick int, p_auto boolean) returns void
language plpgsql set search_path = public as $$
declare z mp_unko; td float8 := extract(epoch from now()); t0 float8; te float8; ww jsonb := '[]'::jsonb; e jsonb; fit text; f float8; len float8; tr text; lg jsonb;
        rate float8; thin int; ed float8; md text; who text; first boolean; tg text; stopt text; wd int;
begin
  select * into z from mp_unko where id = p_id for update;
  if not found or z.st = 'done' then return; end if;
  first := z.st = 'ask'; md := coalesce(z.mode, 'rail');
  wd := case when z.wide then 1 else 0 end;   -- 全線（窓の6つめ。DB の更新60）
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
  lg := jsonb_build_array(jsonb_build_array(td, format('%s：%s%s（%s）', case when first then '対応' else '対応を変えました' end, _mp_unko_pickt(p_pick, md), case when z.wide then '・全線' else '' end, who)));
  stopt := case md when 'air' then '欠航しています' when 'ship' then '欠航しています' when 'bus' then '運休しています' else '運転を見合わせています' end;
  if fit = 'under' and td < te then
    f := case when z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') then 600 else 360 end;
    len := greatest(1800, 1.5 * (te - td));
    if p_pick > 1 then ww := ww || jsonb_build_array(jsonb_build_array(td, td + f, rate, thin, 'p', wd)); end if;
    ww := ww || jsonb_build_array(jsonb_build_array(td + f, td + f + len, 0, 0, 't', wd));
    tr := case z.kind when 'wind' then case md when 'ship' then '高い波で船が大きくゆれ、港へもどりました' when 'air' then '強い横風で着陸をやりなおし、空港を閉じました' when 'bus' then '強風で倒れた木が道路をふさぎました' else '架線に飛来物がひっかかりました' end
                      when 'rain' then case md when 'bus' then '冠水した道路で車両が動けなくなりました' when 'air' then '雷雲で出発できなくなりました' else '線路に土砂が流れこみました' end
                      when 'snow' then case md when 'bus' then '雪でバスが立ち往生しました' when 'air' then '滑走路の除雪がおいつかなくなりました' else 'ポイントが雪で動かなくなりました' end
                      when 'fog' then case md when 'air' then '霧で着陸をやりなおし、ほかの空港へ向かいました' when 'ship' then '霧で前が見えず、港へもどりました' when 'bus' then '霧で前が見えず、追突事故が起きました' else '霧で信号が見えにくくなりました' end
                      when 'heat' then '暑さでレールがゆがみました' when 'hail' then 'ひょうで機体がへこみ、点検が必要になりました'
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
    ww := ww || jsonb_build_array(jsonb_build_array(td, ed, rate, thin, 'p', wd));
    if fit = 'over' then lg := lg || jsonb_build_array(jsonb_build_array(greatest(td + 60, ed - 900), '念のため、点検・確認をつづけています')); end if;
  end if;
  ed := coalesce((select max((x ->> 1)::float8) from jsonb_array_elements(ww) x), td);
  -- 記録：これからの予定（前の対応のトラブルなど）はけして、新しいものを足す
  update mp_unko set pick = p_pick, pick_at = to_timestamp(td), pick_auto = p_auto, wins = ww, t_end = to_timestamp(greatest(ed, td)), st = 'run',
         log = (select coalesce(jsonb_agg(l order by o), '[]'::jsonb) from jsonb_array_elements(log) with ordinality x(l, o) where (l ->> 0)::float8 <= td + 1) || lg
   where id = p_id;
end $$;
-- 起きた：えらぶまで天気（霧・高温・ひょうも）は徐行。霧・高温の予報のことば
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
  prov := case when p_kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail', 'atc', 'traffic') then 0.6 else 0 end;   -- えらぶまで：天気・混雑は徐行（待つ）、ほかは その場で止まる
  insert into mp_unko(kind, sub, sta, x, y, routes, own_u, own_c, lv, sev, sevmax, dur, ask_until, wins, t_end, mode, zs)
    values (p_kind, coalesce(p_sub, ''), p_sta, p_x, p_y, p_routes, p_ou, p_oc, p_lv, p_sev, p_sevmax, p_dur, to_timestamp(ts0 + 600),
            jsonb_build_array(jsonb_build_array(ts0, ts0 + 600, prov, 0, 'v')), to_timestamp(ts0 + 600), md,
            _mp_unko_zone(p_kind, p_sta, p_x, p_y, p_routes))   -- 場所の駅（列車がきくのは、この駅と となりの駅のあいだ。DB の更新60）
    returning * into z;
  fc := case when z.kind in ('wind', 'rain', 'snow') and z.sevmax > z.sev + 0.5 then format('（これから %s ぐらいまで強くなる予報）',
          case z.kind when 'wind' then round(z.sevmax) || 'm/s' when 'rain' then round(z.sevmax) || 'mm' else round(z.sevmax) || 'cm' end)
             when z.kind = 'fog' and z.sevmax < z.sev - 20 then format('（これから 見通し %sm ぐらいまで悪くなる予報）', round(z.sevmax))   -- DB の更新66
             when z.kind = 'heat' and z.sevmax > z.sev + 0.5 then format('（これから %s℃ ぐらいまで上がる予報）', round(z.sevmax)) else '' end;
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
-- 5分ごと：天気の乱れは 風・雨・雪・濃霧・高温・ひょう
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
  -- 3) 天気：系統ごと（15分に1回）。鉄道・バス・船・飛行機（風・雨・雪・濃霧・高温・ひょう。DB の更新66）
  for r in select ro.id from mp_routes ro
            where ro.ok and ro.kind in ('rail', 'bus', 'ship', 'air') and ro.id % 3 = bk and coalesce(array_length(ro.stops, 1), 0) >= 2
              and exists (select 1 from mp_trains t where t.route = ro.id and not coalesce(t.bad, false))
              and not exists (select 1 from mp_unko z where z.st <> 'done' and z.routes @> array[ro.id] and z.kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail')) loop
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
    if exists (select 1 from mp_unko z where z.st <> 'done' and z.kind not in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') and (z.sta = s.id or z.routes && s.rs)) then continue; end if;
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
-- 運行の乱れを起こす（管理者だけ）：濃霧（飛行機・船・バス）・高温（鉄道）・ひょう（飛行機）も
create or replace function public.mp_unko_make(p_sta bigint, p_route bigint, p_kind text, p_sub text, p_lv int, p_min int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s mp_stations; rs bigint[]; ou uuid; oc int; zid bigint; sev real; sub text; md text;
begin
  perform _mp_ok(u);
  if not _is_admin(u) then raise exception '管理者だけが使えます'; end if;
  select * into s from mp_stations where id = p_sta;
  if not found then raise exception '駅・空港・港・バス停をえらんでください'; end if;
  md := s.kind;
  if p_kind is null or not (p_kind = any(case md when 'air' then array['wind', 'rain', 'snow', 'fog', 'hail', 'car', 'bird', 'rwy', 'atc', 'sick']
                                                when 'ship' then array['wind', 'fog', 'car', 'wave', 'sick']
                                                when 'bus' then array['wind', 'rain', 'snow', 'fog', 'accident', 'traffic', 'car', 'sick']
                                                else array['person', 'sick', 'car', 'signal', 'track', 'wind', 'rain', 'snow', 'heat'] end)) then raise exception '原因をえらんでください'; end if;
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
                     when 'snow' then case p_lv when 3 then 9 when 2 then 4 else 2 end
                     when 'fog' then case p_lv when 3 then 100 when 2 then 300 else 800 end   -- 見通し m（DB の更新66）
                     when 'heat' then case p_lv when 3 then 38 when 2 then 36 else 34 end when 'hail' then 0.6 end;
  sub := case when p_kind in ('wind', 'rain', 'snow', 'fog', 'heat', 'hail') then ''
              else left(coalesce(nullif(btrim(p_sub), ''), case p_kind when 'person' then '人と接触' when 'sick' then '急病のお客さまの救護'
                                                                         when 'car' then case md when 'air' then '機材の点検' when 'ship' then 'エンジンの点検' else '車両の点検' end
                                                                         when 'signal' then '信号の確認' when 'track' then '線路内の点検' when 'bird' then 'バードストライク（機体の点検）'
                                                                         when 'rwy' then '滑走路の点検' when 'atc' then '管制の混雑' when 'wave' then 'うねりで揺れが大きい'
                                                                         when 'accident' then '交通事故' when 'traffic' then '渋滞' else '点検' end), 40) end;
  zid := _mp_unko_new(p_kind, sub, s.id, s.x, s.y, rs, p_lv, sev, sev, p_min * 60, ou, oc);
  return jsonb_build_object('id', zid, 'routes', cardinality(rs), 'by', _mp_pname(ou, oc, false));
end $$;
-- 運行情報（国じゅう）：wx 2 ＝ 濃霧・高温・ひょう の乱れがある（画面の目印）
create or replace function public.mp_unko_list(p_as text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me_g(); pu uuid; pc int; gv boolean := false; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  begin select x.pu, x.pc, x.gv into pu, pc, gv from _mp_party(u, p_as) x; exception when others then pu := u; pc := null; gv := false; end;
  return jsonb_build_object('now', extract(epoch from now()), 'v3', true, 'wx', 2, 'list', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'kind', z.kind, 'sub', z.sub, 'why', _mp_unko_why(z), 'where', _mp_unko_where(z), 'x', z.x, 'y', z.y,
    'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'own', _mp_pname(r.own_u, r.own_c, false),
                         'mine', (pu is not null or pc is not null or gv) and r.own_u is not distinct from pu and r.own_c is not distinct from pc, 'furi', r.id = any(z.furi),
                         'zi', q.zi, 'zt', _mp_unko_zt(r.id, q.zi)) order by r.id), '[]'::jsonb)   -- 乱れがきく区間（駅の何番目〜何番目。null は全線。DB の更新60）
                 from mp_routes r cross join lateral (select _mp_unko_zi(z, r.id) zi) q where r.id = any(z.routes)),
    'mode', z.mode, 'sev', z.sev, 'sevmax', z.sevmax, 't0', extract(epoch from z.t0), 'until', extract(epoch from z.ask_until),
    'pick', z.pick, 'auto', z.pick_auto, 'wins', z.wins, 'tend', extract(epoch from z.t_end), 'st', z.st, 'wide', z.wide,
    'log', (select coalesce(jsonb_agg(l order by (l ->> 0)::float8), '[]'::jsonb) from jsonb_array_elements(z.log) l where (l ->> 0)::float8 <= extract(epoch from now()) + 1),
    'by', _mp_pname(z.own_u, z.own_c, false),
    'me', (pu is not null or pc is not null) and z.own_u is not distinct from pu and z.own_c is not distinct from pc,
    'can', case when z.own_u = u then 'me' when z.own_c is not null then (select c.cid from companies c where c.id = z.own_c and c.owner = u and c.status = 'active') end
  ) order by z.t0 desc), '[]'::jsonb) from mp_unko z where z.st <> 'done' or z.t_end > now() - interval '3 hours'),
    -- 持ち主が決めた運休（1本：きのうから・編成ごと：おわって6時間まで）：[id, 列車, 日, 編成, はじめ, おわり, 乱れ, 自分の]（DB の更新60）
    'cx', (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.train, c.day, c.form, extract(epoch from c.t0), extract(epoch from e.t1), c.unko,
                    (pu is not null or pc is not null or gv) and c.own_u is not distinct from pu and c.own_c is not distinct from pc) order by c.id), '[]'::jsonb)
             from mp_cxl c left join mp_unko z2 on z2.id = c.unko
             cross join lateral (select coalesce(c.t1, case when z2.st = 'done' then greatest(z2.t_end, z2.t0 + make_interval(secs => z2.dur)) end) t1) e
            where (c.day is not null and c.day >= today - 1) or (c.form is not null and coalesce(e.t1, 'infinity'::timestamptz) > now() - interval '6 hours')));
end $$;

-- 関数の権限：だれでも（ログインなし）は呼べない。_ ではじまるものは、ログインしても呼べない
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_wx\_%' or p.proname like '\_mp\_unko\_%' or p.proname in ('mp_unko_make', 'mp_unko_list')) loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
