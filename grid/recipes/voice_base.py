"""捞捞声音 · 声音底座：所有老师共用的声音模型（GPT-SoVITS 整个模型接着训，不是给一位老师加个小插件）
两种活（params.mode）：
  drill（练习，同事的显卡一直做）：用现在的底座念「难句子」（多音字、公式、英文词、问句、长句），一句念好几遍，
        自动打分（识别回文字算错字率、和参考声音比像不像），念得最好的交上去（voicedrill-*.tar）；顺便记下现在的底座错字率
  train（训练，攒够了自动开）：声音数据池（各位老师清洗好的录音 voicepool-*、练习里最好的句子 voicedrill-*）
        + 公开录音 AISHELL-3（Apache-2.0）若干人 → 从现在的底座（没有就官方预训练）接着训 SoVITS + GPT 两部分的全部参数
        → 固定考题（没参加训练的说话人）新旧各念一遍比错字率和像不像 → 都不变差、至少一项变好才发布 voice-base
老师端：没训练过自己声音的老师，也用新底座 + 她 10 秒录音念（越训越像老师上课说话）；训练老师自己的声音时也从底座接着训
"""
# needs: gsv
import glob
import hashlib
import json
import os
import random
import re
import shutil
import socket
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request
import wave

import lg

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()
G = t.get("gsv") or {}
GD, PY = G.get("dir"), G.get("python")
if not GD or not PY:
    raise RuntimeError("没拿到 GPT-SoVITS 的位置")
FF = G.get("ffmpegCmd") or [G.get("ffmpeg") or "ffmpeg"]
files = t.get("files") or {}
MODE = p.get("mode", "drill")
t0 = time.time()
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", _CUDA_VISIBLE_DEVICES="0", CUDA_VISIBLE_DEVICES="0", hz="25hz", is_half=str(p.get("half", True)),
           PYTHONPATH=os.pathsep.join([GD, os.path.join(GD, "GPT_SoVITS")]))
rnd = random.Random(int(p.get("seed", 0)) or None)


def sh(args, env=None, label="", cwd=None):
    lg.log("运行：%s" % " ".join(os.path.basename(str(a)) if i < 2 else str(a) for i, a in enumerate(args))[:240])
    pr = subprocess.Popen([str(a) for a in args], cwd=cwd or GD, env=env or ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    tail, last = [], 0.0
    for line in pr.stdout:
        line = line.rstrip()
        tail = (tail + [line])[-30:]
        if line and time.time() - last > 15:
            last = time.time()
            lg.log("%s：%s" % (label, line[-160:]))
    if pr.wait() != 0:
        raise RuntimeError("%s失败：\n%s" % (label, "\n".join(tail[-10:])))


def secs(f):
    try:
        with wave.open(f) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0


def to_wav(src, dst):
    subprocess.run(FF + ["-y", "-v", "error", "-i", src, "-ac", "1", "-ar", "32000", "-sample_fmt", "s16", dst], check=True, cwd=work)
    return dst


# ---------------- 难句子：多音字、数学、英文词、课堂问句、长句（数字写成汉字：考的是念，不是认数字）----------------
ZH = "零一二三四五六七八九"


def zh_num(n):
    if n < 10:
        return ZH[n]
    if n < 20:
        return "十" + (ZH[n % 10] if n % 10 else "")
    if n < 100:
        return ZH[n // 10] + "十" + (ZH[n % 10] if n % 10 else "")
    if n < 1000:
        r = n % 100
        return ZH[n // 100] + "百" + ("" if r == 0 else ("零" + ZH[r] if r < 10 else zh_num(r) if r >= 20 else "一" + zh_num(r)))
    return "".join(ZH[int(c)] for c in str(n))


POLY = [
    "银行门口有一行小树，排得整整齐齐。", "他长大以后，头发留得很长。", "这道题的重点要重复讲三遍。", "我还没还你那本书呢。",
    "音乐课上大家都很快乐。", "你得认真想一想，才能得到答案。", "别着急，先看着黑板想一想。", "了解这个知识点以后就好办了。",
    "头发长了就去理发。", "数一数这一行一共有几个数。", "把空调调到二十六度。", "这个传说传了好几代人。",
    "睡觉前再觉得不懂的地方记下来。", "方便的时候，买点便宜的本子。", "朝阳正好朝着教室的窗户。", "种子种下去以后要浇水。",
    "温度降下来了，投降的人走了出来。", "宝藏藏在西藏的山里。", "这个问题我们分几处来处理。", "抽屉里是空的，空了一个位置。",
    "少年时期不要少看书。", "中午打中了靶心的中间。", "这个字怎么读，大家读一读。", "他把背包背在背上。",
    "一会儿要会计算会议的时间。", "这个角色的角落里有一只小羊角。", "教室里教了一节好课。", "大夫说大家都要多喝水。",
]
EN = ["Python", "for 循环", "print 函数", "if 语句", "PPT", "Excel", "AI", "list 列表", "while 循环", "return"]
ASK = ["同学们，你们觉得这道题还有别的解法吗？", "谁愿意上来给大家讲一讲你的思路？", "这一步为什么要这样做，有没有同学知道？",
       "如果把条件换一下，答案还会一样吗？", "大家先别急着下结论，再仔细看一看题目。", "好，我们来总结一下今天学的三个要点。"]


def hard_sentences(n, r):
    out = []
    while len(out) < n:
        k = r.randrange(6)
        a, b, c = r.randint(2, 19), r.randint(2, 19), r.randint(2, 99)
        if k == 0:
            out.append(r.choice(POLY))
        elif k == 1:
            out.append("%s乘以%s等于%s，大家记住这个结果。" % (zh_num(a), zh_num(b), zh_num(a * b)))
        elif k == 2:
            out.append("x的平方减去%sx再加上%s等于零，我们先来因式分解。" % (zh_num(a + b), zh_num(a * b)))
        elif k == 3:
            out.append("%s分之%s加上%s分之一，要先通分。" % (zh_num(b + 1), zh_num(1 + a % b), zh_num(a + 1)))
        elif k == 4:
            out.append("在 %s 里，%s，我们一会儿写一个例子。" % (r.choice(["Python", "C++", "Scratch"]), r.choice(["for 循环可以重复做同一件事", "print 函数把结果显示出来", "if 语句用来做判断", "return 把结果交回去"])))
        else:
            out.append(r.choice(ASK) if r.random() < 0.6 else r.choice(POLY) + r.choice(ASK))
    return out


def norm_text(s):
    return re.sub(r"[\s，。！？、,.!?…：:；;“”\"'（）()《》\-]", "", str(s)).lower()


def cer(ref, hyp):
    a, b = norm_text(ref), norm_text(hyp)
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1] / float(len(a))


# ---------------- 公开录音 AISHELL-3（Apache-2.0）：只下用到的人 ----------------
OB = [x for x in str(p.get("openBase") or "").split(",") if x] or (["https://huggingface.co/datasets/AISHELL/AISHELL-3/resolve/main", "https://hf-mirror.com/datasets/AISHELL/AISHELL-3/resolve/main"] if lg.region() == "global" else ["https://hf-mirror.com/datasets/AISHELL/AISHELL-3/resolve/main", "https://huggingface.co/datasets/AISHELL/AISHELL-3/resolve/main"])
OD = os.path.join(work, "aishell3")
os.makedirs(OD, exist_ok=True)


def fetch(rel, dest, tries=4):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    err = None
    for k in range(tries):
        for b in OB:
            try:
                with urllib.request.urlopen(b + "/" + rel, timeout=60) as r, open(dest + ".part", "wb") as fh:
                    shutil.copyfileobj(r, fh)
                os.replace(dest + ".part", dest)
                return dest
            except Exception as e:
                err = e
        time.sleep(1 + k * 2)
    raise RuntimeError("下不了 %s：%s" % (rel, err))


def aishell_index(split):
    utts = {}
    with open(fetch("%s/content.txt" % split, os.path.join(OD, split, "content.txt")), encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            a = ln.split()
            if len(a) < 3 or not a[0].endswith(".wav"):
                continue
            txt = "".join(x for x in a[1:] if not re.search(r"[A-Za-z0-9%$]", x))
            if len(txt) >= 4:
                utts.setdefault(a[0][:7], []).append((a[0], txt))
    return utts


def aishell_clips(split, spks, per, r):
    """下这几个人各 per 句：[(本地 wav, 文字, 说话人)]"""
    import concurrent.futures
    idx = aishell_index(split)
    jobs = []
    for s_ in spks:
        rows = list(idx.get(s_, []))
        r.shuffle(rows)
        jobs += [(s_, u, txt) for u, txt in rows[:per]]
    out = []

    def one(j):
        s_, u, txt = j
        src = fetch("%s/wav/%s/%s" % (split, s_, u), os.path.join(OD, split, s_, u))
        w = to_wav(src, os.path.join(work, "wavs", "a_" + u))
        return w, txt, s_

    os.makedirs(os.path.join(work, "wavs"), exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for fut in [ex.submit(one, j) for j in jobs]:
            try:
                out.append(fut.result())
            except Exception as e:
                lg.log("跳过一句公开录音：%s" % str(e)[:160])
    return out


# ---------------- GPT-SoVITS：版本、预训练、现在的底座 ----------------
PM = os.path.join(GD, "GPT_SoVITS", "pretrained_models")


def first(*cands):
    for c in cands:
        hit = sorted(glob.glob(os.path.join(PM, c)))
        if hit:
            return hit[0]
    return None


VER = "v2Pro" if first("v2Pro/s2Gv2Pro.pth") else "v2"
s2G0 = first("v2Pro/s2Gv2Pro.pth") if VER == "v2Pro" else first("gsv-v2final-pretrained/s2G*.pth")
s2D0 = first("v2Pro/s2Dv2Pro.pth") if VER == "v2Pro" else first("gsv-v2final-pretrained/s2D*.pth")
s10 = first("gsv-v2final-pretrained/s1*.ckpt", "s1*.ckpt")
bert = first("chinese-roberta-wwm-ext-large")
hub = first("chinese-hubert-base")
svck = first("sv/*.ckpt")
if not (s2G0 and s2D0 and s10 and bert and hub):
    raise RuntimeError("GPT-SoVITS 整合包不全（版本 %s）" % VER)
base_gpt, base_sov, base_name = s10, s2G0, "官方预训练"
if files.get("m_gpt") and files.get("m_sovits"):
    try:
        bv = json.load(open(files["m_info"], encoding="utf-8")).get("version") if files.get("m_info") else None
    except Exception:
        bv = None
    if bv in (None, VER):
        base_gpt, base_sov, base_name = files["m_gpt"], files["m_sovits"], "现在的声音底座"
    else:
        lg.log("声音底座是 %s 的，这台电脑是 %s：用官方预训练" % (bv, VER))
lg.log("GPT-SoVITS %s，从「%s」开始" % (VER, base_name))


# ---------------- 念：起一个 api_v2，换权重、念 ----------------
class Api:
    def __init__(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        self.port = s.getsockname()[1]
        s.close()
        self.proc = subprocess.Popen([PY, "-s", "api_v2.py", "-a", "127.0.0.1", "-p", str(self.port)], cwd=GD, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = "http://127.0.0.1:%d" % self.port
        for _ in range(480):
            try:
                urllib.request.urlopen(self.base + "/docs", timeout=2).read(10)
                return
            except Exception:
                if self.proc.poll() is not None:
                    raise RuntimeError("api_v2 没起来")
                time.sleep(0.5)
        raise RuntimeError("api_v2 起得太慢")

    def weights(self, gpt, sov):
        for k, v in (("set_gpt_weights", gpt), ("set_sovits_weights", sov)):
            urllib.request.urlopen(self.base + "/%s?weights_path=%s" % (k, urllib.parse.quote(v)), timeout=300).read()

    def tts(self, text, ref, prompt, out, seed=-1):
        body = {"text": text, "text_lang": "zh", "ref_audio_path": ref, "prompt_text": prompt, "prompt_lang": "zh", "text_split_method": "cut5", "media_type": "wav", "seed": seed}
        req = urllib.request.Request(self.base + "/tts", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            b = r.read()
        if b[:4] != b"RIFF" or len(b) < 8000:
            return None
        with open(out, "wb") as fh:
            fh.write(b)
        return out

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass


def asr(folder):
    """识别一个文件夹里的每段声音：{文件名: 文字}"""
    o = os.path.join(work, "asr_" + os.path.basename(folder))
    os.makedirs(o, exist_ok=True)
    sh([PY, "-s", os.path.join(GD, "tools", "asr", "funasr_asr.py"), "-i", folder, "-o", o, "-s", "large", "-l", "zh", "-p", "float16"], label="识别")
    res = {}
    for f in glob.glob(os.path.join(o, "*.list")):
        with open(f, encoding="utf-8") as fh:
            for ln in fh:
                a = ln.rstrip("\n").split("|")
                if len(a) >= 4:
                    res[os.path.basename(a[0])] = a[3]
    return res


SV_PY = r'''
import json, sys, os
sys.path.insert(0, os.path.join(os.getcwd(), "GPT_SoVITS"))
import numpy as np, librosa, torch
from sv import SV
dev = "cuda" if torch.cuda.is_available() else "cpu"
m = SV(dev, dev == "cuda")
out = {}
for f in json.load(open(sys.argv[1], encoding="utf-8")):
    try:
        w, _ = librosa.load(f, sr=16000)
        t = torch.from_numpy(w).unsqueeze(0).to(dev)
        e = m.compute_embedding3(t.half() if dev == "cuda" else t)
        out[f] = e.float().cpu().numpy().reshape(-1).tolist()
    except Exception as ex:
        print("跳过", f, ex)
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"))
'''


def embed(paths):
    """每段声音一个「是谁在说」的向量；整合包没有说话人模型就返回空"""
    if not svck or not paths:
        return {}
    a, b = os.path.join(work, "sv_in.json"), os.path.join(work, "sv_out.json")
    json.dump(paths, open(a, "w", encoding="utf-8"))
    sp = os.path.join(work, "lg_sv.py")
    open(sp, "w", encoding="utf-8").write(SV_PY)
    try:
        sh([PY, "-s", sp, a, b], label="认说话人")
        return json.load(open(b, encoding="utf-8"))
    except Exception as e:
        lg.log("认说话人没成功：%s" % str(e)[-200:])
        return {}


def cos(x, y):
    import math
    if not x or not y:
        return None
    d = sum(a * b for a, b in zip(x, y))
    return d / (math.sqrt(sum(a * a for a in x)) * math.sqrt(sum(b * b for b in y)) + 1e-8)


def pick_refs(clips, n, r):
    """参考录音：3～9 秒、每人一段"""
    by = {}
    for w, txt, spk in clips:
        if 3 <= secs(w) <= 9 and spk not in by:
            by[spk] = (w, txt, spk)
    keys = sorted(by)
    r.shuffle(keys)
    return [by[k] for k in keys[:n]]


def speak_and_grade(api, sents, refs, tries, outdir, label):
    """每句 × 每个参考声音 × 念 tries 遍 → 识别、比像不像 → [{sent, ref, wav, cer, sim}]"""
    os.makedirs(outdir, exist_ok=True)
    rows, n, total = [], 0, len(sents) * len(refs) * tries
    for i, s_ in enumerate(sents):
        for j, (rw, rt, rs) in enumerate(refs):
            for k in range(tries):
                n += 1
                if n % 10 == 0:
                    lg.progress(min(0.95, lg_base + lg_span * n / total), "%s：念到第 %d/%d 遍" % (label, n, total))
                out = os.path.join(outdir, "c%03d_%02d_%d.wav" % (i, j, k))
                try:
                    if api.tts(s_, rw, rt, out, seed=rnd.randint(1, 2 ** 31 - 1) if tries > 1 else 1234):
                        rows.append({"sent": s_, "ref": rw, "spk": rs, "wav": out})
                except Exception as e:
                    lg.log("念不出来：%s" % str(e)[:120])
    text = asr(outdir)
    E = embed([x["wav"] for x in rows] + sorted({x["ref"] for x in rows}))
    for x in rows:
        x["cer"] = cer(x["sent"], text.get(os.path.basename(x["wav"]), ""))
        x["sim"] = cos(E.get(x["wav"]), E.get(x["ref"]))
    return rows


def mean(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if v else None


lg_base, lg_span = 0.1, 0.8

# =====================================================================
if MODE == "drill":
    n_s, n_r, tries = int(p.get("sentences", 12)), int(p.get("refs", 4)), int(p.get("tries", 3))
    lg.progress(0.02, "下几位公开录音的说话人当参考声音")
    idx_spk = sorted(aishell_index("train"))
    rnd.shuffle(idx_spk)
    clips = aishell_clips("train", idx_spk[: n_r * 2], 3, rnd)
    refs = pick_refs(clips, n_r, rnd)
    if not refs:
        raise RuntimeError("没有能用的参考声音")
    sents = hard_sentences(n_s, rnd)
    api = Api()
    try:
        api.weights(base_gpt, base_sov)
        rows = speak_and_grade(api, sents, refs, tries, os.path.join(work, "drill"), "念难句子")
    finally:
        api.close()
    if not rows:
        raise RuntimeError("一句都没念出来")
    # 每句 × 每个声音：留念得最好的那遍（错字最少，再比像不像）；错字率 0、和参考声音够像的才留
    best = {}
    for x in rows:
        k = (x["sent"], x["ref"])
        key = (x["cer"], -(x["sim"] or 0))
        if k not in best or key < best[k][0]:
            best[k] = (key, x)
    sims = [x["sim"] for x in rows if x["sim"] is not None]
    sim_floor = sorted(sims)[len(sims) // 2] if sims else None
    keep = [x for _, x in best.values() if x["cer"] == 0 and (sim_floor is None or (x["sim"] or 0) >= sim_floor - 0.02)]
    pd = os.path.join(work, "pack")
    os.makedirs(pd, exist_ok=True)
    lines = []
    for i, x in enumerate(keep):
        fn = "%04d.flac" % i
        try:
            subprocess.run(FF + ["-y", "-v", "error", "-i", x["wav"], "-c:a", "flac", os.path.join(pd, fn)], check=True, cwd=work)
            lines.append("%s|drill-%s|%s|%.2f" % (fn, x["spk"], x["sent"], secs(x["wav"])))
        except Exception:
            pass
    if lines:
        open(os.path.join(pd, "list.tsv"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
        out = os.path.join(work, "voicedrill-%d-%d.tar" % (int(time.time()), rnd.randint(0, 9999)))
        with tarfile.open(out, "w") as tf:
            for fn in os.listdir(pd):
                tf.add(os.path.join(pd, fn), arcname=fn)
        lg.output(out)
    for x in sorted(rows, key=lambda x: x["cer"])[-2:]:
        lg.log("念错最多的一遍：「%s」错字率 %.0f%%" % (x["sent"], x["cer"] * 100))
    lg.done(cer=round(mean([x["cer"] for x in rows]), 4), best_cer=round(mean([x[1]["cer"] for x in best.values()]), 4),
            sim=round(mean(sims) or 0, 4), kept=len(lines), tried=len(rows), base=base_name)
    raise SystemExit(0)

# =====================================================================
# train：声音数据池 + 练习里最好的句子 + 公开录音 → 接着训整个模型 → 考试 → 变好了才发布
lg.progress(0.01, "整理声音数据池")
wavs = os.path.join(work, "wavs")
os.makedirs(wavs, exist_ok=True)


def unpack(key, tag):
    d = os.path.join(work, "unpack", key)
    os.makedirs(d, exist_ok=True)
    with tarfile.open(files[key]) as tf:
        for m in tf.getmembers():
            if m.isfile() and "/" not in m.name and ".." not in m.name:
                tf.extract(m, d)
    rows = []
    lp = os.path.join(d, "list.tsv")
    if not os.path.exists(lp):
        return []
    for ln in open(lp, encoding="utf-8"):
        a = ln.rstrip("\n").split("|")
        if len(a) >= 3 and os.path.exists(os.path.join(d, a[0])):
            rows.append((os.path.join(d, a[0]), a[2], a[1], tag))
    return rows


# 同一位老师交过好几次（每次训练都交一份）：只用最新的那份
teach, drill = {}, []
for k in sorted((k for k in files if k.startswith("pool")), key=lambda k: int(k[4:])):
    rows = unpack(k, "pool")
    if rows:
        teach[rows[0][2]] = rows
for k in sorted((k for k in files if k.startswith("drill")), key=lambda k: int(k[5:])):
    drill += unpack(k, "drill")
lg.log("声音数据池：%d 位老师 %d 句；练习里最好的句子 %d 句" % (len(teach), sum(len(v) for v in teach.values()), len(drill)))

# 考试用的参考声音：没参加训练的人（公开录音的测试集几个人）+ 每位老师留出一句不训练
held = []
for who, rows in teach.items():
    for x in rows:
        w = to_wav(x[0], os.path.join(wavs, "h_%s.wav" % hashlib.md5(x[0].encode()).hexdigest()[:10]))
        if 3 <= secs(w) <= 9:
            held.append((w, x[1], who))
            rows.remove(x)
            break
lg.progress(0.03, "下公开录音（AISHELL-3）")
r_ = random.Random(int(p.get("seed", 7)) or 7)
tr_spk = sorted(aishell_index("train"))
r_.shuffle(tr_spk)
open_clips = aishell_clips("train", tr_spk[: int(p.get("aishellSpeakers", 40))], int(p.get("clipsPer", 60)), r_)
te_spk = sorted(aishell_index("test"))
random.Random(11).shuffle(te_spk)
held += pick_refs(aishell_clips("test", te_spk[: int(p.get("evalSpeakers", 3)) * 2], 3, random.Random(11)), int(p.get("evalSpeakers", 3)), random.Random(11))
if not held:
    raise RuntimeError("没有考试用的参考声音")

# 凑训练集：老师的全用；练习的最多占 drillRatio；公开录音补到 maxHours
items = []
for who, rows in teach.items():
    for i, (f, txt, spk, _) in enumerate(rows):
        items.append((to_wav(f, os.path.join(wavs, "t_%s_%05d.wav" % (hashlib.md5(who.encode("utf-8")).hexdigest()[:8], i))), txt, "t_" + hashlib.md5(who.encode("utf-8")).hexdigest()[:8]))
own = sum(secs(x[0]) for x in items)
cap = float(p.get("maxHours", 10)) * 3600
r_.shuffle(drill)
dsec, dcap = 0.0, max(60.0, float(p.get("drillRatio", 0.15)) * min(cap, own + sum(secs(x[0]) for x in open_clips)))
for i, (f, txt, spk, _) in enumerate(drill):
    if dsec >= dcap:
        break
    w = to_wav(f, os.path.join(wavs, "d_%05d.wav" % i))
    dsec += secs(w)
    items.append((w, txt, spk))
acc = sum(secs(x[0]) for x in items)
for w, txt, spk in open_clips:
    if acc >= cap:
        break
    d = secs(w)
    if 0.8 <= d <= 20:
        items.append((w, txt, spk))
        acc += d
items = [x for x in items if 0.8 <= secs(x[0]) <= 20]
hours = sum(secs(x[0]) for x in items) / 3600
spks = len({x[2] for x in items})
lg.log("训练集：%d 句、%.2f 小时、%d 个说话人（老师 %.1f 分钟，练习 %.1f 分钟）" % (len(items), hours, spks, own / 60, dsec / 60))
if hours * 3600 < float(p.get("minSeconds", 1800)):
    lg.done(skip="数据太少（%.1f 分钟），先攒着" % (hours * 60), hours=round(hours, 2))
    raise SystemExit(0)

EXP = "laolao_base_%d" % int(time.time())
lst = os.path.join(work, "train.list")
with open(lst, "w", encoding="utf-8") as f:
    for w, txt, spk in items:
        f.write("%s|%s|zh|%s\n" % (w, spk, txt.replace("|", " ")))

cfg2 = os.path.join(GD, "GPT_SoVITS", "configs", "s2v2Pro.json" if VER == "v2Pro" else "s2.json")
cfg1 = os.path.join(GD, "GPT_SoVITS", "configs", "s1longer-v2.yaml")
exp_dir = os.path.join(GD, "logs", EXP)
shutil.rmtree(exp_dir, ignore_errors=True)
os.makedirs(exp_dir, exist_ok=True)
base_env = dict(ENV, inp_text=lst, inp_wav_dir="", exp_name=EXP, i_part="0", all_parts="1", opt_dir=exp_dir, version=VER)
PD = os.path.join(GD, "GPT_SoVITS", "prepare_datasets")
lg.progress(0.08, "文字转音素")
sh([PY, "-s", os.path.join(PD, "1-get-text.py")], dict(base_env, bert_pretrained_dir=bert), "文字转音素")
lg.progress(0.15, "提取声音特征")
sh([PY, "-s", os.path.join(PD, "2-get-hubert-wav32k.py")], dict(base_env, cnhubert_base_dir=hub), "提取声音特征")
if VER == "v2Pro":
    sh([PY, "-s", os.path.join(PD, "2-get-sv.py")], dict(base_env, sv_path=svck), "提取音色特征")
sh([PY, "-s", os.path.join(PD, "3-get-semantic.py")], dict(base_env, pretrained_s2G=s2G0, s2config_path=cfg2), "提取语义")


def merge(pattern, out, head=None):
    rows = [head] if head else []
    for f in sorted(glob.glob(os.path.join(exp_dir, pattern))):
        with open(f, encoding="utf-8") as fh:
            rows += [x for x in fh.read().strip("\n").split("\n") if x]
        os.remove(f)
    with open(os.path.join(exp_dir, out), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rows) + "\n")
    return len(rows) - (1 if head else 0)


if not merge("2-name2text-*.txt", "2-name2text.txt") or not merge("6-name2semantic-*.tsv", "6-name2semantic.tsv", "item_name\tsemantic_audio"):
    raise RuntimeError("预处理没出结果")

SW, GW = os.path.join(GD, "SoVITS_weights_" + VER), os.path.join(GD, "GPT_weights_" + VER)
os.makedirs(SW, exist_ok=True)
os.makedirs(GW, exist_ok=True)
e2, e1, bs = int(p.get("sovitsEpochs", 4)), int(p.get("gptEpochs", 8)), int(p.get("batch", 4))
cj = os.path.join(work, "cfg.json")
json.dump({"s2_in": cfg2, "s2_out": os.path.join(work, "tmp_s2.json"), "s1_in": cfg1, "s1_out": os.path.join(work, "tmp_s1.yaml"), "bs": bs, "e2": e2, "e1": e1,
           "s2G": base_sov, "s2D": s2D0, "s1": base_gpt, "exp": EXP, "exp_dir": exp_dir, "ver": VER, "SW": SW, "GW": GW}, open(cj, "w", encoding="utf-8"), ensure_ascii=False)
MK = r'''
import json, sys, yaml
c = json.load(open(sys.argv[1], encoding="utf-8"))
d = json.load(open(c["s2_in"], encoding="utf-8"))
tr = d["train"]
tr.update(batch_size=c["bs"], epochs=c["e2"], text_low_lr_rate=0.4, pretrained_s2G=c["s2G"], pretrained_s2D=c["s2D"], if_save_latest=True,
          if_save_every_weights=True, save_every_epoch=c["e2"], gpu_numbers="0", grad_ckpt=False)
d.setdefault("model", {})["version"] = c["ver"]
d.setdefault("data", {})["exp_dir"] = c["exp_dir"]
d["s2_ckpt_dir"] = c["exp_dir"]; d["save_weight_dir"] = c["SW"]; d["name"] = c["exp"]; d["version"] = c["ver"]
json.dump(d, open(c["s2_out"], "w", encoding="utf-8"), ensure_ascii=False)
y = yaml.load(open(c["s1_in"], encoding="utf-8"), Loader=yaml.FullLoader)
y["train"].update(batch_size=c["bs"], epochs=c["e1"], save_every_n_epoch=c["e1"], if_save_every_weights=True, if_save_latest=True, if_dpo=False,
                  half_weights_save_dir=c["GW"], exp_name=c["exp"])
y["pretrained_s1"] = c["s1"]
y["train_semantic_path"] = c["exp_dir"] + "/6-name2semantic.tsv"
y["train_phoneme_path"] = c["exp_dir"] + "/2-name2text.txt"
y["output_dir"] = c["exp_dir"] + "/logs_s1_" + c["ver"]
yaml.dump(y, open(c["s1_out"], "w", encoding="utf-8"), default_flow_style=False)
'''
mk = os.path.join(work, "mkcfg.py")
open(mk, "w", encoding="utf-8").write(MK)
sh([PY, "-s", mk, cj], label="写训练配置")
lg.progress(0.3, "训练音色部分（SoVITS 全部参数，%d 轮，%d 个说话人）" % (e2, spks))
sh([PY, "-s", os.path.join(GD, "GPT_SoVITS", "s2_train.py"), "--config", os.path.join(work, "tmp_s2.json")], dict(ENV, version=VER), "训练音色")
lg.progress(0.55, "训练说话部分（GPT 全部参数，%d 轮）" % e1)
sh([PY, "-s", os.path.join(GD, "GPT_SoVITS", "s1_train.py"), "--config_file", os.path.join(work, "tmp_s1.yaml")], dict(ENV, version=VER), "训练语气")


def newest(d, pat):
    hit = sorted(glob.glob(os.path.join(d, pat)), key=os.path.getmtime)
    if not hit:
        raise RuntimeError("没找到训练好的模型：%s" % os.path.join(d, pat))
    return hit[-1]


sov = shutil.copyfile(newest(SW, EXP + "*.pth"), os.path.join(work, "base-sovits.pth"))
gpt = shutil.copyfile(newest(GW, EXP + "*.ckpt"), os.path.join(work, "base-gpt.ckpt"))
info = os.path.join(work, "base-info.json")
json.dump({"version": VER, "hours": round(hours, 2), "speakers": spks, "teachers": len(teach), "from": base_name}, open(info, "w", encoding="utf-8"), ensure_ascii=False)

# ---------------- 考试：没参加训练的声音念固定的难句子，新旧各一遍 ----------------
sents = hard_sentences(int(p.get("evalSentences", 16)), random.Random(20261114))
refs = held[: int(p.get("evalRefs", 6))]
lg.log("考试：%d 句 × %d 个没训练过的声音" % (len(sents), len(refs)))
api = Api()
try:
    lg_base, lg_span = 0.7, 0.12
    api.weights(base_gpt, base_sov)
    old = speak_and_grade(api, sents, refs, 1, os.path.join(work, "exam_old"), "考试（原来的）")
    lg_base, lg_span = 0.82, 0.12
    api.weights(gpt, sov)
    new = speak_and_grade(api, sents, refs, 1, os.path.join(work, "exam_new"), "考试（新的）")
finally:
    api.close()
if not new:
    raise RuntimeError("新模型一句都念不出来")
for x in new[:3]:
    lg.output(x["wav"])
m_old_c, m_new_c = mean([x["cer"] for x in old]), mean([x["cer"] for x in new])
m_old_s, m_new_s = mean([x["sim"] for x in old]), mean([x["sim"] for x in new])
lg.log("考试：错字率 %.2f%% → %.2f%%；像不像 %s → %s" % ((m_old_c or 0) * 100, m_new_c * 100, "%.3f" % m_old_s if m_old_s is not None else "—", "%.3f" % m_new_s if m_new_s is not None else "—"))
lg.done(gpt=gpt, sovits=sov, info=info, cer=round(m_new_c, 4), base_cer=round(m_old_c if m_old_c is not None else 1.0, 4),
        sim=round(m_new_s or 0, 4), base_sim=round(m_old_s or 0, 4), hours=round(hours, 2), speakers=spks, teachers=len(teach), version=VER,
        mins=round((time.time() - t0) / 60, 1))
