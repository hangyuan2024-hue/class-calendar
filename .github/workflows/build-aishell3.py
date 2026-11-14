# 捞捞声音用的公开录音 AISHELL-3（Apache-2.0）打成一个包，搬到国内存储和自己的 GitHub
#   同事电脑从 hf-mirror / Hugging Face 下经常断（SSL EOF），所以在 GitHub Actions 上先下好
#   包里：aishell3/spk-info.txt、aishell3/content.txt、aishell3/pick.txt（选中的说话人）、aishell3/<说话人>的全部 wav
#   挑人的规则和配方 voice_train.py 一样：女声、26～40 岁（C、D）、北方口音、句子最多的那一位
#   python build-aishell3.py 输出.tar
import json
import os
import re
import sys
import tarfile
import time
import urllib.request

HF = "https://huggingface.co"
REPO = "AISHELL/AISHELL-3"
out = sys.argv[1]
tmp = os.path.join(os.path.dirname(os.path.abspath(out)), "aishell3")
os.makedirs(tmp, exist_ok=True)


def get(url, dest=None, tries=6):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "laolao-mirror"})
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
            if dest:
                with open(dest, "wb") as fh:
                    fh.write(b)
            return b
        except Exception as e:
            err = e
            time.sleep(3 + k * 5)
    raise RuntimeError("下不了 %s：%s" % (url, err))


res = lambda rel: "%s/datasets/%s/resolve/main/%s" % (HF, REPO, rel)
get(res("spk-info.txt"), os.path.join(tmp, "spk-info.txt"))
get(res("train/content.txt"), os.path.join(tmp, "content.txt"))

info = {}
for ln in open(os.path.join(tmp, "spk-info.txt"), encoding="utf-8", errors="replace"):
    a = ln.split()
    if len(a) >= 4 and a[0].startswith("SSB"):
        info[a[0]] = (a[1], a[2], a[3])
utts = {}
for ln in open(os.path.join(tmp, "content.txt"), encoding="utf-8", errors="replace"):
    a = ln.split()
    if len(a) < 3 or not a[0].endswith(".wav"):
        continue
    txt = "".join(x for x in a[1:] if not re.search(r"[A-Za-z0-9%$]", x))
    if len(txt) >= 4:
        utts.setdefault(a[0][:7], []).append(a[0])
cands = [s for s in utts if s in info and info[s][1] == "female" and info[s][0] in ("C", "D") and info[s][2] == "north"]
cands = cands or [s for s in utts if s in info and info[s][1] == "female"]
spk = max(cands, key=lambda s: len(utts[s]))
print("挑中 %s（%s）：%d 句" % (spk, " ".join(info[spk]), len(utts[spk])), flush=True)
with open(os.path.join(tmp, "pick.txt"), "w", encoding="utf-8") as fh:
    fh.write(spk + "\n")

tree = json.loads(get("%s/api/datasets/%s/tree/main/train/wav/%s" % (HF, REPO, spk)).decode("utf-8"))
names = [os.path.basename(x["path"]) for x in tree if x.get("type") == "file" and x["path"].endswith(".wav")]
want = set(utts[spk])
names = [n for n in names if n in want] or names
for i, n in enumerate(names):
    get(res("train/wav/%s/%s" % (spk, n)), os.path.join(tmp, n))
    if i % 50 == 0:
        print("下了 %d/%d" % (i + 1, len(names)), flush=True)

with tarfile.open(out, "w") as tf:
    for n in ["spk-info.txt", "content.txt", "pick.txt"] + names:
        tf.add(os.path.join(tmp, n), arcname="aishell3/" + n)
print("打包好了：%d 个录音，%.0f MB" % (len(names), os.path.getsize(out) / 1e6))
