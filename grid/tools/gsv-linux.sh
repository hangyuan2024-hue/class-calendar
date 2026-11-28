#!/usr/bin/env bash
# 捞捞算力 · 在租来的 Linux 显卡上装 GPT-SoVITS（训练捞捞的声音用；Windows 上用整合包，不用这个）
#   用法：bash tools/gsv-linux.sh [装到哪，默认 /root/autodl-tmp/GPT-SoVITS]
#   装好以后：node tools/worker.js run --gsv /root/autodl-tmp/GPT-SoVITS --hours 2
#   全程走国内源：代码 GitHub（AutoDL 先开学术加速）/ gitclone 镜像，Python 包清华源，预训练模型 hf-mirror，多音字模型 ModelScope
set -euo pipefail
DIR="${1:-/root/autodl-tmp/GPT-SoVITS}"
PY="${PYTHON:-python3}"
PIP_IDX="https://pypi.tuna.tsinghua.edu.cn/simple"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
say() { echo "$(date +%H:%M:%S) $*"; }

# AutoDL 的学术加速（能连 GitHub / Hugging Face）；别的平台没有就跳过
[ -f /etc/network_turbo ] && source /etc/network_turbo || true

say "1/5 ffmpeg"
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg libsox-dev >/dev/null)

say "2/5 GPT-SoVITS 代码 → $DIR"
if [ ! -f "$DIR/api_v2.py" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$DIR" \
    || git clone --depth 1 https://gitclone.com/github.com/RVC-Boss/GPT-SoVITS.git "$DIR" \
    || git clone --depth 1 https://ghfast.top/https://github.com/RVC-Boss/GPT-SoVITS.git "$DIR"
fi
cd "$DIR"

say "3/5 Python 包（清华源；镜像里自带的 PyTorch 不动）"
# 镜像自带的 PyTorch 锁死（别的包会顺手把它升到最新版，CUDA 对不上、torchaudio 也跟着坏）；torchaudio 装同一版
TV=$("$PY" -c "import torch;print(torch.__version__.split('+')[0])")
CU=$("$PY" -c "import torch;print('cu'+torch.version.cuda.replace('.','') if torch.version.cuda else 'cpu')")
echo "torch==$TV" > /tmp/gsv-pin.txt
"$PY" -c "import torchvision" 2>/dev/null && echo "torchvision==$("$PY" -c "import torchvision;print(torchvision.__version__.split('+')[0])")" >> /tmp/gsv-pin.txt || true
if ! "$PY" -c "import torchaudio" 2>/dev/null; then
  "$PY" -m pip install -q "torchaudio==$TV" -f "https://mirrors.aliyun.com/pytorch-wheels/$CU/" -c /tmp/gsv-pin.txt \
    || "$PY" -m pip install -q "torchaudio==$TV" --index-url "https://download.pytorch.org/whl/$CU" -c /tmp/gsv-pin.txt
fi
echo "torchaudio==$("$PY" -c "import torchaudio;print(torchaudio.__version__.split('+')[0])")" >> /tmp/gsv-pin.txt
grep -viE '^(torch|torchaudio|torchvision)([<>=! ].*)?$' requirements.txt > /tmp/gsv-req.txt
"$PY" -m pip install -q -i "$PIP_IDX" -r /tmp/gsv-req.txt -c /tmp/gsv-pin.txt
[ -f extra-req.txt ] && "$PY" -m pip install -q -i "$PIP_IDX" -r extra-req.txt --no-deps || true
# GPT-SoVITS 要 numpy 1.x；镜像里的 scipy 可能是只配 numpy 2 的新版（一导入就「All ufuncs must have type numpy.ufunc」）：换成配套的
if "$PY" -c "import numpy,sys;sys.exit(0 if numpy.__version__.startswith('1.') else 1)" 2>/dev/null && ! "$PY" -c "import scipy.special" 2>/dev/null; then
  "$PY" -m pip install -q -i "$PIP_IDX" "scipy==1.13.1" "numpy==$("$PY" -c "import numpy;print(numpy.__version__)")"
fi
"$PY" -c "import numpy, scipy.special, librosa; print('numpy', numpy.__version__, 'scipy', __import__('scipy').__version__)" || echo "！numpy / scipy 还是不对：把上面几行截图发给维护的人"
# 念句子（api_v2）还要这几个，requirements.txt 里没列全（缺了 /tts 直接 400：No module named 'resampy'）
"$PY" -m pip install -q -i "$PIP_IDX" huggingface_hub modelscope resampy -c /tmp/gsv-pin.txt

say "4/5 预训练模型（hf-mirror：lj1995/GPT-SoVITS，只下训练要用的）"
"$PY" - <<'EOF'
import os
from huggingface_hub import snapshot_download
dst = os.path.join("GPT_SoVITS", "pretrained_models")
snapshot_download("lj1995/GPT-SoVITS", local_dir=dst, max_workers=8, allow_patterns=[
    "chinese-roberta-wwm-ext-large/*", "chinese-hubert-base/*", "gsv-v2final-pretrained/*",
    "v2Pro/s2Gv2Pro.pth", "v2Pro/s2Dv2Pro.pth", "sv/*", "s1v3.ckpt", "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"])
print("预训练模型：", sorted(os.listdir(dst)))
EOF

mkdir -p GPT_SoVITS/pretrained_models/fast_langdetect   # 念句子分中英文用；文件夹不在直接报错
say "5/5 多音字模型（G2PW）"
G2="GPT_SoVITS/text/G2PWModel"
if [ ! -d "$G2" ]; then
  cd GPT_SoVITS/text
  wget -q -O G2PWModel.zip https://www.modelscope.cn/models/kamiorinn/g2pw/resolve/master/G2PWModel_1.1.zip \
    || wget -q -O G2PWModel.zip https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/G2PWModel.zip
  unzip -q -o G2PWModel.zip && rm -f G2PWModel.zip
  [ -d G2PWModel_1.1 ] && mv G2PWModel_1.1 G2PWModel || true
  cd "$DIR"
fi
"$PY" -c "import nltk; nltk.download('averaged_perceptron_tagger_eng', quiet=True); nltk.download('cmudict', quiet=True)" || true

say "检查一下"
"$PY" -c "import torch; print('显卡：', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '没有'); import GPT_SoVITS" 2>/dev/null || "$PY" -c "import torch; print('显卡：', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '没有')"
ls GPT_SoVITS/pretrained_models
say "装好了。下一步：cd $(dirname "$0")/.. && node tools/worker.js run --gsv $DIR --hours 2"
