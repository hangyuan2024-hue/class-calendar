#!/usr/bin/env bash
# 训练文件放广州存储：各台电脑传的存档、训练结果直接传到腾讯云 COS（广州），下载也直接从广州下，不经过香港
# （香港到内地晚上只有十几 KB/s，几百 M 的存档要下几个小时）。以前的文件还在这台服务器上，照旧能用。
#   sudo bash /opt/laolao/grid/server/grid-cos.sh          配密钥（腾讯云 访问管理 → 子用户 laolao-grid-store，按说明贴自定义策略）
#   sudo bash /opt/laolao/grid/server/grid-cos.sh --off    不用了，新文件改回存这台服务器
# 密钥在这里输入（屏幕上不显示），写进 /etc/laolao-grid.env（只有 root 能看）。不要截图、不要发给任何人。
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo "要用 sudo 运行"; exit 1; fi
ENVF=/etc/laolao-grid.env
DATA=/var/lib/laolao-grid
PORT="${PORT:-8787}"
touch "$ENVF"; chmod 600 "$ENVF"
get() { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- || true; }

if [ "${1:-}" = "--off" ]; then
  sed -i '/^GRID_COS_/d;/^# 训练文件放广州存储/d' "$ENVF"
  systemctl restart laolao-grid
  echo "好了：新文件改回存这台服务器（已经在广州存储里的文件，这台服务器不再发它们的链接；要用的话再运行一次本脚本配上）"
  exit 0
fi

# 训练文件放单独的桶（laolao-grid-APPID），不要和安装包（DL_COS_BUCKET）放一个桶：
#   2026-11-18/19 出过事——打包后清理旧安装包时，把同一个桶 grid/ 文件夹里的训练文件全删了
DLB=$(get DL_COS_BUCKET); DLB=${DLB:-laolao-1518432293}
CUR=$(get GRID_COS_BUCKET)
if [ -n "$CUR" ] && [ "$CUR" != "$DLB" ]; then BUCKET_DEF=$CUR; else BUCKET_DEF="laolao-grid-${DLB##*-}"; fi
REGION_DEF=$(get GRID_COS_REGION); REGION_DEF=${REGION_DEF:-$(get DL_COS_REGION)}; REGION_DEF=${REGION_DEF:-ap-guangzhou}
echo "训练文件放广州存储，要一把「只能读写训练文件夹」的密钥（腾讯云 访问管理 → 子用户 laolao-grid-store，策略见 grid-store-policy.json）。"
OLD_KID=$(get GRID_COS_KEY_ID); OLD_KSEC=$(get GRID_COS_SECRET)
if [ -n "$OLD_KID" ]; then
  read -r -p "SecretId（直接回车 = 继续用现在这把 ${OLD_KID:0:6}…）：" KID
  if [ -z "$KID" ]; then KID=$OLD_KID; KSEC=$OLD_KSEC; else read -r -s -p "SecretKey（输入时不显示）：" KSEC; echo; fi
else
  read -r -p "SecretId：" KID; read -r -s -p "SecretKey（输入时不显示）：" KSEC; echo
fi
unset OLD_KSEC
if [ -z "$KID" ] || [ -z "$KSEC" ]; then echo "没输入，什么都没改"; exit 1; fi
read -r -p "存储桶名字（直接回车 = $BUCKET_DEF）：" BUCKET; BUCKET=${BUCKET:-$BUCKET_DEF}
if [ "$BUCKET" = "$DLB" ]; then
  echo "注意：$BUCKET 是放安装包的桶。训练文件和安装包放一起，以前被打包后的清理误删过，建议用单独的桶（$BUCKET_DEF）。"
  read -r -p "还是要用 $BUCKET 吗？（输入 yes 继续，直接回车 = 不改）：" Y; [ "$Y" = "yes" ] || { echo "什么都没改"; exit 1; }
fi
read -r -p "地域（直接回车 = $REGION_DEF）：" REGION; REGION=${REGION:-$REGION_DEF}
read -r -p "每天最多让大家从广州存储下多少 G（超了新文件先存这台服务器，第二天恢复；直接回车 = 20，约 10 元）：" CAP; CAP=${CAP:-20}
case "$CAP" in ''|*[!0-9]*) echo "上限要填数字"; exit 1;; esac

sed -i '/^GRID_COS_/d;/^# 训练文件放广州存储/d' "$ENVF"
printf '\n# 训练文件放广州存储（新文件放 COS、旧文件留本机；见 grid-cos.sh）\nGRID_COS_ENDPOINT=https://cos.%s.myqcloud.com\nGRID_COS_REGION=%s\nGRID_COS_BUCKET=%s\nGRID_COS_PREFIX=grid\nGRID_COS_KEY_ID=%s\nGRID_COS_SECRET=%s\nGRID_COS_DAILY_GB=%s\n' "$REGION" "$REGION" "$BUCKET" "$KID" "$KSEC" "$CAP" >> "$ENVF"
unset KSEC
systemctl restart laolao-grid
echo "密钥存好了，调度中心重启了。自检：往广州存储传一个小文件再读回来…"

TOKEN=$(tail -1 "$DATA/admin.txt" 2>/dev/null || true)
OUT=""
for i in $(seq 1 30); do
  OUT=$(curl -sf --max-time 60 -X POST -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{}' "http://127.0.0.1:$PORT/api/admin/store/test" || true)
  [ -n "$OUT" ] && break
  [ "$i" = 1 ] && echo "等调度中心起来…"; sleep 2
done
if printf '%s' "$OUT" | node -e '
let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){console.log("✗ 调度中心没回话："+s.slice(0,200));process.exit(1)}
 if(!j.ok){console.log("✗ 没通："+j.why);process.exit(1)}
 console.log("✓ 通了：新的存档、训练结果会直接传到广州存储，内地电脑下载不再经过香港");
 if(j.why)console.log("  注意："+j.why);});'; then
  exit 0
fi
# 没通：撤回，新文件照旧存这台服务器（不然各台电脑的上传都会失败）
sed -i '/^GRID_COS_/d;/^# 训练文件放广州存储/d' "$ENVF"
systemctl restart laolao-grid
echo "  已经撤回：新文件照旧存这台服务器，什么都没坏。按上面说的改好密钥 / 策略，再运行一次本脚本。"
exit 1
