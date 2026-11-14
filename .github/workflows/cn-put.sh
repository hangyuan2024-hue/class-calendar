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
# 一块一块传、失败的块单独重传、能接着上次传（cn-put.py）；同时 4 块（连接太多每个都慢，腾讯云会掐掉太慢的：UserNetworkTooSlow）
python3 -c "import boto3" 2>/dev/null || pip install -q boto3 >&2 || pip install -q --break-system-packages boto3 >&2
EPS=()
# 全球加速：快很多，但腾讯云按流量另外收钱（几十 G 就是几十块）；CN_ACCEL=1 才用
if [ "${CN_ACCEL:-0}" = "1" ]; then case "$CN_S3_ENDPOINT" in *myqcloud.com*) EPS+=("https://cos.accelerate.myqcloud.com");; esac; fi
EPS+=("$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT")
HERE="$(cd "$(dirname "$0")" && pwd)"
n=0
for EP in "${EPS[@]}"; do
  n=$((n + 1))
  echo "第 $n 次上传 $KEY → $EP" >&2
  python3 "$HERE/cn-put.py" "$F" "$KEY" "$EP"; rc=$?
  if [ "$rc" = 0 ]; then echo "${CN_DL_BASE%/}/$KEY"; exit 0; fi
  if [ "$rc" = 3 ]; then echo "这个桶没开「全球加速」，改走普通地址" >&2; continue; fi
  echo "这次没传完，等 20 秒接着传（传好的块不重传）" >&2; sleep 20
done
echo "::error::$KEY 传到国内存储失败" >&2
exit 1
