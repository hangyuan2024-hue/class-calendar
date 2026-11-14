"""捞捞答题 · 训练答题大脑（同事的 8G 显卡，QLoRA 轻量微调）
用「数据工厂」到现在为止核对过的所有讲解，微调老师端用的那个模型（通义千问 Qwen3-VL-4B-Instruct）：
  1. 底子按 4 位精度放进显卡，只训练很小的 LoRA（几十 MB），8G 显存够
  2. 训完转成 llama.cpp 的格式（老师端直接加载，不用换模型）
  3. 考试：同一套题（GSM8K 测试集里固定的 100 道，MIT 许可），原版考一次、带 LoRA 考一次
     → 答对率（acc）、用中文讲的比例（zh_rate）；不比原版差、比现在发布的好，才发布给老师端
要在新版客户端上跑（自带 llama.cpp）；第一次要下底子（约 9G，魔搭优先）和老师端用的量化模型（约 2.5G）。
"""
# needs: llm
# requires: transformers>=4.57,<5 peft>=0.17 bitsandbytes>=0.45 accelerate modelscope sentencepiece protobuf
import glob
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request

import lg

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()
CACHE = os.path.abspath(os.path.join(work, "..", "..", "cache"))
BASE_REPO = p.get("baseRepo", "Qwen/Qwen3-VL-4B-Instruct")
GGUF_REPO = p.get("ggufRepo", "Qwen/Qwen3-VL-4B-Instruct-GGUF")
SYSTEM = p.get("system") or ("你是一位耐心的中国中小学数学老师。讲题要一步一步来，每一步说清楚为什么这样做，用学生听得懂的话；"
                             "算式写清楚；最后一行写「答案：」并把最终答案放在 \\boxed{} 里。")
t0 = time.time()


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laolao-grid"}), timeout=timeout) as r:
        return r.read()


# ---------------- 1. 数据 ----------------
rows, seen = [], set()
for k, f in sorted((t.get("files") or {}).items()):
    if not k.startswith("data"):
        continue
    with open(f, encoding="utf-8") as fh:
        for line in fh:
            try:
                r = json.loads(line)
                q = r["messages"][1]["content"]
            except (ValueError, KeyError, IndexError):
                continue
            h = hashlib.md5((q + r["messages"][2]["content"][:50]).encode("utf-8")).hexdigest()
            if h not in seen:
                seen.add(h)
                rows.append(r["messages"])
lg.log("讲解：%d 条（去掉了重复的）" % len(rows))
if len(rows) < int(p.get("minExamples", 300)):
    lg.done(skip="讲解还不够（%d 条，要 %d 条），先攒着" % (len(rows), int(p.get("minExamples", 300))), examples=len(rows))
    raise SystemExit(0)
random.Random(0).shuffle(rows)
rows = rows[: int(p.get("maxExamples", 8000))]


# ---------------- 2. 底子（Hugging Face 格式，训练用）----------------
def base_dir():
    d = os.path.join(CACHE, "hf", BASE_REPO.replace("/", "__"))
    if os.path.exists(os.path.join(d, ".ok")):
        return d
    lg.progress(0.02, "下载底子 %s（第一次，约 9G）" % BASE_REPO)
    err = None
    try:   # 魔搭：国内快
        from modelscope import snapshot_download
        snapshot_download(BASE_REPO, local_dir=d)
    except Exception as e:
        err = e
        lg.log("魔搭下载不行（%s），换 hf-mirror" % str(e)[:120])
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        from huggingface_hub import snapshot_download as hf_dl
        hf_dl(BASE_REPO, local_dir=d)
    if not glob.glob(os.path.join(d, "*.safetensors")):
        raise RuntimeError("底子没下载下来：%s" % err)
    open(os.path.join(d, ".ok"), "w").close()
    return d


# 老师端用的量化模型（llama.cpp 格式，考试用）：先找国内存储清单里的那个，找不到再问 hf-mirror / 魔搭有哪些文件
def teacher_gguf():
    for u in ["https://www.laolaokechengbiao.cn/download/ai-mirror.json", "https://cdn.jsdelivr.net/gh/hangyuan2024-hue/class-calendar@main/download/ai-mirror.json"]:
        try:
            m = json.loads(get(u + "?t=%d" % time.time(), 20))
            hit = [v for v in (m.get("files") or {}).values() if v.get("model") == "llmMain" and str(v.get("url", "")).startswith("https://")]
            if hit:
                h = hit[0]
                return {"name": h["name"], "size": h.get("size") or 0, "urls": [h["url"]]}
        except Exception:
            pass
    names = []
    try:
        names = [x["rfilename"] for x in json.loads(get("https://hf-mirror.com/api/models/" + GGUF_REPO, 30)).get("siblings", [])]
    except Exception:
        try:
            names = [x["Path"] for x in json.loads(get("https://www.modelscope.cn/api/v1/models/%s/repo/files?Revision=master&Recursive=true" % GGUF_REPO, 30))["Data"]["Files"]]
        except Exception:
            pass
    pick = [n for n in names if n.endswith(".gguf") and "Q4_K_M" in n and "mmproj" not in n.lower()]
    if not pick:
        raise RuntimeError("找不到老师端用的量化模型文件")
    n = pick[0]
    return {"name": os.path.basename(n), "urls": ["https://www.modelscope.cn/models/%s/resolve/master/%s" % (GGUF_REPO, n), "https://hf-mirror.com/%s/resolve/main/%s" % (GGUF_REPO, n)]}


# ---------------- 3. 训练（QLoRA）----------------
def train(base):
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch 看不到显卡")
    lg.progress(0.08, "把底子放进显卡（4 位精度）")
    proc = AutoProcessor.from_pretrained(base)
    tok = proc.tokenizer
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForImageTextToText.from_pretrained(base, quantization_config=bnb, device_map={"": 0}, torch_dtype=torch.bfloat16)
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True, gradient_checkpointing_kwargs={"use_reentrant": False})
    cfg = LoraConfig(r=int(p.get("rank", 16)), lora_alpha=int(p.get("alpha", 32)), lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
                     target_modules=r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)")
    model = get_peft_model(model, cfg)
    n_train = sum(x.numel() for x in model.parameters() if x.requires_grad)
    lg.log("要训练的参数：%.1f M（底子 4B 不动）" % (n_train / 1e6))

    def as_msgs(ms):
        return [{"role": m["role"], "content": [{"type": "text", "text": m["content"]}]} for m in ms]

    max_len = int(p.get("maxLen", 1024))
    data = []
    for ms in rows:
        full = proc.apply_chat_template(as_msgs(ms), tokenize=False, add_generation_prompt=False)
        head = proc.apply_chat_template(as_msgs(ms[:-1]), tokenize=False, add_generation_prompt=True)
        ids = tok(full, add_special_tokens=False)["input_ids"][:max_len]
        n_head = len(tok(head, add_special_tokens=False)["input_ids"])
        if n_head >= len(ids) - 4:
            continue
        labels = [-100] * n_head + ids[n_head:]
        data.append((ids, labels))
    lg.log("能用的：%d 条（太长的截到 %d 个字）" % (len(data), max_len))

    epochs, accum = int(p.get("epochs", 2)), int(p.get("accum", 16))
    steps = max(1, (len(data) * epochs) // accum)
    opt = torch.optim.AdamW([x for x in model.parameters() if x.requires_grad], lr=float(p.get("lr", 1e-4)), weight_decay=0.0)
    warm = max(1, steps // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * max(0.1, 0.5 * (1 + __import__("math").cos(3.14159 * min(1.0, s / steps)))))
    model.train()
    step, run_loss, n_tok, t1 = 0, 0.0, 0, time.time()
    for ep in range(epochs):
        random.Random(ep).shuffle(data)
        for k, (ids, labels) in enumerate(data):
            x = torch.tensor([ids], device="cuda")
            y = torch.tensor([labels], device="cuda")
            with torch.autocast("cuda", dtype=torch.bfloat16):
                loss = model(input_ids=x, labels=y).loss / accum
            loss.backward()
            run_loss += loss.item()
            n_tok += len(ids)
            if (k + 1) % accum == 0:
                torch.nn.utils.clip_grad_norm_([x for x in model.parameters() if x.requires_grad], 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                lg.metric(step, loss=run_loss, tok_s=n_tok / max(time.time() - t1, 1e-6))
                lg.progress(0.1 + 0.6 * step / steps, "训练：第 %d/%d 步（每秒 %d 字）" % (step, steps, n_tok / max(time.time() - t1, 1e-6)))
                run_loss = 0.0
    out = os.path.join(work, "peft")
    model.save_pretrained(out)
    del model
    torch.cuda.empty_cache()
    return out


# ---------------- 4. 转成 llama.cpp 的格式（老师端直接加载）----------------
def converter():
    """llama.cpp 的 LoRA 转换脚本：①客户端自带的（和 llama-server 同一版，不用联网）②下过的 ③从镜像下源码（GitHub 在国内常常连不上）"""
    info = lg.llm("info") or {}
    if info.get("convert") and os.path.exists(os.path.join(info["convert"], "convert_lora_to_gguf.py")):
        lg.log("用客户端自带的 llama.cpp 转换脚本（%s）" % (info.get("version") or "?"))
        return info["convert"]
    ver = (info.get("version") or "").strip()
    m = re.fullmatch(r"b(\d+)", ver)
    tag = ver if m and int(m.group(1)) >= 1000 else "master"   # 「b1」这种是没认出版本号
    src = os.path.join(CACHE, "llama-src-" + tag)
    if not os.path.exists(os.path.join(src, "convert_lora_to_gguf.py")):
        lg.progress(0.02, "下载 llama.cpp 的转换脚本（%s）" % tag)
        ref = ("refs/tags/" + tag) if tag != "master" else "refs/heads/master"
        tgz = os.path.join(CACHE, "llama-%s.tar.gz" % tag)
        err = None
        gh = "https://github.com/ggml-org/llama.cpp/archive/%s.tar.gz" % ref
        for u in [x + gh for x in ("https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/", "https://gh.llkk.cc/", "")]:
            try:
                lg.download(u, tgz)
                break
            except Exception as e:
                err = e
        if not os.path.exists(tgz):
            raise RuntimeError("llama.cpp 转换脚本下载失败（客户端更新到最新版就自带了，不用下）：%s" % err)
        tmp = src + ".tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        with tarfile.open(tgz) as tf:
            want = [m for m in tf.getmembers() if re.search(r"^[^/]+/([^/]+\.py|gguf-py/.*)$", m.name) and ".." not in m.name]
            tf.extractall(tmp, members=want)
        top = os.path.join(tmp, os.listdir(tmp)[0])
        os.replace(top, src)
        shutil.rmtree(tmp, ignore_errors=True)
        os.remove(tgz)
    return src


def to_gguf(base, adir, src):
    out = os.path.join(work, "qa-lora.gguf")
    env = dict(os.environ, PYTHONPATH=os.path.join(src, "gguf-py") + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONIOENCODING="utf-8")
    r = subprocess.run([sys.executable, os.path.join(src, "convert_lora_to_gguf.py"), "--base", base, "--outtype", "f16", "--outfile", out, adir],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError("转格式失败：" + (r.stderr or r.stdout)[-600:])
    return out


# ---------------- 5. 考试 ----------------
def boxed(s):
    k = s.rfind("\\boxed{")
    if k < 0:
        m = re.findall(r"答案[:：]\s*([^\n]+)", s)
        return m[-1].strip() if m else None
    k += 7
    depth, out = 1, []
    while k < len(s) and depth:
        depth += s[k] == "{"
        depth -= s[k] == "}"
        if depth:
            out.append(s[k])
        k += 1
    return "".join(out)


def num(a):
    if a is None:
        return None
    a = re.sub(r"[^\d.\-/]", "", str(a).replace(",", ""))
    try:
        if "/" in a:
            x, y = a.split("/", 1)
            return round(float(x) / float(y), 6)
        return round(float(a), 6)
    except (ValueError, ZeroDivisionError):
        return None


def exam_set():
    f = os.path.join(CACHE, "gsm8k-test.jsonl")
    if not os.path.exists(f):
        for u in p.get("evalUrls") or ["https://cdn.jsdelivr.net/gh/openai/grade-school-math@master/grade_school_math/data/test.jsonl",
                                       "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl"]:
            try:
                lg.download(u, f)
                break
            except Exception:
                pass
    with open(f, encoding="utf-8") as fh:
        qs = [json.loads(x) for x in fh if x.strip()]
    random.Random(12345).shuffle(qs)   # 固定的一套题：每次考的都一样，分数才能比
    return [(q["question"], num(q["answer"].split("####")[-1])) for q in qs[: int(p.get("evalN", 100))]]


def exam(url, qs, label):
    right, zh, done = [0], [0], [0]
    lock = threading.Lock()
    todo = list(qs)

    def ask(q):
        body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q + "\n（请用中文讲解）"}], "temperature": 0, "max_tokens": 1200}
        req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode("utf-8"))["choices"][0]["message"].get("content") or ""

    def work_():
        while True:
            with lock:
                if not todo:
                    return
                q, ref = todo.pop()
            try:
                s = ask(q)
            except Exception:
                s = ""
            with lock:
                done[0] += 1
                right[0] += num(boxed(s)) == ref and ref is not None
                zh[0] += len(re.findall(r"[一-鿿]", s)) > len(s) * 0.15
                if done[0] % 10 == 0:
                    lg.log("%s：考了 %d/%d 道" % (label, done[0], len(qs)))

    ths = [threading.Thread(target=work_) for _ in range(2)]
    for x in ths:
        x.start()
    for x in ths:
        x.join()
    return right[0] / len(qs), zh[0] / len(qs)


# ---------------- 开始 ----------------
lg.llm("stop")   # 训练要整块显卡
if p.get("dryRun"):   # 测试用：不真的训练（没有显卡的电脑上检查数据、转交、考试、发布这些环节）
    adir = os.path.join(work, "peft")
    os.makedirs(adir, exist_ok=True)
    open(os.path.join(adir, "adapter_config.json"), "w").write("{}")
    gguf = os.path.join(work, "qa-lora.gguf")
    open(gguf, "wb").write(b"GGUF" + b"\0" * 60)
else:
    conv = converter()   # 先准备好转换脚本：下不来就别白训两个小时
    base = base_dir()
    adir = train(base)
    gguf = to_gguf(base, adir, conv)
spec = dict(p.get("evalLlm") or teacher_gguf(), ctx=int(p.get("evalCtx", 8192)), slots=2)
qs = exam_set()
lg.progress(0.8, "考试：原版")
acc0, zh0 = exam(lg.llm("start", llm=spec)["url"], qs, "原版")
lg.progress(0.9, "考试：带上新训的 LoRA")
acc1, zh1 = exam(lg.llm("start", llm=spec, lora=gguf)["url"], qs, "新训的")
lg.llm("stop")
lg.log("答对率：原版 %.0f%% → 新训的 %.0f%%；用中文讲：%.0f%% → %.0f%%" % (acc0 * 100, acc1 * 100, zh0 * 100, zh1 * 100))
zf = shutil.make_archive(os.path.join(work, "qa-lora-peft"), "zip", adir)
lg.done(lora=gguf, peft=zf, acc=round(acc1, 4), base_acc=round(acc0, 4), zh_rate=round(zh1, 4), base_zh_rate=round(zh0, 4),
        examples=len(rows), mins=round((time.time() - t0) / 60, 1))
