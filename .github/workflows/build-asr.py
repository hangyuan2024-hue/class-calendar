# 打电话用的听写模型（达摩院 FunASR：Paraformer 中文识别 + 断句 + 加标点，Apache-2.0）打成一个包，搬到国内存储和自己的 GitHub
#   同事电脑第一次打电话时从魔搭一个文件一个文件地下，网慢要十几分钟；改成从捞捞的国内存储下这一个包（约 1G），几分钟就好
#   包里三个文件夹（和 grid/py/asr_server.py 认的本地文件夹名字一样，解压到 GPT-SoVITS 整合包的 tools/asr/models/ 里）：
#     speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/
#     speech_fsmn_vad_zh-cn-16k-common-pytorch/
#     punc_ct-transformer_zh-cn-common-vocab272727-pytorch/
#   python build-asr.py 输出.tar
import os
import shutil
import subprocess
import sys
import tarfile

REV = "v2.0.4"
MODELS = [
    "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
]
out = sys.argv[1]
work = os.path.join(os.path.dirname(os.path.abspath(out)), "asr")
os.makedirs(work, exist_ok=True)

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "modelscope"])
from modelscope import snapshot_download  # noqa: E402

for name in MODELS:
    for attempt in range(5):
        try:
            p = snapshot_download("iic/" + name, revision=REV, cache_dir=os.path.join(work, "cache"))
            break
        except Exception as e:  # 魔搭偶尔断：歇一会儿再试
            print("下载 %s 出错（第 %d 次）：%s" % (name, attempt + 1, e), flush=True)
            if attempt == 4:
                raise
    dst = os.path.join(work, "models", name)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(p, dst, ignore=shutil.ignore_patterns(".git*", ".mdl", ".msc", ".mv", "*.lock"))
    if not any(f.endswith((".pt", ".pb", ".onnx", ".bin")) for f in os.listdir(dst)):
        raise SystemExit("%s 里没有模型文件：%s" % (name, os.listdir(dst)))
    print("%s：%d 个文件，%.0f M" % (name, len(os.listdir(dst)), sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst) if os.path.isfile(os.path.join(dst, f))) / 1048576), flush=True)

with tarfile.open(out, "w") as t:
    for name in MODELS:
        t.add(os.path.join(work, "models", name), arcname=name)
print("打好了：%s（%.0f M）" % (out, os.path.getsize(out) / 1048576), flush=True)
