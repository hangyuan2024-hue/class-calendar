#!/usr/bin/env bash
# 国内存储里旧版安装包的清理：同一种安装包只留最新 KEEP 个。只删「名字和这次传的一模一样、只是版本号不同」的文件。
#   用法：bash .github/workflows/cn-clean.sh <这次传的路径> <留几个>（环境变量 CN_S3_BUCKET、CN_S3_ENDPOINT 和 aws 的密钥由调用方设好）
#   例：grid/LaolaoGrid-Setup-0.1.76.exe 留 3 → 只看 grid/LaolaoGrid-Setup-<版本号>.exe，按时间留最新 3 个
#   2026-11-19 出过事：以前按「同一个文件夹」清理，grid/ 文件夹里还有捞捞算力的训练文件（grid/jobs/…、grid/logs/…），
#   每次打包都只留 grid/ 下最新的 3 个文件、把训练的存档和数据全删了（登记了却 404、训练卡死）。
set -uo pipefail
KEY="$1"; KEEP="${2:-3}"
DIR="${KEY%/*}/"; [ "$DIR" = "$KEY/" ] && DIR=""
BASE="${KEY##*/}"; EXT=".${BASE##*.}"
# 名字里版本号前面那一截（LaolaoGrid-Setup-、class-calendar-）：认不出版本号就不清理
STEM=$(printf '%s' "$BASE" | sed -E 's/[0-9][0-9A-Za-z.]*(\.[A-Za-z0-9]+)$//')
if [ -z "$STEM" ] || [ "$STEM" = "$BASE" ] || [ "$EXT" = ".$BASE" ]; then echo "清理旧版：认不出「$BASE」里的版本号，不清理" >&2; exit 0; fi
PFX="$DIR$STEM"
aws s3api list-objects-v2 --bucket "$CN_S3_BUCKET" --prefix "$PFX" --endpoint-url "$CN_S3_ENDPOINT" --query 'sort_by(Contents,&LastModified)[].Key' --output text 2>/dev/null \
  | tr '\t' '\n' | grep -v '^None$' \
  | while read -r k; do
      mid="${k#"$PFX"}"; mid="${mid%"$EXT"}"
      # 只要「前缀 + 版本号 + 扩展名」，版本号里不能有 /（别的文件夹里的东西一律不碰）
      if [ "$k" = "$PFX$mid$EXT" ] && [[ "$mid" =~ ^[0-9][0-9A-Za-z.]*$ ]]; then echo "$k"; fi
    done \
  | head -n -"$KEEP" \
  | while read -r old; do
      [ -n "$old" ] && [ "$old" != "$KEY" ] && { echo "删旧版：$old" >&2; aws s3 rm "s3://$CN_S3_BUCKET/$old" --endpoint-url "$CN_S3_ENDPOINT" --only-show-errors >&2; }
    done
exit 0
