#!/usr/bin/env bash
# Biên dịch lõi SIWC thuần Java và chạy kiểm thử với máy chủ giả (không cần Android SDK).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
SRC=android/app/src/main/java/vn/nhipsong/app/siwc
javac -encoding UTF-8 -d "$OUT" "$SRC/MiniJson.java" "$SRC/SiwcCore.java" native-tests/SiwcCoreTest.java
java -Dstdout.encoding=UTF-8 -Dfile.encoding=UTF-8 -cp "$OUT" SiwcCoreTest
# Kiểm tra biên dịch lớp Android/Capacitor với API giả (bắt lỗi cú pháp/kiểu; KHÔNG thay thế build thật)
STUB=$(mktemp -d)
javac -encoding UTF-8 -d "$STUB" $(find native-tests/stubs -name '*.java') "$SRC"/*.java android/app/src/main/java/vn/nhipsong/app/MainActivity.java
echo "Biên dịch lớp Android với API giả: OK"
