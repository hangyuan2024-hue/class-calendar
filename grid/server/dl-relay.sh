#!/usr/bin/env bash
# 安装包中转：给调度中心一把「只能往安装包文件夹里写」的密钥，它就会把 GitHub 上的新版本搬到国内存储（见 server/dlrelay.js）
#   sudo bash /opt/laolao/grid/server/dl-relay.sh
# 密钥在这里输入（屏幕上不显示），写进 /etc/laolao-grid.env（只有 root 能看）。不要截图、不要发给任何人。
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo "要用 sudo 运行"; exit 1; fi
ENVF=/etc/laolao-grid.env
DATA=/var/lib/laolao-grid
PORT="${PORT:-8787}"
echo "安装包中转要一把「只能写」安装包文件夹的密钥（腾讯云 访问管理 → 新建子用户 laolao-relay，按说明贴自定义策略）。"
read -r -p "SecretId：" KID; read -r -s -p "SecretKey（输入时不显示）：" KSEC; echo
if [ -z "$KID" ] || [ -z "$KSEC" ]; then echo "没输入，什么都没改"; exit 1; fi
touch "$ENVF"; chmod 600 "$ENVF"
sed -i '/^DLW_COS_/d' "$ENVF"
printf '\n# 安装包中转用的写入密钥（只能往安装包文件夹里写）\nDLW_COS_KEY_ID=%s\nDLW_COS_SECRET=%s\n' "$KID" "$KSEC" >> "$ENVF"
unset KSEC
systemctl restart laolao-grid; sleep 3
TOKEN=$(tail -1 "$DATA/admin.txt" 2>/dev/null || true)
echo "密钥存好了，调度中心重启了。现在去 GitHub 看一眼有没有要搬的（大文件要几分钟，搬完才会回来）…"
OUT=$(curl -s --max-time 1800 -X POST -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/admin/dl/relay" || true)
echo "$OUT" | node -e '
let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){console.log("!! 没拿到结果："+s.slice(0,300));return}
 if(!j.canWrite){console.log("!! 写入密钥没生效：看看 /etc/laolao-grid.env 里 DLW_COS_* 有没有写上");}
 const T={ok:"已经在国内存储",missing:"存储里没有",copying:"正在搬",failed:"没搬成","?":"不知道"};
 for(const f of j.files||[])console.log(`${T[f.state]||f.state}  ${f.key}${f.why?"（"+f.why+"）":""}`);
 if(!(j.files||[]).length)console.log("!! 一个版本文件都没读到：这台服务器连不上 GitHub？");});'
echo
echo "以后每 10 分钟自动看一次；有新版本会自己搬。搬的记录在控制中心「动态」里。"
