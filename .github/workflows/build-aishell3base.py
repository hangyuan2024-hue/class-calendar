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
import json
import urllib.error
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
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise FileNotFoundError(rel)
            err = e
            time.sleep(3 + k * 5)
        except Exception as e:
            err = e
            time.sleep(3 + k * 5)
    raise RuntimeError("下不了 %s：%s" % (rel, err))


# Hugging Face 上的 AISHELL-3 不是每一句都有录音（content.txt 列了全部句子，wav 只传了一部分）：
# 先用文件列表接口问清楚哪些说话人、哪些句子真的有，只挑有的（以前随便挑，404 一句整个打包就失败了）
def listed(rel_dir):
    names, url = set(), "%s/api/datasets/%s/tree/main/%s" % (HF, REPO, rel_dir)
    for _ in range(50):
        for k in range(6):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laolao-mirror"}), timeout=60) as r:
                    arr = json.loads(r.read().decode("utf-8"))
                    link = r.headers.get("Link") or ""
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return set()
                time.sleep(3 + k * 5)
            except Exception:
                time.sleep(3 + k * 5)
        else:
            raise RuntimeError("问不到文件列表：" + rel_dir)
        for x in arr:
            names.add(str(x.get("path", "")).rstrip("/").rsplit("/", 1)[-1])
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        if not m:
            break
        url = m.group(1)
    return names


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
    have_spk = listed("%s/wav" % split)
    spks = sorted(x for x in utts if x in have_spk)
    print("%s：content.txt 里 %d 位说话人，网上有录音的 %d 位" % (split, len(utts), len(spks)), flush=True)
    random.Random(2026).shuffle(spks)
    took = 0
    for s in spks:
        if took >= n_spk:
            break
        have = listed("%s/wav/%s" % (split, s))
        rows = sorted(u for u in utts[s] if u in have)
        if len(rows) < max(3, per // 4):
            continue
        random.Random(s).shuffle(rows)
        files += ["%s/wav/%s/%s" % (split, s, u) for u in rows[:per]]
        took += 1
    print("%s：挑了 %d 位" % (split, took), flush=True)
print("要下 %d 句" % len(files), flush=True)

done = [0]


miss = []


def one(rel):
    split, _, s, u = rel.split("/")
    try:
        get(rel, os.path.join(od, split, s, u))
    except FileNotFoundError:
        miss.append(rel)   # 列表里有、下载说没有（极少）：跳过这一句，配方只用包里有的
        return
    done[0] += 1
    if done[0] % 200 == 0:
        print("下了 %d/%d" % (done[0], len(files)), flush=True)


with concurrent.futures.ThreadPoolExecutor(8) as ex:
    list(ex.map(one, files))
if miss:
    print("跳过 %d 句（网上没有）" % len(miss), flush=True)
if done[0] < len(files) * 0.8:
    raise SystemExit("下好的太少：%d/%d" % (done[0], len(files)))
with open(os.path.join(od, "pack.txt"), "w", encoding="utf-8") as fh:
    fh.write("%d\n" % done[0])

with tarfile.open(out, "w") as tf:
    tf.add(od, arcname="aishell3")
print("打包好了：%d 句，%.0f MB" % (len(files), os.path.getsize(out) / 1e6))
