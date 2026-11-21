# 捞小智好听的默认声音：Kokoro 中文女声模型（kokoro-multi-lang-v1_0，Apache-2.0，k2-fsa/sherpa-onnx 转好的 ONNX 版）
#   从 GitHub 下 .tar.bz2，解开 bz2 重新打成 .tar（客户端用 7-Zip 解一次就好），搬到国内存储和自己的 GitHub
#   包里是 kokoro-multi-lang-v1_0/ 这个文件夹（model.onnx、voices.bin、tokens.txt、lexicon-*.txt、espeak-ng-data/ …）
#   python build-kokoro.py 输出.tar
import os
import sys
import tarfile
import time
import urllib.request

URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
out = sys.argv[1]
src = out + ".bz2"
for i in range(6):
    try:
        urllib.request.urlretrieve(URL, src)
        break
    except Exception as e:
        print("下载出错（第 %d 次）：%s" % (i + 1, e), flush=True)
        time.sleep(10 * (i + 1))
else:
    raise SystemExit("下不下来：" + URL)
print("下好了：%.0f M" % (os.path.getsize(src) / 1048576), flush=True)
with tarfile.open(src, "r:bz2") as a, tarfile.open(out, "w") as b:
    names = set()
    for m in a:
        names.add(m.name.split("/")[-1])
        b.addfile(m, a.extractfile(m) if m.isfile() else None)
need = {"model.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt"}
if not need <= names:
    raise SystemExit("压缩包里少了：%s" % (need - names))
os.remove(src)
print("打好了：%s（%.0f M）" % (out, os.path.getsize(out) / 1048576), flush=True)
