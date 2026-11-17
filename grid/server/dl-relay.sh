#!/usr/bin/env bash
# 安装包中转：给调度中心一把「只能往安装包文件夹里写」的密钥，它就会把 GitHub 上的新版本搬到国内存储（见 server/dlrelay.js）
#   sudo bash /opt/laolao/grid/server/dl-relay.sh
# 密钥在这里输入（屏幕上不显示），写进 /etc/laolao-grid.env（只有 root 能看）。不要截图、不要发给任何人。
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo "要用 sudo 运行"; exit 1; fi
ENVF=/etc/laolao-grid.env
DATA=/var/lib/laolao-grid
PORT="${PORT:-8787}"
# 只看进度（不改密钥）：sudo bash dl-relay.sh --watch
if [ "${1:-}" != "--watch" ]; then
echo "安装包中转要一把「只能写」安装包文件夹的密钥（腾讯云 访问管理 → 新建子用户 laolao-relay，按说明贴自定义策略）。"
read -r -p "SecretId：" KID; read -r -s -p "SecretKey（输入时不显示）：" KSEC; echo
if [ -z "$KID" ] || [ -z "$KSEC" ]; then echo "没输入，什么都没改"; exit 1; fi
touch "$ENVF"; chmod 600 "$ENVF"
sed -i '/^DLW_COS_/d' "$ENVF"
printf '\n# 安装包中转用的写入密钥（只能往安装包文件夹里写）\nDLW_COS_KEY_ID=%s\nDLW_COS_SECRET=%s\n' "$KID" "$KSEC" >> "$ENVF"
unset KSEC
systemctl restart laolao-grid; sleep 3
echo "密钥存好了，调度中心重启了。"
fi
TOKEN=$(tail -1 "$DATA/admin.txt" 2>/dev/null || true)
API="http://127.0.0.1:$PORT/api/admin/dl"
echo "去 GitHub 看一眼有没有要搬的，下面每 3 秒刷新一次进度（按 Ctrl+C 只是不看了，后台照样搬）："
# 调度中心刚重启时要几秒才起来：等它能回话再开始（最多 60 秒）
for i in $(seq 1 30); do
  curl -sf --max-time 10 -X POST -H "authorization: Bearer $TOKEN" "$API/relay?wait=0" >/dev/null && break
  [ "$i" = 1 ] && echo "等调度中心起来…"; sleep 2
done
sleep 2
while :; do
  OUT=$(curl -s --max-time 10 -H "authorization: Bearer $TOKEN" "$API?days=1" || true)
  LINE=$(printf '%s' "$OUT" | node -e '
let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{let j;try{j=JSON.parse(s).relay}catch(e){console.log("… 调度中心没回话，再等等："+s.slice(0,120));console.log("@noreply");return}
 if(!j){console.log("!! 调度中心还是旧版本：先 cd /opt/laolao && sudo git pull && sudo systemctl restart laolao-grid");console.log("@done");return}
 if(!j.canWrite)console.log("!! 写入密钥没生效：看看 /etc/laolao-grid.env 里 DLW_COS_* 有没有写上");
 const T={ok:"✓ 已经在国内存储",missing:"… 排队",copying:"→ 正在搬",failed:"✗ 没搬成","?":"? 问不到存储"};
 const mb=(n)=>Math.round((n||0)/1048576);
 for(const f of j.files||[]){let x=`${T[f.state]||f.state}  ${f.key}`;
  if(f.state==="copying"){const w=30,k=Math.round((f.pct||0)/100*w);x+=`
     ${f.phase}${f.via&&f.phase!=="从 GitHub 下载"?"（"+f.via+"）":""}  [${"#".repeat(k)}${"-".repeat(w-k)}] ${f.pct||0}%  ${mb(f.got)}/${mb(f.size)}MB  ${(f.speed||0)>=1048576?((f.speed)/1048576).toFixed(1)+"MB/s":Math.round((f.speed||0)/1024)+"KB/s"}`+(f.speed>0?`  还要约 ${Math.ceil((f.size-f.got)/f.speed/60)} 分钟`:"");}
  else if(f.why)x+=`（${f.why}）`; console.log(x);}
 if(!(j.files||[]).length&&!j.running&&j.lastRun)console.log("!! 一个版本文件都没读到：这台服务器连不上 GitHub？");
 if(!(j.files||[]).length&&(j.running||!j.lastRun)){console.log("… 正在看 GitHub 上的版本文件");return;}
 if(!j.running&&!(j.files||[]).some((f)=>f.state==="copying"))console.log("@done");});')
  clear 2>/dev/null || true
  date "+%H:%M:%S"
  # 不用管道判断（set -o pipefail 下 grep -q 提前退出会让判断失灵，进度一直刷不停）
  L="${LINE//@done/}"; printf '%s\n' "${L//@noreply/}"
  case "$LINE" in *@done*) break;; esac
  case "$LINE" in *@noreply*) NR=$((${NR:-0} + 1)); if [ "$NR" -ge 20 ]; then echo "!! 调度中心一分钟都没回话：sudo systemctl status laolao-grid 看看"; break; fi;; *) NR=0;; esac
  sleep 3
done
echo
echo "这一轮看完了。以后每 10 分钟自动看一次；有新版本会自己搬。想再看进度：sudo bash /opt/laolao/grid/server/dl-relay.sh --watch"
