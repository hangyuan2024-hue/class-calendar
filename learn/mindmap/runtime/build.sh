#!/bin/sh
# 打包网页版的 Service Worker：把 js/*.cjs（本机服务的代码）和 runtime/ 里的浏览器替身打成一个 sw.js
# 用法：在 learn/mindmap 目录运行  sh runtime/build.sh   （需要 esbuild）
cd "$(dirname "$0")/.." || exit 1
ESBUILD=${ESBUILD:-esbuild}
$ESBUILD runtime/sw-entry.js --bundle --format=iife --platform=browser --target=chrome90,safari15 \
  --alias:node:fs=./runtime/memfs.js --alias:fs=./runtime/memfs.js \
  --alias:node:path=./runtime/path.js --alias:path=./runtime/path.js \
  --alias:node:crypto=./runtime/crypto.js --alias:crypto=./runtime/crypto.js \
  --inject:./runtime/inject.js --define:__dirname='"/app/js"' \
  --legal-comments=none --outfile=sw.js
