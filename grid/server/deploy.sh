#!/usr/bin/env bash
# 在云服务器（腾讯云轻量 / CVM，Ubuntu、Debian、TencentOS、CentOS 都行）上装好「捞捞算力 · 调度中心」，开机自动启动。
#   sudo bash grid/server/deploy.sh                       用 http://服务器IP:8787
#   sudo DOMAIN=grid.你的域名.cn bash grid/server/deploy.sh   有域名：自动配 HTTPS（Caddy，证书自动申请）
# 大文件放腾讯云 COS（推荐，省服务器带宽）：把密钥写进 /etc/laolao-grid.env（见下面的模板），再 sudo systemctl restart laolao-grid
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA=/var/lib/laolao-grid
PORT="${PORT:-8787}"
NODE_VER=v22.22.0   # 要 22.13 以上：内置的 SQLite（node:sqlite）从 22.13 起不用加开关

if [ "$(id -u)" != 0 ]; then echo "要用 sudo 运行"; exit 1; fi

# 1. Node.js 22（从国内镜像下）
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "装 Node.js $NODE_VER …"
  ARCH=$(uname -m); case "$ARCH" in x86_64) A=x64;; aarch64) A=arm64;; *) echo "不支持的 CPU：$ARCH"; exit 1;; esac
  cd /tmp
  curl -fL "https://registry.npmmirror.com/-/binary/node/$NODE_VER/node-$NODE_VER-linux-$A.tar.xz" -o node.tar.xz \
    || curl -fL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$A.tar.xz" -o node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf node.tar.xz -C /opt/node --strip-components=1 && rm node.tar.xz
  ln -sf /opt/node/bin/node /usr/local/bin/node
fi
echo "Node.js $(node -v)"

# 2. 专门的用户和数据文件夹
id lgrid >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin lgrid
mkdir -p "$DATA" && chown -R lgrid:lgrid "$DATA"
chmod o+rx "$ROOT" "$ROOT/.." 2>/dev/null || true
if [ ! -f /etc/laolao-grid.env ]; then
  cat > /etc/laolao-grid.env <<'EOF'
# 大文件放腾讯云 COS（推荐）：填好这几项，sudo systemctl restart laolao-grid。不填就存在服务器硬盘上（/var/lib/laolao-grid/blobs）
# 建议单独建一个只能读写这个桶的子账号；桶里放在 grid/ 前缀下，和安装包、AI 组件分开
#GRID_COS_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
#GRID_COS_REGION=ap-guangzhou
#GRID_COS_BUCKET=你的桶名-1250000000
#GRID_COS_KEY_ID=
#GRID_COS_SECRET=
#GRID_COS_PREFIX=grid
EOF
  chmod 600 /etc/laolao-grid.env
fi

PUBLIC="http://$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'):$PORT"
HOST=0.0.0.0
if [ -n "${DOMAIN:-}" ]; then PUBLIC="https://$DOMAIN"; HOST=127.0.0.1; fi

# 3. 开机自动启动
cat > /etc/systemd/system/laolao-grid.service <<EOF
[Unit]
Description=捞捞算力 · 调度中心
After=network-online.target
Wants=network-online.target

[Service]
User=lgrid
EnvironmentFile=/etc/laolao-grid.env
ExecStart=/usr/local/bin/node $ROOT/server/index.js --data $DATA --port $PORT --host $HOST --public $PUBLIC
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now laolao-grid
sleep 2
systemctl --no-pager --lines=5 status laolao-grid || true

# 4. 有域名：Caddy 自动 HTTPS
if [ -n "${DOMAIN:-}" ]; then
  if ! command -v caddy >/dev/null; then
    echo "装 Caddy（自动申请 HTTPS 证书）…"
    if command -v apt-get >/dev/null; then apt-get update -y && apt-get install -y caddy || true; fi
    if ! command -v caddy >/dev/null && command -v dnf >/dev/null; then dnf install -y caddy || true; fi
    if ! command -v caddy >/dev/null && command -v yum >/dev/null; then yum install -y caddy || true; fi
  fi
  if command -v caddy >/dev/null; then
    printf '%s {\n  reverse_proxy 127.0.0.1:%s\n  request_body {\n    max_size 40GB\n  }\n}\n' "$DOMAIN" "$PORT" > /etc/caddy/Caddyfile
    systemctl enable --now caddy && systemctl reload caddy
  else
    echo "!! 没装上 Caddy：先用 http://IP:$PORT，或者手动装 Caddy / Nginx 做 HTTPS"
  fi
fi

echo
echo "========================================================"
echo "调度中心装好了：$PUBLIC"
echo "控制中心：$PUBLIC/admin/"
echo "管理员口令（只给自己，别发给别人）："
cat "$DATA/admin.txt" | tail -1
echo
echo "记得在腾讯云控制台 → 防火墙 放行端口：${DOMAIN:+80 和 443}${DOMAIN:-$PORT}"
echo "然后在你自己的电脑上：node grid/tools/grid.js login $PUBLIC <管理员口令>"
echo "========================================================"
