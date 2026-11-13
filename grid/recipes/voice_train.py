"""捞捞声音 · 训练一位老师的声音（GPT-SoVITS 微调，同事的显卡 6G 以上就行，一次 20～60 分钟）
用这位老师的数据：
  · 在「录声音和表情」里录的每一句（有讲稿，不用识别）
  · 导入的整段录音（手机录音机录的原文件）：先自动切成一句一句、语音识别出文字
步骤和 GPT-SoVITS 自己的训练界面一样：文字转音素 → 提取声音特征 → 训练 SoVITS（音色）→ 训练 GPT（说话的节奏和语气）
训完用新模型念 3 句试听（交上去，控制中心能听），能正常出声音才发布成「voice-老师名字」；老师端在「我的声音」里选就能用。
"""
# needs: gsv
import glob
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
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
MEMBER = str(p.get("voiceOf") or "")
EXP = "laolao_" + hashlib.md5(MEMBER.encode("utf-8")).hexdigest()[:10]   # GPT-SoVITS 的实验名只用英文数字
files = t.get("files") or {}
texts = (t.get("extra") or {}).get("texts") or {}
t0 = time.time()
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", _CUDA_VISIBLE_DEVICES="0", CUDA_VISIBLE_DEVICES="0", hz="25hz", is_half=str(p.get("half", True)),
           PYTHONPATH=os.pathsep.join([GD, os.path.join(GD, "GPT_SoVITS")]))


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
if imps:
    raw = os.path.join(work, "imp_raw")
    sliced = os.path.join(work, "imp_sliced")
    asr = os.path.join(work, "imp_asr")
    for d_ in (raw, sliced, asr):
        os.makedirs(d_, exist_ok=True)
    for k in imps:
        to_wav(files[k], os.path.join(raw, k + ".wav"))
    lg.progress(0.05, "导入的录音：切成一句一句")
    sh([PY, "-s", os.path.join(GD, "tools", "slice_audio.py"), raw, sliced, "-34", "4000", "300", "10", "500", "0.9", "0.25", "0", "1"], label="切分")
    lg.progress(0.08, "导入的录音：识别文字（第一次要下识别模型）")
    sh([PY, "-s", os.path.join(GD, "tools", "asr", "funasr_asr.py"), "-i", sliced, "-o", asr, "-s", "large", "-l", "zh", "-p", "float16"], label="识别")
    for f in glob.glob(os.path.join(asr, "*.list")):
        with open(f, encoding="utf-8") as fh:
            for ln in fh:
                parts = ln.strip().split("|")
                if len(parts) >= 4 and parts[3].strip():
                    wp = parts[0] if os.path.isabs(parts[0]) else os.path.join(sliced, os.path.basename(parts[0]))
                    d = secs(wp)
                    if 0.8 <= d <= 20:
                        lines.append((wp, parts[3].strip(), d))
total = sum(x[2] for x in lines)
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
os.makedirs(GW, exist_ok=True)
e2, e1 = int(p.get("sovitsEpochs", 8)), int(p.get("gptEpochs", 15))
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
    samples = p.get("samples") or ["同学们好，今天我们一起来学习新的内容。", "这道题我们一步一步来，先看已知条件。", "很好，你说得非常清楚，大家给他鼓鼓掌。"]
    ok = 0
    for k, txt in enumerate(samples):
        body = {"text": txt, "text_lang": "zh", "ref_audio_path": ref_wav, "prompt_text": ref[1], "prompt_lang": "zh", "text_split_method": "cut5", "media_type": "wav"}
        req = urllib.request.Request(base + "/tts", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            b = r.read()
        if b[:4] == b"RIFF" and len(b) > 8000:
            out = os.path.join(work, "sample-%d.wav" % (k + 1))
            open(out, "wb").write(b)
            lg.output(out)
            ok += 1
    if ok < len(samples):
        raise RuntimeError("新模型念出来的声音不对（%d/%d 句正常）" % (ok, len(samples)))
finally:
    api.kill()
lg.done(gpt=gpt, sovits=sov, ref=ref_wav, reftext=ref_txt, version=VER, clips=len(lines), minutes=round(total / 60, 1), mins=round((time.time() - t0) / 60, 1))
