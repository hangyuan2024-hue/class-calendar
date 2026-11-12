#!/usr/bin/env bash
# 更新调度中心：从 GitHub 拿最新的代码，重启（大约 1 秒）。
#   sudo bash /opt/laolao/grid/server/update.sh            现在更新一次
#   sudo AUTO=1 bash /opt/laolao/grid/server/update.sh     以后每天凌晨 4 点自动更新（有新代码才重启）
# 不打断大家：任务、租约、存档都在 SQLite 里，重启后原样接着；各台电脑连不上的那 1 秒会自动重试，
# 正在算的任务有 2 分钟的租约，不会被当成掉线。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OLD=$(git rev-parse HEAD)
git fetch --depth 1 origin main -q
NEW=$(git rev-parse FETCH_HEAD)
if [ "$OLD" = "$NEW" ]; then echo "已经是最新的了（${OLD:0:7}）"; else
  git reset --hard -q FETCH_HEAD
  # 先检查新代码能不能启动，不行就退回去，不重启
  if ! NODE_NO_WARNINGS=1 node -e 'require("./grid/server/core");require("./grid/server/store")'; then
    echo "!! 新代码有问题，退回 ${OLD:0:7}，没重启"; git reset --hard -q "$OLD"; exit 1
  fi
  systemctl restart laolao-grid
  sleep 2
  if systemctl is-active --quiet laolao-grid; then echo "更新好了：${OLD:0:7} → ${NEW:0:7}"
  else echo "!! 新版本起不来，退回 ${OLD:0:7}"; git reset --hard -q "$OLD"; systemctl restart laolao-grid; exit 1; fi
fi
if [ "${AUTO:-}" = "1" ]; then
  cat > /etc/systemd/system/laolao-grid-update.service <<EOT
[Unit]
Description=捞捞算力 · 调度中心自动更新
[Service]
Type=oneshot
ExecStart=/bin/bash $ROOT/grid/server/update.sh
EOT
  cat > /etc/systemd/system/laolao-grid-update.timer <<EOT
[Unit]
Description=捞捞算力 · 每天凌晨 4 点看看有没有新版
[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
EOT
  systemctl daemon-reload && systemctl enable --now laolao-grid-update.timer
  echo "以后每天凌晨 4 点自动更新"
fi
