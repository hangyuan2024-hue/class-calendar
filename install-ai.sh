#!/bin/bash
# 捞捞课程表 · 一键安装本地 AI（Mac / Linux）
# 用法：curl -fsSL <网站>/install-ai.sh | bash -s -- <网站地址> <模型名>
set -e
ORIGIN="${1:-https://hangyuan2024-hue.github.io}"
MODEL="${2:-qwen2.5:3b}"
echo "== 正在为「捞捞课程表」安装本地 AI（捞捞）=="

if [ "$(uname)" = "Darwin" ]; then
  if [ ! -d /Applications/Ollama.app ]; then
    echo "[1/3] 下载并安装 Ollama ..."
    curl -fL --progress-bar -o /tmp/Ollama.zip https://ollama.com/download/Ollama-darwin.zip
    unzip -oq /tmp/Ollama.zip -d /Applications
  else
    echo "[1/3] 已经装过 Ollama，跳过"
  fi
  echo "[2/3] 允许网站访问本地 AI ..."
  launchctl setenv OLLAMA_ORIGINS "$ORIGIN"
  osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
  sleep 2
  open -a Ollama
  sleep 6
  OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
  command -v ollama >/dev/null 2>&1 && OLLAMA=ollama
else
  if ! command -v ollama >/dev/null 2>&1; then
    echo "[1/3] 下载并安装 Ollama（需要输入电脑密码）..."
    curl -fsSL https://ollama.com/install.sh | sh
  else
    echo "[1/3] 已经装过 Ollama，跳过"
  fi
  echo "[2/3] 允许网站访问本地 AI ..."
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  printf '[Service]\nEnvironment="OLLAMA_ORIGINS=%s"\n' "$ORIGIN" | sudo tee /etc/systemd/system/ollama.service.d/laolao-origins.conf >/dev/null
  sudo systemctl daemon-reload && sudo systemctl restart ollama
  sleep 3
  OLLAMA=ollama
fi

echo "[3/3] 下载中文模型 $MODEL（第一次需要几分钟）..."
"$OLLAMA" pull "$MODEL"
echo ""
echo "完成！回到网页，几秒后会自动连上。"
