#!/usr/bin/env bash
# 给「下载门口」配 HTTPS 域名（软件只认 https 的下载地址，网页上的下载按钮也要 https）
#   1. 先在域名解析（DNSPod）加一条：主机记录 dl，类型 A，记录值 = 这台服务器的公网 IP
#   2. 腾讯云控制台 → 这台服务器 → 防火墙：放行 80 和 443
#   3. sudo bash /opt/laolao/grid/server/dl-https.sh            （默认域名 dl.laolaokechengbiao.cn）
#      sudo DL_DOMAIN=别的域名 bash /opt/laolao/grid/server/dl-https.sh
# 只把 https://域名/dl/… 转给调度中心，别的路径一律 404（控制中心、接口还是原来的 http://IP:8787，不受影响）。
set -euo pipefail
DOMAIN="${DL_DOMAIN:-dl.laolaokechengbiao.cn}"
PORT="${PORT:-8787}"
if [ "$(id -u)" != 0 ]; then echo "要用 sudo 运行"; exit 1; fi

# 1. 域名是不是已经指到这台服务器了
ME=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
DNS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -z "$DNS" ]; then echo "!! $DOMAIN 还解析不到：先去 DNSPod 加 A 记录（dl → $ME），等几分钟再跑"; exit 1; fi
if [ -n "$ME" ] && [ "$DNS" != "$ME" ]; then echo "!! $DOMAIN 解析到的是 $DNS，不是这台服务器（$ME）：改一下 A 记录再跑"; exit 1; fi

# 2. 装 Caddy（自动申请、续期 HTTPS 证书）
if ! command -v caddy >/dev/null; then
  echo "装 Caddy …"
  if command -v apt-get >/dev/null; then apt-get update -y -q && apt-get install -y -q caddy || true; fi
  if ! command -v caddy >/dev/null && command -v dnf >/dev/null; then dnf install -y caddy || true; fi
  if ! command -v caddy >/dev/null && command -v yum >/dev/null; then yum install -y caddy || true; fi
  if ! command -v caddy >/dev/null; then
    # 系统里没有：直接下官方的程序（这台服务器在香港，能连 GitHub）
    ARCH=$(uname -m); case "$ARCH" in x86_64) A=amd64;; aarch64) A=arm64;; *) echo "不支持的 CPU：$ARCH"; exit 1;; esac
    cd /tmp && curl -fL "https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_${A}.tar.gz" -o caddy.tgz
    tar -xzf caddy.tgz caddy && install -m 755 caddy /usr/local/bin/caddy && rm -f caddy caddy.tgz
    id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
    mkdir -p /etc/caddy
    cat > /etc/systemd/system/caddy.service <<EOT
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOT
    systemctl daemon-reload
  fi
fi
command -v caddy >/dev/null || { echo "!! Caddy 没装上"; exit 1; }

# 3. 配置：单独一个文件，原来的 Caddyfile（如果有）不动，只加一行 import
mkdir -p /etc/caddy
cat > /etc/caddy/laolao-dl.caddy <<EOT
$DOMAIN {
	handle /dl/* {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle {
		respond "捞捞下载" 404
	}
}
EOT
touch /etc/caddy/Caddyfile
grep -q "laolao-dl.caddy" /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/laolao-dl.caddy\n' >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy
sleep 5

# 4. 读安装包的密钥（只读的子账号）：没填过就在这里问，输入的时候屏幕上不显示，写进 /etc/laolao-grid.env（只有 root 能看）
ENVF=/etc/laolao-grid.env
if ! grep -q "^DL_COS_KEY_ID=." "$ENVF" 2>/dev/null; then
  echo
  echo "下载门口要一把「只能读」安装包桶的密钥（腾讯云 访问管理 → 用户 → 新建子用户，只给这个桶的 GetObject / HeadObject 权限）。"
  echo "不要截图、不要发给任何人，只在这里输入："
  read -r -p "SecretId：" KID; read -r -s -p "SecretKey（输入时不显示）：" KSEC; echo
  read -r -p "存储桶名字（直接回车 = laolao-1518432293）：" BKT; BKT="${BKT:-laolao-1518432293}"
  read -r -p "地域（直接回车 = ap-guangzhou）：" RGN; RGN="${RGN:-ap-guangzhou}"
  if [ -n "$KID" ] && [ -n "$KSEC" ]; then
    touch "$ENVF"; chmod 600 "$ENVF"
    sed -i '/^DL_COS_/d' "$ENVF"
    printf '\n# 下载门口（安装包、AI 组件）用的只读密钥\nDL_COS_ENDPOINT=https://cos.%s.myqcloud.com\nDL_COS_REGION=%s\nDL_COS_BUCKET=%s\nDL_COS_KEY_ID=%s\nDL_COS_SECRET=%s\n' "$RGN" "$RGN" "$BKT" "$KID" "$KSEC" >> "$ENVF"
    unset KSEC
    systemctl restart laolao-grid; sleep 2; echo "密钥存好了，调度中心重启了"
  else echo "没输入，跳过（以后再跑一次这个脚本就会再问）"; fi
fi

# 5. 试一下
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/dl/ai/__test__" || true)
echo
if [ "$CODE" = "404" ] || [ "$CODE" = "403" ] || [ "$CODE" = "503" ]; then
  echo "好了：https://$DOMAIN/dl/… 通了（试的是一个不存在的文件，回的是 $CODE，正常）"
  [ "$CODE" = "503" ] && echo "还差一步：/etc/laolao-grid.env 里填 DL_COS_*（只读的子账号密钥），然后 sudo systemctl restart laolao-grid"
else
  echo "!! https://$DOMAIN 还不通（$CODE）：看看防火墙 80 / 443 放行了没有；证书第一次申请要一两分钟，稍等再试：curl -I https://$DOMAIN/dl/ai/x"
fi
