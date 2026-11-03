#!/usr/bin/env bash
# 風の芽経済組：国土を 5×5 に広げる（新しい土地・道路・空港10・国の建物・町の建物）。1回だけ
#
#   bash ~/kz/server/w5.sh           たしかめて、y を押すと入れる（とちゅうで止まったら、もう一度打つと続きから）
#   bash ~/kz/server/w5.sh --check   入れられるかを見るだけ（DB は変えない）
#   bash ~/kz/server/w5.sh --yes     y を聞かずに入れる（本人の OK のあとに打つ用）
#
# しくみ
#   - 先に update.sh で DB の更新52（20261101-52_sc_fast.sql）まで入れておく（50：島・人口のかたまりの索引、52：施設の客の計算を速く）
#   - 土地のデータ（w5_land.sql.gz）と建物のデータ（w5_build.tar.gz）を、~/kz-w5 → ダウンロードのフォルダ → GitHub のリリース（RELTAG）の順にさがして、
#     sha256 が下の SHA_LAND・SHA_BUILD と同じかをたしかめる（ちがえば止まる）。Claude からもらったファイルは、ひらかずに ダウンロードのフォルダに置けばよい
#   - はじめに、public のバックアップを ~/kz-backups に取る（update.sh と同じ）
#   - 土地（地形・県・市町村・町字・川・島・人口・道路）：1つのトランザクション（数分）。とちゅうでエラーなら全部取り消して止まる
#   - 空港10・国の建物（県庁・役所・郵便局・神社・寺 など 約8,000）・町の建物（国営の不動産会社4社）：ファイルごと（1つ 30秒ぐらい）。
#     もうあるもの・建てられないものはとばす。毎時55分になったら止める（毎時2分の国土の処理にかからないように）→ 7分をすぎてから、もう一度打つと続きから
#   - 入れたことを kz_ops.migrations に記録する（土地は2回は入れない）
set -euo pipefail
export LC_ALL=C.UTF-8
REPO="RateCalProject/tes.1.0.0.8v101"
RELTAG="w5-land-1"
SHA_LAND="5d0e70a7dc9e19d914482accd2690c6df63d1066767ac5af3ca1aaea3e0b9f5a"
SHA_BUILD="c951d8763f8c13f29000e06387969934bba35b2667e4a8a77bc37a481adc3c2b"
KZ="${KZ_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB="${KZ_DB:-supabase-db}"
BK="${KZ_BACKUPS:-$HOME/kz-backups}"
DL="${KZ_W5_DIR:-$HOME/kz-w5}"
MODE=apply
case "${1:-}" in
  '') ;; --check) MODE=check ;; --yes) MODE=yes ;;
  *) echo "使い方: bash w5.sh [--check | --yes]"; exit 2 ;;
esac
if [ -n "${KZ_PSQL:-}" ]; then read -r -a PSQL <<< "$KZ_PSQL"; else PSQL=(docker exec -i "$DB" psql -U postgres -d postgres); fi
PSQL+=(-X -q -v ON_ERROR_STOP=1)
if [ -n "${KZ_PGDUMP:-}" ]; then read -r -a PGDUMP <<< "$KZ_PGDUMP"; else PGDUMP=(docker exec -i "$DB" pg_dump -U postgres -d postgres); fi
say() { printf '%s\n' "$*"; }
die() { printf '× %s\n' "$*" >&2; exit 1; }
log() { mkdir -p "$BK" && chmod 700 "$BK" && printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$BK/update.log"; }
one() { "${PSQL[@]}" -At -c "$1"; }
mm() { if [ -n "${KZ_W5_MIN:-}" ]; then echo "$KZ_W5_MIN"; else echo $((10#$(TZ=Asia/Tokyo date +%M))); fi; }   # KZ_W5_MIN：ためすときだけ（分）

# 1. DB の更新52まで入っているか・もう入っているか
"${PSQL[@]}" -c "select 1" > /dev/null 2>&1 || die "DB につながりません（docker ps で supabase-db が動いているか見てください）"
[ "$(one "select count(*) from kz_ops.migrations where name in ('20261031-50_w5_prep.sql', '20261101-52_sc_fast.sql')" 2>/dev/null || echo 0)" = 2 ] \
  || die "先に bash ~/kz/server/update.sh で DB の更新を入れてください（20261101-52_sc_fast.sql まで）"
land_done=$(one "select count(*) from kz_ops.migrations where name = 'w5_land'")
build_done=$(one "select count(*) from kz_ops.migrations where name = 'w5_build'")
if [ "$land_done" = 1 ] && [ "$build_done" = 1 ]; then say "国土 5×5 は、もう入っています（何もしません）"; exit 0; fi
if [ "$land_done" = 0 ] && [ "$(one "select count(*) from mp_chunks where cx < -24 or cx > 23 or cy < -24 or cy > 42")" != 0 ]; then
  die "新しい土地のチャンクが、記録なしで入っています（Claude に知らせてください）"
fi

# 2. 取ってくる・たしかめる
mkdir -p "$DL"; chmod 700 "$DL"
get() {   # get ファイル名 sha256：~/kz-w5 → ダウンロードのフォルダ（Claude からもらったもの）→ GitHub のリリース
  local f="$DL/$1" d
  if [ -s "$f" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$2" ]; then say "  ○ $1（あります）"; return; fi
  for d in "$HOME/Downloads" "$HOME/ダウンロード" "$HOME/Desktop" "$HOME/デスクトップ" "$HOME"; do
    if [ -s "$d/$1" ] && [ "$(sha256sum "$d/$1" | cut -d' ' -f1)" = "$2" ]; then cp "$d/$1" "$f"; say "  ○ $1（$d から）"; return; fi
  done
  say "  → $1 を GitHub から取ってきます"
  if ! curl -fsL --retry 3 -o "$f.part" "https://github.com/$REPO/releases/download/$RELTAG/$1"; then
    rm -f "$f.part"; die "$1 が見つかりません。Claude からもらった $1 を、ひらかずに ダウンロードのフォルダ（か $DL）に置いてから、もう一度打ってください"
  fi
  mv "$f.part" "$f"
  [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$2" ] || { rm -f "$f"; die "$1 の中身がちがいます（sha256。Claude に知らせてください）"; }
  say "  ○ $1（$(du -h "$f" | cut -f1)）"
}
say "データ"
[ "$land_done" = 1 ] || get w5_land.sql.gz "$SHA_LAND"
get w5_build.tar.gz "$SHA_BUILD"
[ "$land_done" = 1 ] || gzip -t "$DL/w5_land.sql.gz" || die "土地のデータがこわれています"
rm -rf "$DL/build.new"; mkdir -p "$DL/build.new"
tar -xzmf "$DL/w5_build.tar.gz" -C "$DL/build.new" || die "建物のデータがこわれています"
nb=$(ls "$DL/build.new"/*.sql 2>/dev/null | wc -l); [ "$nb" -gt 0 ] || die "建物のデータが空です"
say "  いまの DB：$(one "select pg_size_pretty(pg_database_size(current_database()))")（ぜんぶ入れると 1.6GB ぐらいふえます）・建物のファイル ${nb}こ"
if [ "$MODE" = check ]; then rm -rf "$DL/build.new"; say "○ 入れられます（見ただけです。DB は変えていません）"; exit 0; fi

# 3. 時間と、たしかめ（土地は 7分〜35分に始める。建物だけの続きは 7分〜54分）
m=$(mm)
lim=35; [ "$land_done" = 1 ] && lim=54
if [ "$m" -lt 7 ] || [ "$m" -gt "$lim" ]; then die "毎時2分の国土の処理にかからないように、毎時 7分〜${lim}分 に打ってください（いまは $(TZ=Asia/Tokyo date +%H:%M)）"; fi
if [ "$land_done" = 0 ] && [ "$MODE" = apply ]; then
  a=""; read -r -p "国土を 5×5 に広げます。入れますか？ (y/N) " a < /dev/tty || true
  [ "$a" = y ] || [ "$a" = Y ] || die "やめました（何も変えていません）"
elif [ "$land_done" = 1 ]; then
  say "土地は入っています。建物の続きを入れます"
fi

# 4. バックアップ（土地を入れる前だけ）
if [ "$land_done" = 0 ]; then
  mkdir -p "$BK"; chmod 700 "$BK"
  bf="$BK/before-w5-$(date +%Y%m%d-%H%M%S).dump"
  ( umask 077; "${PGDUMP[@]}" -n public -Fc > "$bf" ) || { rm -f "$bf"; die "バックアップが取れませんでした（何も変えていません）"; }
  [ -s "$bf" ] || { rm -f "$bf"; die "バックアップが空でした（何も変えていません）"; }
  say "バックアップ：$bf（$(du -h "$bf" | cut -f1)）"
fi

# 5. 土地（1つのトランザクション）
if [ "$land_done" = 0 ]; then
  t0=$(date +%s); say "→ 土地（地形・地名・町字・道路）"
  if ! gunzip -c "$DL/w5_land.sql.gz" | "${PSQL[@]}"; then log "NG w5_land"; die "土地でエラーになりました。土地は入っていません（全部取り消しました）。エラーを Claude に見せてください"; fi
  "${PSQL[@]}" -c "insert into kz_ops.migrations(name, sha256, git_commit) values ('w5_land', '$SHA_LAND', '$RELTAG')"
  log "OK w5_land ($RELTAG)"; say "  ○ 入れました（$(( $(date +%s) - t0 ))秒）"
fi

# 6. 空港・国の建物・町の建物（ファイルごと。入れたファイルは done.txt におぼえる）
mkdir -p "$DL/build"; touch "$DL/build/done.txt"
cp -f "$DL/build.new"/*.sql "$DL/build/"; rm -rf "$DL/build.new"
t0=$(date +%s); n=0; left=0
for f in $(ls "$DL/build"/*.sql | sort); do
  b=$(basename "$f")
  grep -qx "$b" "$DL/build/done.txt" && continue
  m=$(mm)
  if [ "$m" -ge 55 ] || [ "$m" -le 6 ]; then
    left=$(( $(ls "$DL/build"/*.sql | wc -l) - $(wc -l < "$DL/build/done.txt") ))
    say ""; say "毎時2分の国土の処理の近くになったので、ここで止めます（のこり ${left}ファイル）。"
    say "毎時7分をすぎてから、もう一度 bash ~/kz/server/w5.sh を打つと続きからです"; exit 0
  fi
  say "→ $b"
  if ! { echo "set statement_timeout = 0; set client_min_messages = notice;"; cat "$f"; } | "${PSQL[@]}"; then log "NG w5_build $b"; die "$b でエラーになりました（それまでのものは入っています）。エラーを Claude に見せてください"; fi
  echo "$b" >> "$DL/build/done.txt"; n=$((n + 1))
done
"${PSQL[@]}" -c "insert into kz_ops.migrations(name, sha256, git_commit) values ('w5_build', '$SHA_BUILD', '$RELTAG') on conflict (name) do nothing"
log "OK w5_build ($RELTAG)"; say "  ○ 建てました（${n}ファイル・$(( $(date +%s) - t0 ))秒）"
say ""
say "○ 国土を 5×5 に広げました。Claude に「広げた」と送ってください（Claude が地図の画面を新しくします）"
