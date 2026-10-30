#!/usr/bin/env bash
# 風の芽経済組：自宅サーバーの DB に、GitHub の更新（supabase/migrations の .sql）を入れる
#
#   bash ~/kz/server/update.sh           まだ入れていない更新を見せて、y を押すと入れる
#   bash ~/kz/server/update.sh --list    入れた更新・まだの更新を見るだけ（DB は変えない）
#   bash ~/kz/server/update.sh --check   まだの更新を、ためしに入れて取り消す（入るかどうかだけ見る）
#   bash ~/kz/server/update.sh --yes     y を聞かずに入れる（サーバーの Claude が、本人の OK のあとに打つ用）
#
# しくみ
#   - GitHub の main を取ってくる（git pull --ff-only。このフォルダで手で変えたファイルがあると止まる）
#   - supabase/migrations/*.sql（git にあるものだけ）を名前の順に見て、まだ入れていないものだけを入れる
#   - 入れる前に、public のバックアップを ~/kz-backups に取る（新しい10こまで。持ち主だけ読める）
#   - 1ファイル＝1トランザクション。とちゅうでエラーなら、そのファイルは全部取り消して、そこで止まる
#   - 入れたファイルの名前・sha256・コミットを kz_ops.migrations に記録する（2回は入れない。
#     入れたあとにファイルの中身が変わっていたら止まる。直すときは新しいファイルにする）
#   - 毎時2分の国土の処理（朝4時の見なおしもふくむ）の近く（57分〜6分）では入れない
set -euo pipefail
export LC_ALL=C.UTF-8
KZ="${KZ_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB="${KZ_DB:-supabase-db}"
BK="${KZ_BACKUPS:-$HOME/kz-backups}"
MODE=apply
case "${1:-}" in
  '') ;; --list) MODE=list ;; --check) MODE=check ;; --yes) MODE=yes ;;
  *) echo "使い方: bash update.sh [--list | --check | --yes]"; exit 2 ;;
esac
if [ -n "${KZ_PSQL:-}" ]; then read -r -a PSQL <<< "$KZ_PSQL"; else PSQL=(docker exec -i "$DB" psql -U postgres -d postgres); fi
PSQL+=(-X -q -v ON_ERROR_STOP=1)
if [ -n "${KZ_PGDUMP:-}" ]; then read -r -a PGDUMP <<< "$KZ_PGDUMP"; else PGDUMP=(docker exec -i "$DB" pg_dump -U postgres -d postgres); fi
say() { printf '%s\n' "$*"; }
die() { printf '× %s\n' "$*" >&2; exit 1; }
log() { mkdir -p "$BK" && chmod 700 "$BK" && printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$BK/update.log"; }

# 1. GitHub から取ってくる
cd "$KZ"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "$KZ に手で変えたファイルがあります（git status で見てください）"
br=$(git rev-parse --abbrev-ref HEAD)
[ "$br" = main ] || die "main ではありません（いまは $br）。git checkout main してください"
git pull -q --ff-only origin main || die "GitHub から取ってこられませんでした（ネットか、手元の変更を見てください）"
commit=$(git rev-parse --short HEAD)
say "GitHub の main：$commit $(git log -1 --format=%s | cut -c1-60)"

# 2. 入れた記録
if [ "$MODE" != list ]; then
  "${PSQL[@]}" <<'SQL' || die "DB につながりません（docker ps で supabase-db が動いているか見てください）"
set client_min_messages = warning;
create schema if not exists kz_ops;
revoke all on schema kz_ops from public;
create table if not exists kz_ops.migrations (
  name       text primary key,
  sha256     text not null,
  git_commit text,
  applied_at timestamptz not null default now()
);
revoke all on all tables in schema kz_ops from public;
SQL
fi
applied=$("${PSQL[@]}" -At -c "select name || ' ' || sha256 from kz_ops.migrations order by name" 2>/dev/null) || applied=""

# 3. まだ入れていない更新
mapfile -t files < <(git ls-files 'supabase/migrations/*.sql' | sort)
pending=(); done_n=0
for f in "${files[@]}"; do
  n=$(basename "$f")
  [[ "$n" =~ ^[0-9A-Za-z._-]+\.sql$ ]] || die "ファイル名に使えない文字があります：$n"
  s=$(sha256sum "$f" | cut -d' ' -f1)
  old=$(awk -v n="$n" '$1 == n { print $2 }' <<< "$applied")
  if [ -n "$old" ]; then
    [ "$old" = "$s" ] || die "入れたあとに中身が変わっています：$n（Claude に知らせてください）"
    done_n=$((done_n + 1)); [ "$MODE" = list ] && say "  ○ 入れた　$n"
    continue
  fi
  if grep -qiE '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction)[[:space:]]*;' "$f"; then
    die "$n に begin / commit があります（1ファイル＝1トランザクションで入れるので、書かないでください）"
  fi
  pending+=("$f")
done
say "入れた更新：${done_n}こ　まだの更新：${#pending[@]}こ"
if [ "${#pending[@]}" -eq 0 ]; then say "新しい更新はありません"; exit 0; fi
for f in "${pending[@]}"; do
  say ""; say "■ $(basename "$f")（$(wc -l < "$f")行）"
  awk 'NR <= 20 && /^--/ { sub(/^-- ?/, "   "); print; next } { exit }' "$f"
done
say ""
[ "$MODE" = list ] && exit 0

# 4. ためしに入れる（取り消す）
if [ "$MODE" = check ]; then
  { echo "begin;"; echo "set local statement_timeout = 0;"
    for f in "${pending[@]}"; do echo "\\echo → $(basename "$f")"; cat "$f"; echo; done
    echo "rollback;"; } | "${PSQL[@]}" || die "エラーになりました（ためしただけなので、DB は変わっていません）。Claude にエラーを見せてください"
  say "○ ぜんぶ入ります（ためしただけなので、取り消しました）"
  exit 0
fi

# 5. 時間と、たしかめ
m=$((10#$(TZ=Asia/Tokyo date +%M)))
if [ "$m" -ge 57 ] || [ "$m" -le 6 ]; then die "毎時2分の国土の処理の近くです。$(TZ=Asia/Tokyo date +%H):07 をすぎてから、もう一度打ってください"; fi
if [ "$MODE" = apply ]; then
  a=""; read -r -p "入れますか？ (y/N) " a < /dev/tty || true
  [ "$a" = y ] || [ "$a" = Y ] || die "やめました（何も変えていません）"
fi

# 6. バックアップ
mkdir -p "$BK"; chmod 700 "$BK"
bf="$BK/before-$(date +%Y%m%d-%H%M%S).dump"
( umask 077; "${PGDUMP[@]}" -n public -Fc > "$bf" ) || { rm -f "$bf"; die "バックアップが取れませんでした（何も変えていません）"; }
[ -s "$bf" ] || { rm -f "$bf"; die "バックアップが空でした（何も変えていません）"; }
ls -1t "$BK"/before-*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f --
say "バックアップ：$bf（$(du -h "$bf" | cut -f1)）"

# 7. 入れる（1ファイル＝1トランザクション）
for f in "${pending[@]}"; do
  n=$(basename "$f"); s=$(sha256sum "$f" | cut -d' ' -f1); t0=$(date +%s)
  say "→ $n"
  if ! { echo "begin;"; echo "set local statement_timeout = 0;"; echo "set local lock_timeout = '15s';"; echo "set local client_min_messages = warning;"; cat "$f"; echo
         echo "insert into kz_ops.migrations(name, sha256, git_commit) values ('$n', '$s', '$commit');"
         echo "commit;"; } | "${PSQL[@]}"; then
    log "NG $n ($commit)"
    die "$n でエラーになりました。このファイルは入っていません（前のものは入っています）。エラーを Claude に見せてください"
  fi
  log "OK $n ($commit)"
  say "  ○ 入れました（$(( $(date +%s) - t0 ))秒）"
done
say ""
say "○ 更新を ${#pending[@]}こ 入れました。Claude に「更新した」と送ってください（画面の変更があれば、Claude が GitHub に出します）"
