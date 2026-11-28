"""捞捞声音 · 训练一位老师的声音（GPT-SoVITS 微调，同事的显卡 6G 以上就行，一次 20～60 分钟）
用这位老师的数据：
  · 或者网上公开的高质量录音（openVoice=aishell3：AISHELL-3，Apache-2.0，录音棚 44.1kHz；自动挑一位 26～40 岁、北方口音的女声，
    也可以 speaker=SSB0xxx 指定；shift=2 升两个半音、音色一起变，听起来是另一个「人」）——训出来是「捞捞」智能体的专属声音，不是哪位老师的声音
  · 在「录声音和表情」里录的每一句（有讲稿，不用识别）
  · 导入的整段录音（手机录音机录的原文件）：先自动切成一句一句、语音识别出文字
步骤和 GPT-SoVITS 自己的训练界面一样：文字转音素 → 提取声音特征 → 训练 SoVITS（音色）→ 训练 GPT（说话的节奏和语气）
训完用新模型念 3 句试听（交上去，控制中心能听），能正常出声音才发布成「voice-老师名字」；老师端在「我的声音」里选就能用。
"""
# needs: gsv
import glob
import hashlib
import json
import re
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
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
MEMBER = str(p.get("voiceOf") or p.get("member") or "")
EXP = "laolao_" + hashlib.md5(MEMBER.encode("utf-8")).hexdigest()[:10]   # GPT-SoVITS 的实验名只用英文数字
files = t.get("files") or {}
texts = (t.get("extra") or {}).get("texts") or {}
t0 = time.time()
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", _CUDA_VISIBLE_DEVICES="0", CUDA_VISIBLE_DEVICES="0", hz="25hz", is_half=str(p.get("half", True)),
           PYTHONPATH=os.pathsep.join([GD, os.path.join(GD, "GPT_SoVITS")]))
# GPT-SoVITS 里的识别（funasr）、pydub 要在 PATH 里找 ffmpeg：整合包自带的那个所在的文件夹放到最前面（不然一直报「Couldn't find ffmpeg」）
_ffd = [os.path.dirname(x) for x in [G.get("ffmpeg") or ""] if x and os.path.isabs(x)]
ENV["PATH"] = os.pathsep.join(_ffd + [GD, os.path.join(GD, "runtime"), ENV.get("PATH", "")])


def exit_why(rc):
    """退出码说成人话：Windows 上程序直接崩掉（没有 Python 报错）一般是显存 / 内存不够或者显卡驱动出问题"""
    u = rc & 0xFFFFFFFF
    known = {0xC0000005: "程序崩了：访问内存出错，多半是显存不够或显卡驱动的问题", 0xC0000409: "程序崩了（0xC0000409），多半是显存不够",
             0xC00000FD: "程序崩了：栈溢出", 0xC0000017: "内存不够", 0xE06D7363: "程序崩了（C++ 异常）"}
    if u in known:
        return "%s，退出码 0x%08X" % (known[u], u)
    return "退出码 %d" % rc


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
    rc = pr.wait()
    if rc != 0:
        raise RuntimeError("%s失败（%s）：\n%s" % (label, exit_why(rc), "\n".join(tail[-10:])))


def secs(f):
    try:
        with wave.open(f) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0


def to_wav(src, dst, af=None):
    subprocess.run(FF + ["-y", "-v", "error", "-i", src] + (["-af", af] if af else []) + ["-ac", "1", "-ar", "32000", "-sample_fmt", "s16", dst], check=True, cwd=work)
    return dst


def shift_filter(src, semis):
    """升 / 降几个半音，音色（共振峰）一起变、语速不变：同一个人的声音变成另一个「人」——捞捞的专属声音不和原来那位撞声"""
    if not semis:
        return None
    try:
        with wave.open(src) as w:
            sr = w.getframerate()
    except Exception:
        sr = 44100
    k = 2 ** (float(semis) / 12.0)
    return "asetrate=%d,aresample=%d,atempo=%.6f" % (round(sr * k), sr, 1.0 / k)


# ---------------- 1. 数据 ----------------
wavs = os.path.join(work, "wavs")
os.makedirs(wavs, exist_ok=True)
lines = []
recs = sorted(k for k in files if k.startswith("rec") and k in texts)
for k in recs:
    w = to_wav(files[k], os.path.join(wavs, k + ".wav"))
    d = secs(w)
    if 0.8 <= d <= 20:
        lines.append((w, texts[k], d))
lg.log("录的句子：%d 句能用" % len(lines))

imps = sorted(k for k in files if k.startswith("imp"))
SV_PY = r'''
# 每一句算一个「是谁在说」的向量（GPT-SoVITS v2Pro 自带的 ERes2NetV2 说话人模型）
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


def keep_main_speaker(items):
    """讲课视频里有学生说话、别的老师插话：留下「说得最多的那个人」（老师本人），别人的句子扔掉"""
    svck = sorted(glob.glob(os.path.join(GD, "GPT_SoVITS", "pretrained_models", "sv", "*.ckpt")))
    if not svck or len(items) < 8 or not p.get("speakerFilter", True):
        lg.log("不过滤说话人（%s）" % ("整合包里没有说话人模型" if not svck else "句子太少" if len(items) < 8 else "关掉了"))
        return items, {}
    lst_, emb_ = os.path.join(work, "sv_in.json"), os.path.join(work, "sv_out.json")
    json.dump([x[0] for x in items], open(lst_, "w", encoding="utf-8"))
    sp = os.path.join(work, "lg_sv.py")
    open(sp, "w", encoding="utf-8").write(SV_PY)
    try:
        sh([PY, "-s", sp, lst_, emb_], label="认说话人")
        E = json.load(open(emb_, encoding="utf-8"))
    except Exception as e:
        lg.log("认说话人没成功，先不过滤：%s" % str(e)[-200:])
        return items, {}
    import numpy as np
    have = [x for x in items if x[0] in E]
    if len(have) < 8:
        return items, {}
    M = np.array([E[x[0]] for x in have], dtype=np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True) + 1e-8
    w = np.array([x[2] for x in have], dtype=np.float32)   # 按时长加权：老师说得最多
    c = (M * w[:, None]).sum(0)
    for _ in range(4):   # 往「说得最多的那个人」收：每次只用最像的 60% 重新算中心
        c /= np.linalg.norm(c) + 1e-8
        sims = M @ c
        top = sims >= np.quantile(sims, 0.4)
        c = (M[top] * w[top, None]).sum(0)
    c /= np.linalg.norm(c) + 1e-8
    sims = M @ c
    thr = float(p.get("svMin", max(0.45, float(np.median(sims[sims >= np.quantile(sims, 0.4)])) - 0.15)))
    kept = [x for x, s_ in zip(have, sims) if s_ >= thr]
    lg.log("认说话人：%d 句里 %d 句是老师本人（相似度门槛 %.2f），扔掉 %d 句（学生 / 别人 / 太吵）" % (len(have), len(kept), thr, len(have) - len(kept)))
    return kept, {x[0]: float(s_) for x, s_ in zip(have, sims)}


def text_ok(txt, d):
    """识别出来的文字靠不靠谱：太短、全是语气词、一个字重复好多遍、语速离谱的都不要"""
    import re
    t = re.sub(r"[\s，。！？、,.!?…：:；;“”\"'（）()]", "", txt)
    if len(t) < 3:
        return False
    if re.fullmatch(r"[嗯啊哦呃额唉诶哎呀吧呢嘛那个这个就是]+", t):
        return False
    if max(t.count(ch) for ch in set(t)) > max(6, len(t) * 0.4):
        return False
    rate = len(t) / max(d, 0.1)
    return 1.5 <= rate <= 9.5


_CN_DIGIT = dict(zip("0123456789", "零一二三四五六七八九"))
_WORDS = {}


def _anorm(t):
    """对齐用：只留汉字、英文单词、数字（数字一个一个换成汉字：2026 → 二零二六；一个英文单词算一个字）。
       返回（规整后的字串，每个字在原文里的 [起, 止)）"""
    out, spans = [], []
    t = str(t)
    for m in re.finditer(r"[A-Za-z]+|[0-9]|[\u4e00-\u9fff]", t):
        c = m.group(0)
        if c[0].isascii() and c[0].isalpha():
            c = _WORDS.setdefault(c.lower(), chr(0xE000 + len(_WORDS)))
        elif c in _CN_DIGIT:
            c = _CN_DIGIT[c]
        out.append(c)
        spans.append((m.start(), m.end()))
    return "".join(out), spans


def _semi(q, T):
    """q 在 T 里最像的一段（两头不算错）：返回（错几个字，起点，终点）"""
    n = len(T)
    prev, ps = [0] * (n + 1), list(range(n + 1))
    for i in range(1, len(q) + 1):
        cur, cs = [i] + [0] * n, [0] + [0] * n
        qc = q[i - 1]
        for j in range(1, n + 1):
            a, b, c = prev[j - 1] + (qc != T[j - 1]), prev[j] + 1, cur[j - 1] + 1
            if a <= b and a <= c:
                cur[j], cs[j] = a, ps[j - 1]
            elif b <= c:
                cur[j], cs[j] = b, ps[j]
            else:
                cur[j], cs[j] = c, cs[j - 1]
        prev, ps = cur, cs
    j = min(range(n + 1), key=lambda k: prev[k])
    return prev[j], ps[j], j


_PUNC = "，。！？、；：,.!?;:…"


def align_script(got, script):
    """照稿子念的录音（真人录音稿）：识别出来的字只用来找「念的是稿子里哪一段」，训练用的文字换成稿子原文
       （识别会听错字、数字会写成阿拉伯数字、英文会听成中文；稿子是对的）。对不上稿子的扔掉；同一句念了两遍的，留后面那遍（念错了才会重读）"""
    lines_ = [str(x).strip() for x in script if str(x).strip()]
    N = [_anorm(x) for x in lines_]
    # 每句里能停顿的地方（句首、句末、标点后面）：录音是在停顿处切开的，对出来的头尾离这些地方只差一两个字就靠过去
    cuts = []
    for k, (s_, sp) in enumerate(N):
        c = {0, len(s_)}
        for i in range(1, len(s_)):
            if any(ch in _PUNC for ch in lines_[k][sp[i - 1][1]:sp[i][0]]):
                c.add(i)
        cuts.append(sorted(c))
    bi = [set(a[k:k + 2] for k in range(len(a) - 1)) for a, _ in N]
    max_cer, snap = float(p.get("alignMaxCer", 0.3)), int(p.get("alignSnap", 2))
    keep, bad = [], 0
    for wp, txt, d in got:
        q, _ = _anorm(txt)
        if len(q) < 2:
            bad += 1
            continue
        qb = set(q[k:k + 2] for k in range(len(q) - 1)) or {q}
        top = sorted(range(len(lines_)), key=lambda i: -len(qb & bi[i]))[:3]
        best = None
        for i in top:
            lo, hi = max(0, i - 1), min(len(lines_), i + 2)   # 一段录音可能跨两句：带上前后各一句
            T, mp = "", []
            for k in range(lo, hi):
                T += N[k][0]
                mp += [(k, x) for x in range(len(N[k][0]))]
            e, s_, t_ = _semi(q, T)
            if t_ > s_ and (best is None or e < best[0]):
                best = (e, mp[s_], mp[t_ - 1])
        if not best or best[0] / float(len(q)) > max_cer:
            bad += 1
            continue
        (k0, i0), (k1, i1) = best[1], best[2]
        near = lambda k, i: min(cuts[k], key=lambda c: abs(c - i))
        if abs(near(k0, i0) - i0) <= snap and near(k0, i0) < len(N[k0][0]):
            i0 = near(k0, i0)
        if abs(near(k1, i1 + 1) - (i1 + 1)) <= snap and near(k1, i1 + 1) > 0:
            i1 = near(k1, i1 + 1) - 1
        if k0 == k1 and i1 < i0:
            bad += 1
            continue
        seg = []
        for k in range(k0, k1 + 1):
            a = N[k][1][i0][0] if k == k0 else 0
            b = N[k][1][i1][1] if k == k1 else len(lines_[k])
            if k == k1:   # 句末标点带上
                while b < len(lines_[k]) and lines_[k][b] in _PUNC + "”）)》":
                    b += 1
            seg.append(lines_[k][a:b])
        text = "".join(seg).strip(" ，、；：,;:")
        base = lambda k: sum(len(N[j][0]) for j in range(k))
        keep.append((wp, text, d, (base(k0) + i0, base(k1) + i1 + 1), best[0] / float(len(q))))

    # 念了两遍：同一个原文件里稿子同一段（重叠一半以上）留后念的那遍
    def order(x):
        b = os.path.basename(x[0])
        m = re.search(r"_(\d+)_(\d+)\.wav$", b)
        return (b[:m.start()] if m else b, int(m.group(1)) if m else 0)
    keep.sort(key=order)
    out, dup = [], 0
    for x in keep:
        src = order(x)[0]
        for y in list(out):
            if order(y)[0] != src:
                continue
            o = min(x[3][1], y[3][1]) - max(x[3][0], y[3][0])
            if o > 0.5 * min(x[3][1] - x[3][0], y[3][1] - y[3][0]):
                out.remove(y)
                dup += 1
        out.append(x)
    hit, a = set(), 0
    for k, (s_, _) in enumerate(N):
        if any(x[3][0] < a + len(s_) and x[3][1] > a for x in out):
            hit.add(k)
        a += len(s_)
    af_ = os.path.join(work, "align.tsv")   # 每段对上了哪句（控制中心能下载下来核对）
    with open(af_, "w", encoding="utf-8") as fh:
        fh.write("录音\t识别出来的\t训练用的（稿子原文）\t识别错字\n")
        for x in out:
            fh.write("%s\t%s\t%s\t%.0f%%\n" % (os.path.basename(x[0]), dict((g[0], g[1]) for g in got).get(x[0], ""), x[1], x[4] * 100))
    lg.output(af_)
    lg.log("对照录音稿：%d 段对上了稿子（文字换成稿子原文，平均识别错字 %.0f%%），%d 段对不上扔掉，%d 段是重读的（留了后念的那遍）；稿子 %d 句里念到了 %d 句"
           % (len(out), 100 * sum(x[4] for x in out) / max(len(out), 1), bad, dup, len(lines_), len(hit)))
    return [(x[0], x[1], x[2]) for x in out]


if imps:
    raw = os.path.join(work, "imp_raw")
    sliced = os.path.join(work, "imp_sliced")
    asr = os.path.join(work, "imp_asr")
    for d_ in (raw, sliced, asr):
        os.makedirs(d_, exist_ok=True)
    # 讲课视频 / 课堂录音：只要声音；轻度去噪（去掉空调、风扇这类持续的底噪和低频嗡嗡声），音量统一
    clean = p.get("clean", "highpass=f=70,afftdn=nf=-25,dynaudnorm=f=250:g=15")
    for i, k in enumerate(imps):
        lg.progress(0.02 + 0.03 * i / len(imps), "导入的录音 / 视频：取出声音、去噪（%d/%d）" % (i + 1, len(imps)))
        to_wav(files[k], os.path.join(raw, k + ".wav"), clean or None)
    raw_total = sum(secs(f) for f in glob.glob(os.path.join(raw, "*.wav")))
    lg.log("导入的录音 / 视频：一共 %.1f 分钟" % (raw_total / 60))
    lg.progress(0.05, "导入的录音：切成一句一句")
    sh([PY, "-s", os.path.join(GD, "tools", "slice_audio.py"), raw, sliced, "-34", "4000", "300", "10", "500", "0.9", "0.25", "0", "1"], label="切分")
    lg.progress(0.08, "导入的录音：识别文字（第一次要下识别模型）")
    _cmd = [PY, "-s", os.path.join(GD, "tools", "asr", "funasr_asr.py"), "-i", sliced, "-o", asr, "-s", "large", "-l", "zh"]
    try:
        sh(_cmd + ["-p", "float16"], label="识别")
    except RuntimeError as e:   # 显卡上识别不行（显存不够、驱动问题）：换 CPU 再识别一次
        lg.log("显卡上识别失败（%s），换 CPU 再识别一次" % str(e).split("\n")[0][:160])
        sh(_cmd + ["-p", "float32"], env=dict(ENV, CUDA_VISIBLE_DEVICES="", _CUDA_VISIBLE_DEVICES=""), label="识别（CPU）")
    got, bad_txt = [], 0
    for f in glob.glob(os.path.join(asr, "*.list")):
        with open(f, encoding="utf-8") as fh:
            for ln in fh:
                parts = ln.strip().split("|")
                if len(parts) >= 4 and parts[3].strip():
                    wp = parts[0] if os.path.isabs(parts[0]) else os.path.join(sliced, os.path.basename(parts[0]))
                    d = secs(wp)
                    if 1.0 <= d <= 15:
                        if text_ok(parts[3].strip(), d):
                            got.append((wp, parts[3].strip(), d))
                        else:
                            bad_txt += 1
    lg.log("识别出 %d 句能用，%d 句文字不靠谱扔掉" % (len(got), bad_txt))
    if p.get("script"):
        got = align_script(got, p["script"])
    lg.progress(0.1, "认出哪些句子是老师本人说的")
    got, sims = keep_main_speaker(got)
    # 挑最好的：最像老师本人的、3～12 秒的优先；太多了训练太慢，最多用 maxMinutes 分钟
    cap = float(p.get("maxMinutes", 60)) * 60
    got.sort(key=lambda x: (-(sims.get(x[0], 1.0)) - (0.05 if 3 <= x[2] <= 12 else 0)))
    acc, pick = 0.0, []
    for x in got:
        if acc >= cap:
            break
        pick.append(x)
        acc += x[2]
    lg.log("导入的录音里挑了 %d 句、%.1f 分钟用来训练" % (len(pick), acc / 60))
    lines += pick

# 网上公开的高质量录音：AISHELL-3（Apache-2.0）。按说话人一个一个文件夹，只下要用的那一位（约 20 分钟、100～200MB）
if p.get("openVoice") == "aishell3":
    import concurrent.futures
    import random
    import re
    bases = [x for x in str(p.get("openBase") or "").split(",") if x] or (["https://huggingface.co/datasets/AISHELL/AISHELL-3/resolve/main", "https://hf-mirror.com/datasets/AISHELL/AISHELL-3/resolve/main"] if lg.region() == "global" else ["https://hf-mirror.com/datasets/AISHELL/AISHELL-3/resolve/main", "https://huggingface.co/datasets/AISHELL/AISHELL-3/resolve/main"])

    import urllib.error

    def fetch(rel, dest, tries=5):
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            return dest
        err = None
        for k in range(tries):
            missing = 0
            for b in bases:
                try:
                    req = urllib.request.Request(b + "/" + rel, headers={"User-Agent": "laolao-grid"})
                    with urllib.request.urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as fh:
                        shutil.copyfileobj(r, fh)
                    os.replace(dest + ".part", dest)
                    return dest
                except urllib.error.HTTPError as e:
                    err = e
                    missing += e.code == 404
                except Exception as e:
                    err = e
            if missing:   # 连得上的地址说没有这个文件（连不上的那个，比如国内上不了 huggingface.co，不算）：再试也没用，马上跳过（不是网络问题）
                raise FileNotFoundError(rel)
            time.sleep(2 + k * 4)
        raise RuntimeError("下不了 %s：%s（hf-mirror / Hugging Face 连不稳；跑一次 Actions「AI 组件搬到国内存储」带上 voicedata，就从自己的存储下）" % (rel, err))

    # Hugging Face 上的 AISHELL-3 并不是每一句都有录音（content.txt 列了全部句子，wav 只传了一部分）：
    #   先问文件列表，只下真有的；以前照着 content.txt 一句句下，一大半是 404，「跳过一句」刷满日志，还可能被当成网络不行整轮失败
    def listed(rel_dir):
        for b in bases:
            m = re.match(r"(https?://[^/]+)/datasets/([^/]+/[^/]+)/resolve/([^/]+)/?$", b)
            if not m:
                continue
            try:
                got, url = set(), "%s/api/datasets/%s/tree/%s/%s" % (m.group(1), m.group(2), m.group(3), rel_dir)
                for _ in range(50):
                    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laolao-grid"}), timeout=30) as r:
                        arr = json.loads(r.read().decode("utf-8"))
                        link = r.headers.get("Link") or ""
                    got |= {str(x.get("path", "")).rstrip("/").rsplit("/", 1)[-1] for x in arr}
                    nx = re.search(r'<([^>]+)>;\s*rel="next"', link)
                    if not nx:
                        break
                    url = nx.group(1)
                return got
            except Exception:
                continue
        return None

    od = os.path.join(lg.cache_dir() if hasattr(lg, "cache_dir") else work, "aishell3-laolao")   # 跨任务留着：下一次就够了
    os.makedirs(od, exist_ok=True)
    # 先从自己的存储下打好的包（国内腾讯云 / 国外自己的 GitHub）：说明 + 选好的那一位的全部录音，一个文件
    pack = [m for m in lg.mirror(model="aishell3") if m.get("sources")]
    # 本机还没有包里的录音（没下过，或者以前是从 hf-mirror 一句句下的、只有零星几句）：下自己存储里的包
    if pack and (not os.path.exists(os.path.join(od, "pick.txt")) or sum(1 for f_ in os.listdir(od) if f_.endswith(".wav")) < int(p.get("minLocal", 60))):
        try:
            import tarfile
            tp = os.path.join(work, "aishell3.tar")
            lg.progress(0.02, "从自己的存储下公开录音（AISHELL-3）")
            lg.download(pack[0]["sources"], tp, "公开录音")
            with tarfile.open(tp) as tf:
                for m_ in tf.getmembers():
                    n_ = os.path.basename(m_.name)
                    if m_.isfile() and n_ and m_.name.startswith("aishell3/") and "/" not in m_.name[9:]:
                        with tf.extractfile(m_) as src_, open(os.path.join(od, n_), "wb") as dst_:
                            shutil.copyfileobj(src_, dst_)
            os.remove(tp)
            lg.log("公开录音从自己的存储下好了")
        except Exception as e:
            lg.log("自己的存储里的公开录音没下成（%s），改从 hf-mirror / Hugging Face 下" % e)
    if not p.get("speaker") and os.path.exists(os.path.join(od, "pick.txt")):
        p["speaker"] = open(os.path.join(od, "pick.txt"), encoding="utf-8").read().strip() or None
    lg.progress(0.02, "下载公开录音的说明（AISHELL-3）")
    info = {}
    with open(fetch("spk-info.txt", os.path.join(od, "spk-info.txt")), encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            a = ln.split()
            if len(a) >= 4 and a[0].startswith("SSB"):
                info[a[0]] = (a[1], a[2], a[3])
    utts = {}
    # 打碎（几个人混在一起）要全部人的句子表；自己存储里的包只带了挑中那一位的，所以另存一份全的
    with open(fetch("train/content.txt", os.path.join(od, "content-all.txt" if int(p.get("mix", 1)) > 1 else "content.txt")), encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            a = ln.split()
            if len(a) < 3 or not a[0].endswith(".wav"):
                continue
            txt = "".join(x for x in a[1:] if not re.search(r"[A-Za-z0-9%$]", x))
            if len(txt) >= 4:
                utts.setdefault(a[0][:7], []).append((a[0], txt))
    MIX = max(1, int(p.get("mix", 1)))
    spk = p.get("speaker")
    if MIX > 1:
        # 「打碎」：挑几位同性别、录音多的人，混在一起当成一个人训 —— 训出来的音色是几个人揉在一起的，不是其中任何一位
        want_g, want_age = p.get("gender", "male"), p.get("ages") or ["B", "C", "D"]
        # 先要指定年龄段的（默认 26 岁以上的成年人：声音稳），不够再用别的年龄段补
        cands = [s_ for s_ in utts if s_ in info and info[s_][1] == want_g]
        cands.sort(key=lambda s_: (info[s_][0] not in want_age, -len(utts[s_])))
        mixed, LOCAL = [], {}
        # 先用本机已经有的：声音底座的公开录音包（aishell3-base，80 位 × 40 句，下过一次就在缓存里），一句都不用再下
        #   （hf-mirror 上很多人的录音其实没传、文件列表又常常问不到：以前一句句试了 8 分钟，全是 404，0 句能用）
        bd = os.path.join(lg.cache_dir() if hasattr(lg, "cache_dir") else work, "aishell3-base", "train")
        if os.path.isdir(bd):
            btxt = {}
            try:
                for ln in open(os.path.join(bd, "content.txt"), encoding="utf-8", errors="replace"):
                    a_ = ln.split()
                    if len(a_) >= 3 and a_[0].endswith(".wav"):
                        t_ = "".join(x for x in a_[1:] if not re.search(r"[A-Za-z0-9%$]", x))
                        if len(t_) >= 4:
                            btxt[a_[0]] = t_
            except Exception:
                pass
            for s_ in sorted(os.listdir(bd)):
                d_ = os.path.join(bd, s_)
                if not os.path.isdir(d_) or s_ not in info or info[s_][1] != want_g:
                    continue
                rows_ = [(os.path.join(d_, f_), btxt.get(f_) or dict(utts.get(s_, [])).get(f_)) for f_ in sorted(os.listdir(d_)) if f_.endswith(".wav")]
                rows_ = [x for x in rows_ if x[1]]
                if len(rows_) >= int(p.get("minLocalPer", 20)):
                    LOCAL[s_] = rows_
            pick_ = sorted(LOCAL, key=lambda k: (info[k][0] not in want_age, -len(LOCAL[k])))[: max(MIX, int(p.get("localMix", 6)))]
            young_ = [k for k in pick_ if info[k][0] not in want_age]
            if young_:
                lg.log("本机包里 %s 年龄段的%s声不够，用了 %d 位别的年龄段的补（%s）" % ("/".join(want_age), "男" if want_g == "male" else "女", len(young_), "、".join(young_)))
            LOCAL = {k: LOCAL[k] for k in pick_}
            n_ = sum(len(v) for v in LOCAL.values())
            lg.log("本机的公开录音包里有 %d 位%s声、%d 句能直接用" % (len(LOCAL), "男" if want_g == "male" else "女", n_))
            adult_ = [k for k in LOCAL if info[k][0] in want_age]
            # 本机包里要的年龄段够人数：直接用；不够：先去网上找要的年龄段的人，网上也找不到再退回用本机包（年轻一点也凑合）
            LOCAL_ANY = dict(LOCAL) if len(LOCAL) >= 2 and n_ >= int(p.get("minLocalClips", 150)) else {}
            if LOCAL_ANY and (len(adult_) >= min(MIX, 3) or p.get("allowYoung")):
                mixed = [(k, None) for k in LOCAL]
            else:
                LOCAL = {}
        else:
            LOCAL_ANY = {}
        for s_ in ([] if mixed else cands[:40]):   # 要的年龄段排在前面，不够再往后补
            h_ = listed("train/wav/%s" % s_)
            if h_ is None:
                # 文件列表问不到：先试下 3 句，一句都没有就换人（别把几百句都试一遍）
                got_ = 0
                for r_ in utts[s_][:3]:
                    try:
                        fetch("train/wav/%s/%s" % (s_, r_[0]), os.path.join(od, r_[0]), tries=2)
                        got_ += 1
                    except Exception:
                        pass
                if not got_:
                    continue
            if h_ is None or len(h_) >= int(p.get("minClips", 120)):
                mixed.append((s_, h_))
            if len(mixed) >= MIX:
                break
        if len(mixed) < 2 and LOCAL_ANY:
            lg.log("网上没找到够 %d 位 %s 年龄段的%s声：退回用本机包里的（有几位年轻一点）" % (MIX, "/".join(want_age), "男" if want_g == "male" else "女"))
            LOCAL = LOCAL_ANY
            mixed = [(k, None) for k in LOCAL]
        if len(mixed) < 2:
            raise RuntimeError("AISHELL-3 里没找到够 %d 位录音多的%s声（网上的文件列表问不到，或者网络不行）" % (MIX, "男" if want_g == "male" else "女"))
        spk = mixed[0][0]
    if not spk:
        want_g, want_age = p.get("gender", "female"), p.get("ages") or ["C", "D"]
        cands = [s_ for s_ in utts if s_ in info and info[s_][1] == want_g and info[s_][0] in want_age and info[s_][2] == p.get("accent", "north")]
        cands = cands or [s_ for s_ in utts if s_ in info and info[s_][1] == want_g]
        if not cands:
            raise RuntimeError("AISHELL-3 里没找到合适的说话人")
        cands.sort(key=lambda s_: -len(utts[s_]))
        spk = cands[0]
        # 本机没有现成的包：挑一位网上真有足够录音的（按句子多少往下试几位）
        if not all(os.path.exists(os.path.join(od, r_[0])) for r_ in utts[spk][:5]):
            for s_ in cands[:12]:
                h_ = listed("train/wav/%s" % s_)
                if h_ is None or len(h_) >= int(p.get("minClips", 150)):
                    spk = s_
                    break
if p.get("openVoice") == "aishell3" and MIX > 1:
    # 每人一样多的句子（谁也不占大头），先都下下来
    per = int(p.get("maxClips", 600)) // len(mixed)
    raw_by = {}
    jobs = []
    for s_, h_ in ([] if LOCAL else mixed):
        rows_ = [r_ for r_ in utts[s_] if h_ is None or r_[0] in h_]
        random.Random(7).shuffle(rows_)
        raw_by[s_] = []
        jobs += [(s_, r_) for r_ in rows_[: per if h_ is not None else per * 2]]
    lg.log("打碎成捞捞自己的声音：%d 位%s声混在一起（%s），每人最多 %d 句" % (len(mixed), "男" if p.get("gender", "male") == "male" else "女", "、".join("%s %s" % (s_, "".join(info.get(s_, ("?", "?", "?"))[0::2])) for s_, _ in mixed), per))
    dn, bad, gone = [0], 0, 0

    def get1(job):
        s_, r_ = job
        src = fetch("train/wav/%s/%s" % (s_, r_[0]), os.path.join(od, r_[0]))
        dn[0] += 1
        if dn[0] % 25 == 0:
            lg.progress(0.02 + 0.06 * dn[0] / len(jobs), "下载公开录音：%d/%d 句" % (dn[0], len(jobs)))
        return s_, src, r_[1]

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for fut in [ex.submit(get1, j_) for j_ in jobs]:
            try:
                s_, src, txt = fut.result()
                if len(raw_by[s_]) < per:
                    raw_by[s_].append((src, txt))
            except FileNotFoundError:
                gone += 1
            except Exception as e:
                bad += 1
                if bad <= 5:
                    lg.log("跳过一句：%s" % str(e)[:160])
    if LOCAL:
        for s_, rows_ in LOCAL.items():
            raw_by[s_] = rows_[:per]
    if gone:
        lg.log("网上没有的 %d 句跳过了" % gone)
    if bad > (len(jobs) - gone) // 3:
        raise RuntimeError("公开录音下载失败太多（%d/%d 句）：网络不行，过会儿再试" % (bad, len(jobs)))
    if sum(len(v) for v in raw_by.values()) < 40:
        raise RuntimeError("几位%s声一共只拿到 %d 句录音（网上没有 %d 句、下载失败 %d 句）：不够训练" % ("男" if p.get("gender", "male") == "male" else "女", sum(len(v) for v in raw_by.values()), gone, bad))
    # 音高往中间拉：每个人的声音高低不一样，各自升 / 降几个半音对齐到大家的中间值（音色一起变，揉得更匀）
    #   再整体按 shift 挪（不挪也行：几个人揉在一起已经不是谁了）
    F0_PY = r'''
import json, sys, numpy as np, librosa
out = {}
for k, fs in json.load(open(sys.argv[1], encoding="utf-8")).items():
    v = []
    for f in fs[:12]:
        try:
            y, sr = librosa.load(f, sr=16000)
            f0, vo, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
            f0 = f0[~np.isnan(f0)]
            if len(f0):
                v.append(float(np.median(f0)))
        except Exception as e:
            print("跳过", f, e)
    out[k] = float(np.median(v)) if v else 0
json.dump(out, open(sys.argv[2], "w"))
'''
    f0p, f0i, f0o = os.path.join(work, "lg_f0.py"), os.path.join(work, "f0_in.json"), os.path.join(work, "f0_out.json")
    open(f0p, "w", encoding="utf-8").write(F0_PY)
    json.dump({k: [x[0] for x in v] for k, v in raw_by.items()}, open(f0i, "w", encoding="utf-8"))
    med = {}
    if p.get("pitchAlign", True):
        try:
            sh([PY, "-s", f0p, f0i, f0o], label="量音高")
            med = {k: v for k, v in json.load(open(f0o)).items() if v > 0}
        except Exception as e:
            lg.log("量音高没成，不对齐：%s" % str(e)[-200:])
    import math
    tgt = math.exp(sum(math.log(v) for v in med.values()) / len(med)) if med else 0
    if p.get("targetF0"):
        tgt = float(p["targetF0"])
    # 声音偏高的人先拿掉（原声太高的人往下挪多了会闷、不挪又显得嫩）：至少留 2 位
    if med and p.get("maxF0"):
        hi_ = [k for k, v in med.items() if v > float(p["maxF0"])]
        if hi_ and len(raw_by) - len(hi_) >= 2:
            for k in hi_:
                lg.log("%s 原来的音高 %.0f Hz，比要的（%s Hz 以下）高：不用" % (k, med[k], p["maxF0"]))
                raw_by.pop(k, None)
    # 往上挪会连共振峰一起抬高，声音变「嫩」、发傻：只往下挪（最多 upMax，默认 0.5 个半音），往下最多 downMax
    up_max, down_max = float(p.get("upMax", 0.5)), float(p.get("downMax", 3.0))
    for s_, items in raw_by.items():
        semis = (12 * math.log2(tgt / med[s_]) if tgt and s_ in med else 0) + float(p.get("shift", 0) or 0)
        semis = max(-down_max, min(up_max, semis))
        lg.log("%s：原来的音高 %s，%s" % (s_, ("%.0f Hz" % med[s_]) if s_ in med else "没量出来", ("挪 %+.1f 个半音" % semis) if abs(semis) >= 0.1 else "不挪"))
        for i, (src, txt) in enumerate(items):
            try:
                w = to_wav(src, os.path.join(wavs, "o_%s_%04d.wav" % (s_, i)), shift_filter(src, semis if abs(semis) >= 0.1 else 0))
                d = secs(w)
                if 0.8 <= d <= 20:
                    lines.append((w, txt, d))
            except Exception as e:
                lg.log("跳过一句：%s" % str(e)[:120])
    MIXED = {s_: [x[0] for x in v][:6] for s_, v in raw_by.items()}
    p["openVoice"] = "aishell3-mixed"   # 下面单人那一段不再走
else:
    MIXED = {}
if p.get("openVoice") == "aishell3":
    if spk not in utts:
        raise RuntimeError("AISHELL-3 训练集里没有 %s" % spk)
    rows = utts[spk]
    # 自己的存储里的包已经下好了（这一位的录音都在本机）：只用本机有的，一句都不再去 hf-mirror 下
    #   （以前按 content.txt 把这一位的句子全列出来，包里没有的那些再一句句去 hf-mirror 下，常常 SSL EOF、卡很久，甚至「失败太多」整轮失败）
    local = set(f_ for f_ in os.listdir(od) if f_.endswith(".wav") and os.path.getsize(os.path.join(od, f_)) > 0)
    mine = [r_ for r_ in rows if r_[0] in local]
    if len(mine) >= int(p.get("minLocal", 60)):
        rows, have = mine, local
        lg.log("公开录音全部用本机已经下好的（%d 句，来自自己的存储），不再连 hf-mirror" % len(rows))
    else:
        have = None if all(os.path.exists(os.path.join(od, r_[0])) for r_ in rows[:5]) else listed("train/wav/%s" % spk)
        if have is not None:
            rows = [r_ for r_ in rows if r_[0] in have]
    lg.log("用 AISHELL-3 的 %s（%s）：%d 句%s" % (spk, " ".join(info.get(spk, ("?", "?", "?"))), len(rows), "（网上真有录音的）" if have is not None else ""))
    random.Random(7).shuffle(rows)
    MAXC = int(p.get("maxClips", 600))
    rows = rows[: MAXC if have is not None else MAXC * 2]   # 问不到列表：多试一些，没有的马上跳过
    done_n = [0]

    def one(r):
        src = fetch("train/wav/%s/%s" % (spk, r[0]), os.path.join(od, r[0]))
        w = to_wav(src, os.path.join(wavs, "o_" + r[0]), shift_filter(src, p.get("shift", 0)))
        done_n[0] += 1
        if done_n[0] % 20 == 0:
            lg.progress(0.02 + 0.08 * done_n[0] / len(rows), "下载公开录音：%d/%d 句" % (done_n[0], len(rows)))
        return w, r[1], secs(w)

    bad, gone, got_open = 0, 0, []
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for fut in [ex.submit(one, r) for r in rows]:
            try:
                w, txt, d = fut.result()
                if 0.8 <= d <= 20:
                    got_open.append((w, txt, d))
            except FileNotFoundError:
                gone += 1                                   # 网上就没有这句：不算网络不行
            except Exception as e:
                bad += 1
                if bad <= 5:
                    lg.log("跳过一句：%s" % str(e)[:160])
    lines += got_open[:MAXC]
    if gone:
        lg.log("网上没有的 %d 句跳过了（AISHELL-3 在 Hugging Face 上只传了一部分录音）" % gone)
    if bad > 5:
        lg.log("还有 %d 句因为网络没下下来，跳过了" % (bad - 5))
    if bad > (len(rows) - gone) // 3:
        raise RuntimeError("公开录音下载失败太多（%d/%d 句）：网络不行，过会儿再试" % (bad, len(rows)))

total = sum(x[2] for x in lines)


def write_pool(items, who):
    """清洗好的句子打成一个数据包交上去（voicepool-*.tar：flac + 文字）：攒进「声音数据池」，训练所有老师共用的声音底座"""
    import tarfile
    if not items or p.get("pool", True) is False:
        return 0
    pd = os.path.join(work, "pool")
    os.makedirs(pd, exist_ok=True)
    rows = []
    for i, (w, txt, d) in enumerate(items):
        fn = "%05d.flac" % i
        try:
            subprocess.run(FF + ["-y", "-v", "error", "-i", w, "-c:a", "flac", os.path.join(pd, fn)], check=True, cwd=work)
        except Exception:
            continue
        rows.append("%s|%s|%s|%.2f" % (fn, who, txt.replace("|", " "), d))
    with open(os.path.join(pd, "list.tsv"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rows) + "\n")
    out = os.path.join(work, "voicepool-%s-%d.tar" % (EXP, int(time.time())))
    with tarfile.open(out, "w") as tf:
        for fn in os.listdir(pd):
            tf.add(os.path.join(pd, fn), arcname=fn)
    lg.output(out)
    lg.log("交给声音数据池：%d 句（%.1f 分钟）" % (len(rows), sum(x[2] for x in items) / 60))
    return len(rows)


# 这位老师自己的录音（不是公开录音）攒进声音数据池
pooled = write_pool(lines, MEMBER) if MEMBER and not str(p.get("openVoice") or "").startswith("aishell3") else 0
if p.get("poolOnly"):
    lg.done(skip="只整理了%s的录音交给声音数据池（%d 句），这次不训练" % (MEMBER, pooled), pooled=pooled)
    raise SystemExit(0)
lg.log("一共 %d 句、%.1f 分钟" % (len(lines), total / 60))
if total < float(p.get("minSeconds", 120)):
    lg.done(skip="%s的录音还不够（%.1f 分钟，至少要 %.0f 分钟）：多录几段再训" % (MEMBER, total / 60, float(p.get("minSeconds", 120)) / 60), seconds=round(total, 1))
    raise SystemExit(0)

lst = os.path.join(work, "train.list")
with open(lst, "w", encoding="utf-8") as f:
    for w, txt, _ in lines:
        f.write("%s|%s|zh|%s\n" % (w, EXP, txt.replace("|", " ")))

# ---------------- 2. 版本和预训练模型 ----------------
PM = os.path.join(GD, "GPT_SoVITS", "pretrained_models")


def first(*cands):
    for c in cands:
        hit = sorted(glob.glob(os.path.join(PM, c)))
        if hit:
            return hit[0]
    return None


VER = "v2Pro" if first("v2Pro/s2Gv2Pro.pth") else "v2"
s2G = first("v2Pro/s2Gv2Pro.pth") if VER == "v2Pro" else first("gsv-v2final-pretrained/s2G*.pth")
s2D = first("v2Pro/s2Dv2Pro.pth") if VER == "v2Pro" else first("gsv-v2final-pretrained/s2D*.pth")
s1 = first("gsv-v2final-pretrained/s1*.ckpt", "s1*.ckpt")
bert = first("chinese-roberta-wwm-ext-large")
hub = first("chinese-hubert-base")
sv = first("sv/*.ckpt")
cfg2 = os.path.join(GD, "GPT_SoVITS", "configs", "s2v2Pro.json" if VER == "v2Pro" else "s2.json")
cfg1 = os.path.join(GD, "GPT_SoVITS", "configs", "s1longer-v2.yaml")
miss = [n for n, v in [("s2G", s2G), ("s2D", s2D), ("s1", s1), ("bert", bert), ("hubert", hub)] if not v] + [n for n, v in [("s2 配置", cfg2), ("s1 配置", cfg1)] if not os.path.exists(v)]
if VER == "v2Pro" and not sv:
    miss.append("sv")
if miss:
    raise RuntimeError("GPT-SoVITS 整合包里缺：%s（版本 %s）" % ("、".join(miss), VER))
FROM = "official"
# 有「声音底座」（大家的录音一起训出来的，比官方的更像老师说话）：从它接着训；版本对不上就还用官方的
if files.get("m_gpt") and files.get("m_sovits"):
    try:
        bv = json.load(open(files["m_info"], encoding="utf-8")).get("version") if files.get("m_info") else None
    except Exception:
        bv = None
    if bv in (None, VER):
        s1, s2G = files["m_gpt"], files["m_sovits"]
        FROM = "voice-base"
        lg.log("从声音底座接着训（%s）" % (bv or "版本没写"))
    else:
        lg.log("声音底座是 %s 的，这台电脑的整合包是 %s：还用官方的预训练模型" % (bv, VER))
lg.log("GPT-SoVITS 版本：%s" % VER)

exp_dir = os.path.join(GD, "logs", EXP)
shutil.rmtree(exp_dir, ignore_errors=True)
os.makedirs(exp_dir, exist_ok=True)
base_env = dict(ENV, inp_text=lst, inp_wav_dir="", exp_name=EXP, i_part="0", all_parts="1", opt_dir=exp_dir, version=VER)
PD = os.path.join(GD, "GPT_SoVITS", "prepare_datasets")

# ---------------- 3. 预处理（和 GPT-SoVITS 训练界面的 1A 一样）----------------
lg.progress(0.12, "文字转音素")
sh([PY, "-s", os.path.join(PD, "1-get-text.py")], dict(base_env, bert_pretrained_dir=bert), "文字转音素")
lg.progress(0.18, "提取声音特征")
sh([PY, "-s", os.path.join(PD, "2-get-hubert-wav32k.py")], dict(base_env, cnhubert_base_dir=hub), "提取声音特征")
if VER == "v2Pro":
    sh([PY, "-s", os.path.join(PD, "2-get-sv.py")], dict(base_env, sv_path=sv), "提取音色特征")
sh([PY, "-s", os.path.join(PD, "3-get-semantic.py")], dict(base_env, pretrained_s2G=s2G, s2config_path=cfg2), "提取语义")


def merge(pattern, out, head=None):
    rows = [head] if head else []
    for f in sorted(glob.glob(os.path.join(exp_dir, pattern))):
        with open(f, encoding="utf-8") as fh:
            rows += [x for x in fh.read().strip("\n").split("\n") if x]
        os.remove(f)
    with open(os.path.join(exp_dir, out), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rows) + "\n")
    return len(rows) - (1 if head else 0)


n_txt = merge("2-name2text-*.txt", "2-name2text.txt")
n_sem = merge("6-name2semantic-*.tsv", "6-name2semantic.tsv", "item_name\tsemantic_audio")
lg.log("预处理好了：%d 句文字、%d 句语义" % (n_txt, n_sem))
if not n_txt or not n_sem:
    raise RuntimeError("预处理没出结果（看上面的日志）")

# ---------------- 4. 训练 ----------------
SW, GW = os.path.join(GD, "SoVITS_weights_" + VER), os.path.join(GD, "GPT_weights_" + VER)
os.makedirs(SW, exist_ok=True)
# GPT-SoVITS 存档的写法是「先存到当前文件夹的临时文件、再 shutil.move 过去」（utils.my_save）：目标文件夹不在就报
#   「FileNotFoundError: [WinError 3] 系统找不到指定的路径」。不同版本的整合包存档文件夹名不一样（logs_s2_v2Pro、带 LoRA 档位的……），
#   光靠事先建文件夹建不全 —— 直接给整合包里这几行补上「目标文件夹不在就先建」，哪个版本都管用（改过的有记号，不重复改；原文件留一份 .lls-orig）
def patch_pack():
    import re as _re
    n = 0
    for root, _, fs in os.walk(os.path.join(GD, "GPT_SoVITS")):
        for fn in fs:
            if not fn.endswith(".py"):
                continue
            fp = os.path.join(root, fn)
            try:
                src = open(fp, encoding="utf-8").read()
            except Exception:
                continue
            if "shutil.move(" not in src or "def my_save" not in src or "# lls: mkdir" in src:
                continue
            out = _re.sub(r"(?m)^([ \t]*)shutil\.move\(\s*([^,\n]+?)\s*,\s*(.+?)\)[ \t]*$",
                          lambda m: "%simport os as _lls_os; _lls_os.makedirs(_lls_os.path.dirname(_lls_os.path.abspath(%s)) or '.', exist_ok=True)  # lls: mkdir\n%s" % (m.group(1), m.group(3), m.group(0)), src)
            if out != src:
                if not os.path.exists(fp + ".lls-orig"):
                    shutil.copyfile(fp, fp + ".lls-orig")
                open(fp, "w", encoding="utf-8").write(out)
                n += 1
    lg.log("整合包存档函数：%s" % ("补上了「目标文件夹不在就先建」（%d 个文件）" % n if n else "已经补过 / 不用补"))


patch_pack()
# 念句子时分中英文用 fast-langdetect：它的缓存文件夹不在就直接报错（Cache directory not found …/fast_langdetect）
os.makedirs(os.path.join(GD, "GPT_SoVITS", "pretrained_models", "fast_langdetect"), exist_ok=True)
# 训练脚本存中间存档时直接往 exp_dir/logs_s2_<版本> 里挪（官方界面会先建好这个文件夹，命令行跑不会）：
#   没有这个文件夹就报「[WinError 3] 系统找不到指定的路径」（shutil.move ... save_checkpoint）。先都建好
for _d in ("logs_s2_" + VER, "logs_s2", "logs_s1_" + VER, "logs_s1"):
    os.makedirs(os.path.join(exp_dir, _d), exist_ok=True)
os.makedirs(GW, exist_ok=True)
e2, e1 = int(p.get("sovitsEpochs", 8)), int(p.get("gptEpochs", 15))
# 录音越多、训得越久越像（GPT-SoVITS 官方建议的范围里）：10 分钟以上 12/20 轮，30 分钟以上 16/25 轮
if total >= 1800:
    e2, e1 = max(e2, 16), max(e1, 25)
elif total >= 600:
    e2, e1 = max(e2, 12), max(e1, 20)
bs = int(p.get("batch", 4))
cfg_job = {"s2_in": cfg2, "s2_out": os.path.join(work, "tmp_s2.json"), "s1_in": cfg1, "s1_out": os.path.join(work, "tmp_s1.yaml"),
           "bs": bs, "e2": e2, "e1": e1, "s2G": s2G, "s2D": s2D, "s1": s1, "exp": EXP, "exp_dir": exp_dir, "ver": VER, "SW": SW, "GW": GW}
cj = os.path.join(work, "cfg.json")
with open(cj, "w", encoding="utf-8") as f:
    json.dump(cfg_job, f, ensure_ascii=False)
# 改配置用整合包自带的 Python（它有 yaml）
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
with open(mk, "w", encoding="utf-8") as f:
    f.write(MK)
sh([PY, "-s", mk, cj], label="写训练配置")
lg.progress(0.25, "训练音色（SoVITS，%d 轮）" % e2)
sh([PY, "-s", os.path.join(GD, "GPT_SoVITS", "s2_train.py"), "--config", cfg_job["s2_out"]], dict(ENV, version=VER), "训练音色")
lg.progress(0.6, "训练说话的节奏和语气（GPT，%d 轮）" % e1)
sh([PY, "-s", os.path.join(GD, "GPT_SoVITS", "s1_train.py"), "--config_file", cfg_job["s1_out"]], dict(ENV, version=VER), "训练语气")


def newest(d, pat):
    hit = sorted(glob.glob(os.path.join(d, pat)), key=os.path.getmtime)
    if not hit:
        raise RuntimeError("没找到训练好的模型：%s" % os.path.join(d, pat))
    return hit[-1]


sov = shutil.copyfile(newest(SW, EXP + "*.pth"), os.path.join(work, "voice-sovits.pth"))
gpt = shutil.copyfile(newest(GW, EXP + "*.ckpt"), os.path.join(work, "voice-gpt.ckpt"))

# ---------------- 5. 试听：用新模型念 3 句（和老师端一样走 api_v2）----------------
ref = max((x for x in lines if 3 <= x[2] <= 10), key=lambda x: x[2], default=None) or max(lines, key=lambda x: x[2])
# 真人照稿子念的：参考声音挑稿子里指定的几句（讲解的语气、完整一句、3～10 秒），挑不到再用最长的
for _want in p.get("refPick") or []:
    _hit = [x for x in lines if 3 <= x[2] <= 10 and _anorm(x[1])[0] == _anorm(_want)[0]]
    if _hit:
        ref = _hit[-1]
        lg.log("参考声音：用稿子里的「%s」（%.1f 秒）" % (ref[1], ref[2]))
        break
ref_wav = shutil.copyfile(ref[0], os.path.join(work, "voice-ref.wav"))
ref_txt = os.path.join(work, "voice-ref.txt")
with open(ref_txt, "w", encoding="utf-8") as f:
    f.write(ref[1])
s = socket.socket()
s.bind(("127.0.0.1", 0))
port = s.getsockname()[1]
s.close()
api = subprocess.Popen([PY, "-s", "api_v2.py", "-a", "127.0.0.1", "-p", str(port)], cwd=GD, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = "http://127.0.0.1:%d" % port
try:
    for _ in range(480):
        try:
            urllib.request.urlopen(base + "/docs", timeout=2).read(10)
            break
        except Exception:
            if api.poll() is not None:
                raise RuntimeError("试听用的 api_v2 没起来")
            time.sleep(0.5)
    for k, v in (("set_gpt_weights", gpt), ("set_sovits_weights", sov)):
        urllib.request.urlopen(base + "/%s?weights_path=%s" % (k, urllib.parse.quote(v)), timeout=300).read()
    def tts(txt, rw, rt, out):
        body = {"text": txt, "text_lang": "zh", "ref_audio_path": rw, "prompt_text": rt, "prompt_lang": "zh", "text_split_method": "cut5", "media_type": "wav",
                "speed_factor": float(p.get("speed", 1.0)), **{k: p[k] for k in ("temperature", "top_p", "top_k") if k in p}}
        req = urllib.request.Request(base + "/tts", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                b = r.read()
        except urllib.error.HTTPError as e:   # api_v2 念失败时回 400 + 原因（JSON）：把原因带出来，光说「400」查不了
            raise RuntimeError("HTTP %d：%s" % (e.code, e.read().decode("utf-8", "replace")[:600]))
        if b[:4] != b"RIFF" or len(b) <= 8000:
            return None
        open(out, "wb").write(b)
        return out

    # 打碎的声音：参考声音不能用原来那几位的录音（念出来会往那个人身上靠）。
    #   用新模型拿每位的录音各念一遍同一句话，再用说话人模型比一比：选「和原来哪一位都最不像」的那一句，当捞捞以后说话的参考声音
    if MIXED:
        lg.progress(0.82, "打碎：挑一句「谁都不像」的当捞捞的参考声音")
        RT = p.get("refText") or "这个问题其实不难，我们先把已知条件理清楚，再一步一步往下推。"
        cands = []
        for s_ in MIXED:
            src_ = [x for x in lines if os.path.basename(x[0]).startswith("o_%s_" % s_) and 3 <= x[2] <= 10]
            if not src_:
                continue
            for j_ in range(int(p.get("refTries", 2))):
                c_ = tts(RT, src_[j_ % len(src_)][0], src_[j_ % len(src_)][1], os.path.join(work, "refcand-%s-%d.wav" % (s_, j_)))
                # 念出来的长度要对得上字数（正常每秒 3～7 个字）：太短 = 吞字 / 念一半就停，这种不能当参考声音
                #   （以前补静音凑够 3 秒：参考声音只有半句、提示文字却是整句，对不上 → 后面念的全是乱的）
                n_ = len(re.sub(r"[^\u4e00-\u9fff]", "", RT))
                if c_:
                    d_ = secs(c_)
                    if not (3.0 <= d_ <= 10 and n_ / 7.5 <= d_ <= n_ / 2.0 + 1.0):
                        lg.log("参考句候选 %s：%.1f 秒（%d 个字），长度不对，不用" % (os.path.basename(c_), d_, n_))
                        continue
                    cands.append(c_)
        if not cands:
            # 新模型念不全一句话：退回用训练录音里的一句原声当参考（文字和声音一定对得上；会更像那一位，但至少不乱）
            src_ = sorted([x for x in lines if 4 <= x[2] <= 9], key=lambda x: -x[2])
            if not src_:
                raise RuntimeError("新模型念不全参考句，训练录音里也没有 4～9 秒的句子")
            lg.log("新模型念不全参考句（多半是录音太少、训得不稳）：先用训练录音里的原声 %s 当参考" % os.path.basename(src_[0][0]))
            cands, RT = [src_[0][0]], src_[0][1]
        pick, score = cands[0], None
        svck = sorted(glob.glob(os.path.join(GD, "GPT_SoVITS", "pretrained_models", "sv", "*.ckpt")))
        if svck:
            try:
                import numpy as np
                allf = cands + [f_ for v_ in MIXED.values() for f_ in v_]
                lst_, emb_ = os.path.join(work, "sv_in.json"), os.path.join(work, "sv_out.json")
                json.dump(allf, open(lst_, "w", encoding="utf-8"))
                open(os.path.join(work, "lg_sv.py"), "w", encoding="utf-8").write(SV_PY)
                sh([PY, "-s", os.path.join(work, "lg_sv.py"), lst_, emb_], label="比像不像")
                E = json.load(open(emb_, encoding="utf-8"))
                nv = lambda v: np.asarray(v, dtype=np.float32) / (np.linalg.norm(v) + 1e-8)
                cen = {s_: nv(np.mean([nv(E[f_]) for f_ in v_ if f_ in E], axis=0)) for s_, v_ in MIXED.items() if any(f_ in E for f_ in v_)}
                rows_ = []
                for c_ in cands:
                    if c_ in E:
                        sims = {s_: float(nv(E[c_]) @ cv) for s_, cv in cen.items()}
                        rows_.append((max(sims.values()), c_, sims))
                # 参考声音同时要「谁都不像」和「音高接近要的」（低沉稳重一点，不要尖）：
                #   分数 = 最像的那位的相似度 + 每偏离 1 个半音加 0.03
                cf0 = {}
                if tgt and p.get("pitchAlign", True):
                    try:
                        json.dump({c_: [c_] for c_ in cands}, open(f0i, "w", encoding="utf-8"))
                        sh([PY, "-s", f0p, f0i, f0o], label="量参考句的音高")
                        cf0 = {k: v for k, v in json.load(open(f0o)).items() if v > 0}
                    except Exception as e:
                        lg.log("量参考句的音高没成：%s" % str(e)[-160:])
                pen = lambda c_: (abs(12 * math.log2(cf0[c_] / tgt)) * 0.03) if c_ in cf0 else 0.0
                rows_.sort(key=lambda x: x[0] + pen(x[1]))
                if rows_ and rows_[0][1] in cf0:
                    lg.log("参考句的音高：%s" % "、".join("%s %.0f Hz" % (os.path.basename(k).split("-")[1], v) for k, v in sorted(cf0.items(), key=lambda kv: kv[1])))
                if rows_:
                    score, pick = rows_[0][0], rows_[0][1]
                    lg.log("参考声音：选了 %s，和原来几位的相似度 %s（越低越不像原来的人；同一个人一般在 0.7 以上）" % (os.path.basename(pick), "、".join("%s %.2f" % kv for kv in rows_[0][2].items())))
                    if score > float(p.get("maxSim", 0.75)):
                        lg.log("提醒：最不像的那句和 %s 还是有点像（%.2f）：可以多混几位（mix）或者整体挪一点音高（shift）再训" % (max(rows_[0][2], key=rows_[0][2].get), score))
            except Exception as e:
                lg.log("比像不像没成功，先用第一句：%s" % str(e)[-200:])
        shutil.copyfile(pick, ref_wav)
        ref = (ref_wav, RT, secs(ref_wav))
        with open(ref_txt, "w", encoding="utf-8") as f:
            f.write(RT)
    samples = p.get("samples") or ["同学们好，今天我们一起来学习新的内容。", "这道题我们一步一步来，先看已知条件。", "很好，你说得非常清楚，大家给他鼓鼓掌。"]
    ok = 0
    for k, txt in enumerate(samples):
        out = tts(txt, ref_wav, ref[1], os.path.join(work, "sample-%d.wav" % (k + 1)))
        if out:
            lg.output(out)
            ok += 1
    if ok < len(samples):
        raise RuntimeError("新模型念出来的声音不对（%d/%d 句正常）" % (ok, len(samples)))
finally:
    api.kill()

# ---------------- 6. 把关：试听句识别回文字，错字太多 = 念得乱，不发布 ----------------
#   （以前不考就发布：第 2 版念出来全是乱的，也直接发给了老师端）
def _norm(t):
    import re as _r
    return _r.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", str(t)).lower()


def _cer(a, b):
    a, b = _norm(a), _norm(b)
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1] / float(len(a))


gate_cer = None
if p.get("gate", True) and os.path.exists(os.path.join(GD, "tools", "asr", "funasr_asr.py")):
    sd = os.path.join(work, "samples_asr_in")
    os.makedirs(sd, exist_ok=True)
    for k in range(len(samples)):
        f_ = os.path.join(work, "sample-%d.wav" % (k + 1))
        if os.path.exists(f_):
            shutil.copyfile(f_, os.path.join(sd, "sample-%d.wav" % (k + 1)))
    so = os.path.join(work, "samples_asr_out")
    os.makedirs(so, exist_ok=True)
    try:
        lg.progress(0.92, "把关：试听句识别回文字，看念得对不对")
        _cmd = [PY, "-s", os.path.join(GD, "tools", "asr", "funasr_asr.py"), "-i", sd, "-o", so, "-s", "large", "-l", "zh"]
        try:
            sh(_cmd + ["-p", "float16"], label="识别试听句")
        except RuntimeError:   # 显卡上识别不行：换 CPU（几句话很快）
            sh(_cmd + ["-p", "float32"], env=dict(ENV, CUDA_VISIBLE_DEVICES="", _CUDA_VISIBLE_DEVICES=""), label="识别试听句（CPU）")
        heard = {}
        for f_ in glob.glob(os.path.join(so, "*.list")):
            for ln in open(f_, encoding="utf-8"):
                a_ = ln.rstrip("\n").split("|")
                if len(a_) >= 4:
                    heard[os.path.basename(a_[0])] = a_[3]
        errs = []
        for k, txt in enumerate(samples):
            h_ = heard.get("sample-%d.wav" % (k + 1), "")
            c_ = _cer(txt, h_)
            errs.append(c_)
            lg.log("试听 %d：错字率 %.0f%%｜要念：%s｜听成：%s" % (k + 1, c_ * 100, txt, h_ or "（什么都没听出来）"))
        gate_cer = sum(errs) / max(len(errs), 1)
        lg.metric(0, cer=gate_cer)
    except Exception as e:
        lg.log("把关的识别没成功（%s）：这次不发布，免得把念不好的声音发出去" % str(e)[-200:])
        raise RuntimeError("试听句没法识别，不确定念得对不对：不发布")
    if gate_cer > float(p.get("maxCer", 0.2)):
        raise RuntimeError("试听句平均错字率 %.0f%%（要 %.0f%% 以下）：念得不对，不发布。多半是录音太少或音高挪得太多；控制中心「试听」里能听到念成什么样" % (gate_cer * 100, float(p.get("maxCer", 0.2)) * 100))
    lg.log("把关通过：试听句平均错字率 %.0f%%" % (gate_cer * 100))
# 念的时候用的参数（老师端照这个念）：稍慢一点、采样收一点，听起来更稳
params_f = os.path.join(work, "voice-params.json")
with open(params_f, "w", encoding="utf-8") as f:
    json.dump({k: p[k] for k in ("speed", "temperature", "top_p", "top_k") if k in p}, f)
lg.done(gpt=gpt, sovits=sov, ref=ref_wav, reftext=ref_txt, params=params_f, version=VER, base=FROM, clips=len(lines), minutes=round(total / 60, 1), mins=round((time.time() - t0) / 60, 1))
