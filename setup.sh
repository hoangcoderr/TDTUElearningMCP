#!/bin/sh
# Cài đặt & build tdtu-mcp
set -e
cd "$(dirname "$0")"
npm install
npm run build
echo "OK. Thử: TDTU_MSSV=... TDTU_PASSWORD=... node dist/index.js"
