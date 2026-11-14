# 声音底座用的公开录音 AISHELL-3（Apache-2.0）打成一个包，搬到国内存储和自己的 GitHub
#   同事电脑从 hf-mirror / Hugging Face 一句一句下经常断（SSL EOF），所以在 GitHub Actions 上先下好
#   包里（路径和配方 voice_base.py 的本地文件夹一样）：
#     aishell3/train/content.txt、aishell3/test/content.txt、aishell3/pack.txt（有这个文件配方就只用包里有的录音）
#     aishell3/train/<说话人>/<句子>.wav：训练集挑 80 位、每位 40 句
#     aishell3/test/<说话人>/<句子>.wav：测试集挑 12 位、每位 6 句（考试用，不参加训练）
#   python build-aishell3base.py 输出.tar
import concurrent.futures
import os
import random
import re
import sys
import tarfile
import time
import urllib.request

HF = "https://huggingface.co"
REPO = "AISHELL/AISHELL-3"
out = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(out)), "pack")
od = os.path.join(root, "aishell3")
PLAN = {"train": (80, 40), "test": (12, 6)}


def get(rel, dest, tries=6):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request("%s/datasets/%s/resolve/main/%s" % (HF, REPO, rel), headers={"User-Agent": "laolao-mirror"})
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
            with open(dest + ".part", "wb") as fh:
                fh.write(b)
            os.replace(dest + ".part", dest)
            return dest
        except Exception as e:
            err = e
            time.sleep(3 + k * 5)
    raise RuntimeError("下不了 %s：%s" % (rel, err))


files = []
for split, (n_spk, per) in PLAN.items():
    get("%s/content.txt" % split, os.path.join(od, split, "content.txt"))
    utts = {}
    for ln in open(os.path.join(od, split, "content.txt"), encoding="utf-8", errors="replace"):
        a = ln.split()
        if len(a) < 3 or not a[0].endswith(".wav"):
            continue
        txt = "".join(x for x in a[1:] if not re.search(r"[A-Za-z0-9%$]", x))
        if len(txt) >= 4:
            utts.setdefault(a[0][:7], []).append(a[0])
    spks = sorted(utts)
    random.Random(2026).shuffle(spks)
    for s in spks[:n_spk]:
        rows = sorted(utts[s])
        random.Random(s).shuffle(rows)
        files += ["%s/wav/%s/%s" % (split, s, u) for u in rows[:per]]
print("要下 %d 句" % len(files), flush=True)

done = [0]


def one(rel):
    split, _, s, u = rel.split("/")
    get(rel, os.path.join(od, split, s, u))
    done[0] += 1
    if done[0] % 200 == 0:
        print("下了 %d/%d" % (done[0], len(files)), flush=True)


with concurrent.futures.ThreadPoolExecutor(8) as ex:
    list(ex.map(one, files))
with open(os.path.join(od, "pack.txt"), "w", encoding="utf-8") as fh:
    fh.write("%d\n" % len(files))

with tarfile.open(out, "w") as tf:
    tf.add(od, arcname="aishell3")
print("打包好了：%d 句，%.0f MB" % (len(files), os.path.getsize(out) / 1e6))
