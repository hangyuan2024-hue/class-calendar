#!/usr/bin/env bash
# 把一个大文件传到国内存储（腾讯云 COS，和安装包同一个桶、同一组 CN_S3_* 密钥），输出公开下载地址。
# 和 cn-upload.sh 的区别：给 AI 模型这种几 G 到二十几 G 的文件用 —— 不限 3 分钟、不清理同一文件夹里的别的文件、失败就报错（不悄悄跳过）。
# 用法：bash .github/workflows/cn-put.sh <本地文件> <存储里的路径>
set -uo pipefail
F="$1"; KEY="$2"
for v in CN_S3_ENDPOINT CN_S3_REGION CN_S3_BUCKET CN_S3_KEY_ID CN_S3_SECRET CN_DL_BASE; do
  eval "$v=\"\$(printf '%s' \"\${$v:-}\" | tr -d '[:space:]')\""
done
if [ -z "$CN_S3_BUCKET" ] || [ -z "$CN_S3_KEY_ID" ] || [ -z "$CN_S3_SECRET" ] || [ -z "$CN_S3_ENDPOINT" ] || [ -z "$CN_DL_BASE" ]; then
  echo "::error::没配国内存储（Settings → Secrets 里的 CN_S3_ENDPOINT、CN_S3_REGION、CN_S3_BUCKET、CN_S3_KEY_ID、CN_S3_SECRET、CN_DL_BASE）" >&2; exit 2
fi
export AWS_ACCESS_KEY_ID="$CN_S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$CN_S3_SECRET" AWS_DEFAULT_REGION="${CN_S3_REGION:-us-east-1}" AWS_EC2_METADATA_DISABLED=true
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set default.s3.addressing_style virtual
# 分块：20G 的文件要 16MB 一块（最多 10000 块）；同时传 16 块
SIZE=$(stat -c %s "$F")
CH=$(( SIZE / 9000 / 1048576 + 1 )); [ "$CH" -lt 8 ] && CH=8
aws configure set default.s3.multipart_threshold 8MB
aws configure set default.s3.multipart_chunksize "${CH}MB"
aws configure set default.s3.max_concurrent_requests 16
EPS=()
# 全球加速：快很多，但腾讯云按流量另外收钱（几十 G 就是几十块）；CN_ACCEL=1 才用
if [ "${CN_ACCEL:-0}" = "1" ]; then case "$CN_S3_ENDPOINT" in *myqcloud.com*) EPS+=("https://cos.accelerate.myqcloud.com");; esac; fi
EPS+=("$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT")
ERR=$(mktemp); n=0
for EP in "${EPS[@]}"; do
  n=$((n + 1)); t=$(date +%s)
  echo "第 $n 次上传 $KEY（$(( SIZE / 1048576 )) MB，每块 ${CH}MB）→ $EP" >&2
  if aws s3 cp "$F" "s3://$CN_S3_BUCKET/$KEY" --endpoint-url "$EP" --content-type application/octet-stream --only-show-errors \
       --cli-connect-timeout 30 --cli-read-timeout 120 2>"$ERR"; then
    echo "上传好了：$(( $(date +%s) - t )) 秒，平均 $(( SIZE / 1048576 / ( $(date +%s) - t + 1 ) )) MB/秒" >&2
    rm -f "$ERR"; echo "${CN_DL_BASE%/}/$KEY"; exit 0
  fi
  if grep -q "BucketAccelerateNotEnabled" "$ERR"; then echo "这个桶没开「全球加速」，改走普通地址（开了会快很多：腾讯云控制台 → 存储桶 → 域名与传输管理 → 全球加速）" >&2
  else echo "失败（$(( $(date +%s) - t )) 秒）：$(tail -c 400 "$ERR" | tr '\n' ' ')" >&2; sleep 10; fi
done
rm -f "$ERR"
echo "::error::$KEY 传到国内存储失败" >&2
exit 1
