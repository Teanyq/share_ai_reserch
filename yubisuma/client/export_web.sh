#!/usr/bin/env bash
# Web 版を書き出して server/public に置く（サーバがそのまま配信する）。
# 使い方: GODOT=/path/to/godot ./export_web.sh
# 事前に Godot エディタの「エディタ → エクスポートテンプレートの管理」でテンプレートを入れておくこと。
set -euo pipefail
cd "$(dirname "$0")"
GODOT="${GODOT:-godot}"
OUT=../server/public
rm -rf "$OUT"
mkdir -p "$OUT"
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
"$GODOT" --headless --path . --export-release "Web" "$OUT/index.html"
# wasm（約 40MB）は gzip 版だけを置く（約 9MB。リポジトリを軽くするため）。
# サーバは .gz をそのまま Content-Encoding: gzip で返す
gzip -9 -f "$OUT"/*.wasm
gzip -9 -k -f "$OUT"/index.js
ls -la "$OUT"
