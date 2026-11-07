#!/usr/bin/env bash
# 6.9.8 国内下载加速：把安装包传到国内对象存储（腾讯云 COS / 阿里云 OSS / 火山引擎 TOS 等任何 S3 兼容存储），输出公开下载地址。
# 没配 Secrets（CN_S3_BUCKET 等）就什么也不做、输出空字符串，不影响打包。
# 用法：bash .github/workflows/cn-upload.sh <本地文件> <存储里的路径>
#   例：bash .github/workflows/cn-upload.sh desktop/dist/x.exe desktop/LaolaoKechengbiao-Setup-3.4.12.exe
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
# 复制粘贴密钥时常带上空格、换行：全部去掉
for v in CN_S3_ENDPOINT CN_S3_REGION CN_S3_BUCKET CN_S3_KEY_ID CN_S3_SECRET CN_DL_BASE CN_SITE_BUCKET; do
  eval "$v=\"\$(printf '%s' \"\${$v:-}\" | tr -d '[:space:]')\""
done
if [ -z "${CN_S3_BUCKET:-}" ] || [ -z "${CN_S3_KEY_ID:-}" ] || [ -z "${CN_S3_SECRET:-}" ] || [ -z "${CN_S3_ENDPOINT:-}" ] || [ -z "${CN_DL_BASE:-}" ]; then
  echo "没配国内存储（CN_S3_*），跳过" >&2; echo ""; exit 0
fi
export AWS_ACCESS_KEY_ID="$CN_S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$CN_S3_SECRET" AWS_DEFAULT_REGION="${CN_S3_REGION:-us-east-1}" AWS_EC2_METADATA_DISABLED=true
# 新版 aws 命令默认加 CRC 校验头，国内几家的 S3 接口不认：只在必须时才加
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set default.s3.addressing_style virtual
# 从 GitHub（在美国）传到国内很慢、延迟高：切成 5MB 的小块（S3 允许的最小块）同时传，比整个文件一次传快，也不容易被嫌慢断开
aws configure set default.s3.multipart_threshold 5MB
aws configure set default.s3.multipart_chunksize 5MB
aws configure set default.s3.max_concurrent_requests 24
ok=""
T0=$(date +%s)
echo "开始传到国内存储：$KEY（$(( $(wc -c < "$F") / 1048576 )) MB）" >&2
# 7.x 从 GitHub（美国）直接传到广州经常特别慢：腾讯云嫌太慢会断开（UserNetworkTooSlow），或者 3 分钟都传不完。
# 腾讯云的桶开了「全球加速」时，走 cos.accelerate.myqcloud.com：先进腾讯云在海外的节点，再走腾讯内网到广州，又快又稳。
# 所以顺序是：① 全球加速（没开会 1 秒内报 BucketAccelerateNotEnabled，直接跳过）② ③ 普通地址，每次最多等 3 分钟。
# 3 次都不行就跳过国内存储，照常发布（App 和官网会从网站 download/、jsDelivr、GitHub 下载）。
EPS=()
case "$CN_S3_ENDPOINT" in *myqcloud.com*) EPS+=("https://cos.accelerate.myqcloud.com");; esac
EPS+=("$CN_S3_ENDPOINT" "$CN_S3_ENDPOINT")
ERR=$(mktemp)
n=0
for EP in "${EPS[@]}"; do
  n=$((n + 1)); t=$(date +%s)
  timeout 180 aws s3 cp "$F" "s3://$CN_S3_BUCKET/$KEY" --endpoint-url "$EP" --content-type application/octet-stream --only-show-errors \
       --cli-connect-timeout 20 --cli-read-timeout 60 2>"$ERR"
  rc=$?
  if [ $rc -eq 0 ]; then ok=1; echo "第 $n 次：上传成功（$EP，$(( $(date +%s) - t )) 秒）" >&2; break; fi
  if [ $rc -eq 124 ]; then why="3 分钟没传完：从 GitHub 的美国服务器到国内网络太慢"
  elif grep -q "BucketAccelerateNotEnabled" "$ERR"; then why="这个桶没开「全球加速」（腾讯云控制台 → 存储桶 → 域名与传输管理 → 全球加速，开了以后这一步就能用）"
  elif grep -q "UserNetworkTooSlow" "$ERR"; then why="腾讯云嫌上传太慢断开了（UserNetworkTooSlow）：美国到国内网络太慢"
  elif grep -qi "AccessDenied\|SignatureDoesNotMatch\|InvalidAccessKeyId" "$ERR"; then why="密钥不对或没有权限：检查 CN_S3_KEY_ID / CN_S3_SECRET"
  else why="$(tail -c 300 "$ERR" | tr '\n' ' ')"; fi
  echo "第 $n 次失败（$EP，$(( $(date +%s) - t )) 秒）：$why" >&2
  [ $n -lt ${#EPS[@]} ] && sleep 5
done
rm -f "$ERR"
echo "用了 $(( $(date +%s) - T0 )) 秒" >&2
if [ -z "$ok" ]; then echo "::warning::上传到国内存储失败（原因见上面几行），这次 App 更新会改从网站 download/ 或 GitHub 下载" >&2; echo ""; exit 0; fi
# 清理：同一个文件夹里按时间只留最新 3 个
DIR="${KEY%/*}/"
aws s3api list-objects-v2 --bucket "$CN_S3_BUCKET" --prefix "$DIR" --endpoint-url "$CN_S3_ENDPOINT" --query 'sort_by(Contents,&LastModified)[].Key' --output text 2>/dev/null \
  | tr '\t' '\n' | grep -v '^None$' | head -n -"$KEEP" | while read -r old; do
    [ -n "$old" ] && [ "$old" != "$KEY" ] && aws s3 rm "s3://$CN_S3_BUCKET/$old" --endpoint-url "$CN_S3_ENDPOINT" --only-show-errors >&2
  done
echo "${CN_DL_BASE%/}/$KEY"
