# 打电话用的听写模型（达摩院 FunASR：Paraformer 中文识别 + 断句 + 加标点，Apache-2.0）打成一个包，搬到国内存储和自己的 GitHub
#   同事电脑第一次打电话时从魔搭一个文件一个文件地下，网慢要十几分钟；改成从捞捞的国内存储下这一个包（约 1G），几分钟就好
#   包里三个文件夹（和 grid/py/asr_server.py 认的本地文件夹名字一样，解压到 GPT-SoVITS 整合包的 tools/asr/models/ 里）：
#     speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/
#     speech_fsmn_vad_zh-cn-16k-common-pytorch/
#     punc_ct-transformer_zh-cn-common-vocab272727-pytorch/
#   python build-asr.py 输出.tar
#   下载：直接用魔搭的文件接口（不用装 modelscope 这个库）；接口不通再装库（装到自己的文件夹里）用 snapshot_download
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

REV = "v2.0.4"
MODELS = [
    "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
]
API = "https://www.modelscope.cn/api/v1/models/iic/"
out = sys.argv[1]
work = os.path.join(os.path.dirname(os.path.abspath(out)), "asr")
os.makedirs(work, exist_ok=True)
UA = {"User-Agent": "laolao-mirror/1.0"}


def get_json(url):
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print("读文件列表出错（第 %d 次）：%s" % (i + 1, e), flush=True)
            time.sleep(5 * (i + 1))
    raise RuntimeError("读不到文件列表：" + url)


def get_file(url, dest, size):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for i in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(dest + ".part", "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            if size and os.path.getsize(dest + ".part") != size:
                raise RuntimeError("大小不对：%d / %d" % (os.path.getsize(dest + ".part"), size))
            os.replace(dest + ".part", dest)
            return
        except Exception as e:
            print("下载 %s 出错（第 %d 次）：%s" % (os.path.basename(dest), i + 1, e), flush=True)
            time.sleep(5 * (i + 1))
    raise RuntimeError("下不下来：" + url)


def by_api(name, dst):
    j = get_json(API + name + "/repo/files?Revision=" + REV + "&Recursive=true")
    files = [f for f in ((j.get("Data") or {}).get("Files") or []) if f.get("Type") != "tree"]
    if not files:
        raise RuntimeError("文件列表是空的：%s" % str(j)[:300])
    for f in files:
        p = f["Path"]
        if p.startswith(".git") or "/." in p:
            continue
        url = API + name + "/repo?Revision=" + REV + "&FilePath=" + urllib.parse.quote(p)
        get_file(url, os.path.join(dst, p), int(f.get("Size") or 0))


def by_lib(name, dst):
    lib = os.path.join(work, "pylib")
    if not os.path.isdir(os.path.join(lib, "modelscope")):
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--target", lib, "modelscope", "requests", "tqdm", "filelock", "urllib3"])
    sys.path.insert(0, lib)
    from modelscope import snapshot_download
    p = snapshot_download("iic/" + name, revision=REV, cache_dir=os.path.join(work, "cache"))
    shutil.copytree(p, dst, ignore=shutil.ignore_patterns(".git*", ".mdl", ".msc", ".mv", "*.lock"))


for name in MODELS:
    dst = os.path.join(work, "models", name)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    try:
        by_api(name, dst)
    except Exception as e:
        print("魔搭文件接口没成（%s），改用 modelscope 库" % e, flush=True)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        by_lib(name, dst)
    top = os.listdir(dst)
    if not any(f.endswith((".pt", ".pb", ".onnx", ".bin")) for f in top):
        raise SystemExit("%s 里没有模型文件：%s" % (name, top))
    mb = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(dst) for f in fs) / 1048576
    print("%s：%d 个文件，%.0f M" % (name, len(top), mb), flush=True)

with tarfile.open(out, "w") as t:
    for name in MODELS:
        t.add(os.path.join(work, "models", name), arcname=name)
print("打好了：%s（%.0f M）" % (out, os.path.getsize(out) / 1048576), flush=True)
