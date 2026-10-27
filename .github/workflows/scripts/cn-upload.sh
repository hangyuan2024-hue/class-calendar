#!/usr/bin/env bash
# 6.9.8 国内下载加速：把安装包传到国内对象存储（腾讯云 COS / 阿里云 OSS / 火山引擎 TOS 等任何 S3 兼容存储），输出公开下载地址。
# 没配 Secrets（CN_S3_BUCKET 等）就什么也不做、输出空字符串，不影响打包。
# 用法：bash .github/scripts/cn-upload.sh <本地文件> <存储里的路径>
#   例：bash .github/scripts/cn-upload.sh desktop/dist/x.exe desktop/LaolaoKechengbiao-Setup-3.4.12.exe
# 需要的 Secrets（Settings → Secrets and variables → Actions）：
#   CN_S3_ENDPOINT  S3 接口地址：腾讯云 https://cos.ap-guangzhou.myqcloud.com；阿里云 https://oss-cn-hangzhou.aliyuncs.com；火山 https://tos-s3-cn-beijing.volces.com
#   CN_S3_REGION    地域：ap-guangzhou / oss-cn-hangzhou / cn-beijing
#   CN_S3_BUCKET    存储桶名字
#   CN_S3_KEY_ID / CN_S3_SECRET  访问密钥（建议单独建一个只能写这个桶的子账号）
#   CN_DL_BASE      公开下载地址前缀，比如 https://<桶名>.cos.ap-guangzhou.myqcloud.com（有自己的加速域名就填域名）
# 同一个前缀下只留最新的 3 个版本（捞捞编程 1 个），省存储费。
set -uo pipefail
# 捞捞编程约 1.5GB：只留最新 1 个版本（其他留 3 个）
KEEP=3; case "$2" in code/*) KEEP=1;; esac
F="$1"; KEY="$2"
if [ -z "${CN_S3_BUCKET:-}" ] || [ -z "${CN_S3_KEY_ID:-}" ] || [ -z "${CN_S3_SECRET:-}" ] || [ -z "${CN_S3_ENDPOINT:-}" ] || [ -z "${CN_DL_BASE:-}" ]; then
  echo "没配国内存储（CN_S3_*），跳过" >&2; echo ""; exit 0
fi
export AWS_ACCESS_KEY_ID="$CN_S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$CN_S3_SECRET" AWS_DEFAULT_REGION="${CN_S3_REGION:-us-east-1}" AWS_EC2_METADATA_DISABLED=true
# 新版 aws 命令默认加 CRC 校验头，国内几家的 S3 接口不认：只在必须时才加
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set default.s3.addressing_style virtual
aws configure set default.s3.multipart_chunksize 64MB
aws configure set default.s3.max_concurrent_requests 8
ok=""
for i in 1 2 3; do
  if aws s3 cp "$F" "s3://$CN_S3_BUCKET/$KEY" --endpoint-url "$CN_S3_ENDPOINT" --content-type application/octet-stream --only-show-errors >&2; then ok=1; break; fi
  echo "上传失败，10 秒后重试（第 $i 次）" >&2; sleep 10
done
if [ -z "$ok" ]; then echo "::warning::上传到国内存储失败，这次只能从 GitHub 下载" >&2; echo ""; exit 0; fi
# 清理：同一个文件夹里按时间只留最新 3 个
DIR="${KEY%/*}/"
aws s3api list-objects-v2 --bucket "$CN_S3_BUCKET" --prefix "$DIR" --endpoint-url "$CN_S3_ENDPOINT" --query 'sort_by(Contents,&LastModified)[].Key' --output text 2>/dev/null \
  | tr '\t' '\n' | grep -v '^None$' | head -n -"$KEEP" | while read -r old; do
    [ -n "$old" ] && [ "$old" != "$KEY" ] && aws s3 rm "s3://$CN_S3_BUCKET/$old" --endpoint-url "$CN_S3_ENDPOINT" --only-show-errors >&2
  done
echo "${CN_DL_BASE%/}/$KEY"
