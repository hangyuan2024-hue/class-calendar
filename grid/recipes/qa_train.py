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
    # ① 组件镜像（国内：自己的腾讯云存储；国外：自己的 GitHub）：整个文件夹都在才用
    try:
        fs_ = lg.mirror(model="qaBase") if BASE_REPO == "Qwen/Qwen3-VL-4B-Instruct" else []
        if fs_ and any(x["name"].endswith(".safetensors") for x in fs_):
            os.makedirs(d, exist_ok=True)
            for i, x in enumerate(fs_):
                lg.progress(0.02 + 0.05 * i / len(fs_), "从组件镜像下载底子：%s" % x["name"])
                lg.download(x["sources"], os.path.join(d, x["name"]), "下载 %s" % x["name"])
    except Exception as e:
        err = e
        lg.log("组件镜像里的底子下不了（%s），换魔搭 / Hugging Face" % str(e)[:160])
    if not glob.glob(os.path.join(d, "*.safetensors")):
        def ms():
            from modelscope import snapshot_download
            snapshot_download(BASE_REPO, local_dir=d)

        def hf(endpoint):
            os.environ["HF_ENDPOINT"] = endpoint
            from huggingface_hub import snapshot_download as hf_dl
            hf_dl(BASE_REPO, local_dir=d)
        # ② 国内：魔搭 → hf-mirror；国外：Hugging Face 官方 → 魔搭
        order = [lambda: hf("https://huggingface.co"), ms] if lg.region() == "global" else [ms, lambda: hf("https://hf-mirror.com")]
        for fn in order:
            try:
                fn()
                if glob.glob(os.path.join(d, "*.safetensors")):
                    break
            except Exception as e:
                err = e
                lg.log("这个源下载不行（%s），换下一个" % str(e)[:120])
    if not glob.glob(os.path.join(d, "*.safetensors")):
        raise RuntimeError("底子没下载下来：%s" % err)
    open(os.path.join(d, ".ok"), "w").close()
    return d


# 老师端用的量化模型（llama.cpp 格式，考试用）：先找国内存储清单里的那个，找不到再问 hf-mirror / 魔搭有哪些文件
def teacher_gguf():
    try:   # 组件镜像（国内腾讯云 / 国外自己的 GitHub，已经按地区排好；GitHub 上切块的 llama.cpp 不认，只用整个文件的地址）
        hit = lg.mirror(model="llmMain")
        if hit:
            h = hit[0]
            urls = [s for s in h["sources"] if isinstance(s, str)]
            if urls:
                return {"name": h["name"], "size": h.get("size") or 0, "urls": urls}
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
    # 显存：只用现在真正空着的。被别的程序占掉太多就不在这台电脑上训（硬训会溢出到共享内存，一步要几十分钟）
    unfit = getattr(lg, "unfit", lambda why: None)        # 旧版客户端的 lg 没有这两个：自己顶上
    if hasattr(lg, "gpu_guard"):
        free_g, total_g = lg.gpu_guard()
    else:
        fr, tt = torch.cuda.mem_get_info()
        torch.cuda.set_per_process_memory_fraction(max(0.3, min(0.98, (fr - 2 ** 29) / tt)))
        free_g, total_g = fr / 2 ** 30, tt / 2 ** 30
    lg.log("显存：一共 %.1fG，现在空着 %.1fG%s" % (total_g, free_g, "（别的程序占了 %.1fG）" % (total_g - free_g) if total_g - free_g > 0.8 else ""))
    need_g = float(p.get("needVram", 5.5))
    if free_g < need_g:
        why = "显存只空着 %.1fG（训练要 %.1fG 左右，别的程序占了 %.1fG）：关掉占显存的程序（游戏、浏览器里的视频、别的 AI 软件）再算" % (free_g, need_g, total_g - free_g)
        unfit(why)
        raise RuntimeError(why)
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
    # 存档：每隔 ckptMin 分钟存一次（LoRA 的参数 + 优化器 + 训到哪了），训完也存一次。
    # 中途停了（同事要用电脑、断网、重开软件、换电脑），下次从最近的存档接着训，不从头来。
    trainable = [(n, x) for n, x in model.named_parameters() if x.requires_grad]
    fp = hashlib.md5(json.dumps([len(data), epochs, accum, int(p.get("rank", 16)), max_len, [d[0][:16] for d in data[:3]], len(trainable)]).encode("utf-8")).hexdigest()
    ckpt_min = float(p.get("ckptMin", 20))

    def save_ck(ep, k, step):
        f = os.path.join(work, "ckpt-%d.pt" % step)
        torch.save({"fp": fp, "lora": {n: x.detach().to("cpu") for n, x in trainable}, "opt": opt.state_dict(), "sched": sched.state_dict(), "ep": ep, "k": k, "step": step}, f)
        lg.checkpoint(f, step)

    start_ep, start_k, step = 0, 0, 0
    if t.get("resume"):
        try:
            ck = torch.load(t["resume"], map_location="cpu")
            if ck.get("fp") == fp:
                with torch.no_grad():
                    for n, x in trainable:
                        x.copy_(ck["lora"][n].to(x.device, x.dtype))
                opt.load_state_dict(ck["opt"])
                sched.load_state_dict(ck["sched"])
                start_ep, start_k, step = int(ck["ep"]), int(ck["k"]), int(ck["step"])
                lg.log("从第 %d/%d 步的存档接着训练（不用从头来）" % (step, steps) if start_ep < epochs else "存档里已经训完了：直接转格式、考试")
            else:
                lg.log("存档和这次的数据对不上，从头训练")
        except Exception as e:
            lg.log("存档读不了（%s），从头训练" % str(e)[:160])

    model.train()
    run_loss, n_tok, t1, last_ck = 0.0, 0, time.time(), time.time()
    OOM = getattr(torch, "OutOfMemoryError", None) or torch.cuda.OutOfMemoryError
    cap, n_oom, n_skip = max_len, 0, 0          # 显存不够时把最长的讲解截短一点再来
    w_tok, w_t, slow, speeds = 0, time.time(), 0, []
    slow_tok = float(p.get("slowTok", 40))      # 每秒不到这么多字 = 慢得不正常（8G 显卡正常是几百）
    order0 = list(data)
    for ep in range(start_ep, epochs):
        order = list(order0)
        random.Random(ep).shuffle(order)   # 每一轮的顺序只由轮数决定：接着训的时候知道训到哪条了
        for k in range(start_k if ep == start_ep else 0, len(order)):
            ids, labels = order[k]
            lv = None
            while True:
                if len(ids) > cap:
                    ids, labels = ids[:cap], labels[:cap]
                if sum(1 for v in labels if v != -100) < 4:      # 截短以后没剩下要学的字：这条跳过
                    n_skip += 1
                    break
                try:
                    x = torch.tensor([ids], device="cuda")
                    y = torch.tensor([labels], device="cuda")
                    with torch.autocast("cuda", dtype=torch.bfloat16):
                        loss = model(input_ids=x, labels=y).loss / accum
                    loss.backward()
                    lv = loss.item()
                    break
                except OOM:
                    x = y = loss = None
                    torch.cuda.empty_cache()
                    n_oom += 1
                    if min(cap, len(ids)) <= 256:
                        why = "显存不够：256 个字的讲解都放不下（别的程序占着显存）。关掉占显存的程序再算"
                        unfit(why)
                        raise RuntimeError(why)
                    cap = max(256, int(min(cap, len(ids)) * 0.8))
                    lg.log("显存不够：这之后最长的讲解截到 %d 个字再训（不会溢出到共享内存拖慢几十倍）" % cap)
            if lv is None:
                continue
            run_loss += lv
            n_tok += len(ids)
            w_tok += len(ids)
            # 一步（16 条）10 分钟还没走完：不等了（正常一步是几十秒）
            el = time.time() - w_t
            if el > float(p.get("slowSecs", 600)) and w_tok / el < slow_tok:
                if step > 0 and (k + 1) % accum == 0:
                    save_ck(ep, k + 1, step)
                fr, tt = [v / 2 ** 30 for v in torch.cuda.mem_get_info()]
                why = ("这台电脑训练慢得不正常（每秒 %d 字，正常是几百；显存空着 %.1f/%.1fG）：换别的电脑接着训。"
                       "这台电脑请插上电源、把电源模式调到「最佳性能」、关掉占显卡的程序" % (w_tok / el, fr, tt))
                unfit(why)
                raise RuntimeError(why)
            if (k + 1) % accum == 0:
                torch.nn.utils.clip_grad_norm_([x for x in model.parameters() if x.requires_grad], 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                sp = w_tok / max(time.time() - w_t, 1e-6)       # 这一步的速度（不是从头算的平均）
                speeds = (speeds + [sp])[-20:]
                left_h = (steps - step) * (time.time() - w_t) / 3600.0
                w_tok, w_t = 0, time.time()
                lg.metric(step, loss=run_loss, tok_s=sp)
                lg.progress(0.1 + 0.6 * step / steps, "训练：第 %d/%d 步（每秒 %d 字，还要 %s）" % (step, steps, sp, ("%.1f 小时" % left_h) if left_h >= 1 else ("%d 分钟" % max(1, left_h * 60))))
                run_loss = 0.0
                # 慢得不正常（显存溢出到共享内存、电脑在省电模式、显卡被别的程序占着）：别在这台电脑上空耗几天
                slow = slow + 1 if sp < slow_tok else 0
                if slow == 2:
                    fr, tt = [v / 2 ** 30 for v in torch.cuda.mem_get_info()]
                    lg.log("训练慢得不正常：每秒只有 %d 字（正常是几百）。显存空着 %.1f/%.1fG。常见原因：没插电源或开着省电/安静模式、别的程序在用显卡" % (sp, fr, tt))
                if slow >= int(p.get("slowSteps", 4)):
                    save_ck(ep, k + 1, step)
                    why = "这台电脑训练慢得不正常（每秒 %d 字，正常几百，照这样还要 %.0f 小时）：存档已经交了，换别的电脑接着训。这台电脑请插上电源、把电源模式调到「最佳性能」、关掉占显卡的程序" % (sp, left_h)
                    unfit(why)
                    raise RuntimeError(why)
                if time.time() - last_ck > ckpt_min * 60:
                    save_ck(ep, k + 1, step)
                    last_ck = time.time()
    if start_ep < epochs:
        save_ck(epochs, 0, step)   # 训完了也存一次：后面转格式、考试出了问题，下次直接从这里开始
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
