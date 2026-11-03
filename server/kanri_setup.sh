#!/usr/bin/env bash
# 風の芽経済組：サーバー管理のアプリ（kanri.py）を使えるようにする（はじめに1回）
#   bash ~/kz/server/kanri_setup.sh
#   - python3-tk（窓を出すもの）がなければ入れる（Ubuntu のパスワードを聞かれます）
#   - アプリ一覧とデスクトップに「風の芽 管理」のアイコンを置く
#   - アプリのパスワードは、はじめてアプリをひらいたときに決めます
set -euo pipefail
KZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$(id -u)" = 0 ]; then echo "× root ではなく、ふだんのユーザーで打ってください"; exit 1; fi
if ! python3 -c "import tkinter" 2> /dev/null; then
  echo "→ python3-tk を入れます（Ubuntu のパスワードを聞かれます）"
  sudo apt-get install -y python3-tk
fi
python3 -c "import tkinter" || { echo "× python3-tk が入りませんでした"; exit 1; }
d="$HOME/.local/share/applications"; mkdir -p "$d"
cat > "$d/kz-kanri.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=風の芽 管理
Comment=風の芽経済組のサーバー管理（ようす・更新・バックアップ）
Exec=python3 $KZ/server/kanri.py
Icon=utilities-system-monitor
Terminal=false
Categories=System;
EOF
chmod 644 "$d/kz-kanri.desktop"
desk=$(xdg-user-dir DESKTOP 2> /dev/null || echo "$HOME/Desktop")
if [ -d "$desk" ]; then
  cp "$d/kz-kanri.desktop" "$desk/kz-kanri.desktop"; chmod 755 "$desk/kz-kanri.desktop"
  gio set "$desk/kz-kanri.desktop" metadata::trusted true 2> /dev/null || true
fi
echo "○ できました。アプリ一覧（とデスクトップ）の「風の芽 管理」からひらけます"
echo "  はじめてひらくと、アプリのパスワードを決めます（Ubuntu のパスワードとは、ちがうものに）"
