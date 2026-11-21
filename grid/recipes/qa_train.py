"""捞捞答题 · 训练答题大脑（同事的 8G 显卡，QLoRA 轻量微调）
用「数据工厂」到现在为止核对过的所有讲解，微调老师端用的那个模型（通义千问 Qwen3-VL-4B-Instruct）：
  1. 底子按 4 位精度放进显卡，只训练很小的 LoRA（几十 MB），8G 显存够
  2. 训完转成 llama.cpp 的格式（老师端直接加载，不用换模型）
  3. 考试：同一套题（GSM8K 测试集里固定的 100 道，MIT 许可），原版考一次、带 LoRA 考一次
     → 答对率（acc）、用中文讲的比例（zh_rate）；不比原版差、比现在发布的好，才发布给老师端
要在新版客户端上跑（自带 llama.cpp）；第一次要下底子（约 9G，魔搭优先）和老师端用的量化模型（约 2.5G）。
同一个配方还训「先核对再回答」（params.exam = "ground"，数据来自 ground_gen.py）：照资料回答、标出处、资料里没有就说没有；逐句核对有据 / 无据 / 矛盾。
  考试用 CMRC 2018 验证集（和造数据用的训练集不重叠）做的一套固定题，对错全由程序判（见下面的 GROUND 考试）：
  acc = 该答的答对了（答案对、出处对、数字资料里都有），abstain = 资料里没有时老实说没有，catch = 埋进去的错句抓出来，clean = 对的句子没被冤枉
  发布有固定的及格线（plans/ground.json），不是「比原版好一点」就发：达不到就不发，客户端继续用底子自己核对。
同一个配方也训「口语对话大脑」（params.exam = "chat"，数据来自 chat_gen.py）：打电话时说话像人——短、念得出来、听错字也懂。
  考试换成一套固定的口语考题（下面的 CHAT_EXAM：讲概念、口头算题、带识别错字的问法、闲聊、没说清楚的话）：
  acc = 关键信息说对了的比例，speak = 念得出来的比例（规则检查，和 chat_gen.py 的一样）
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
CHAT = p.get("exam") == "chat"
GROUND = p.get("exam") == "ground"   # 先核对再回答（数据来自 ground_gen.py；考试见下面的 GROUND 考试）
NAME = p.get("name") or ("chat-lora" if CHAT else "ground-lora" if GROUND else "qa-lora")
# 语音通话的规则：和 chat_gen.py、成品展示打电话时加给捞小智的那一段一字不差（测试里核对）
SPOKEN = """现在是语音通话：你说的每一句都会被念出来。
· 说口语、用短句，一次说两三句，先说最要紧的；要讲的内容很长，先讲第一步，再问对方要不要接着讲。
· 不要用列表、标题、加粗、表格、表情、链接和代码；不要写 LaTeX 和数学符号，公式和数字按读法说（比如「x 的平方」「三分之二」「根号二」）。
· 对方的话是语音识别出来的，可能有同音错字、没有标点、夹着「嗯」「那个」：按最可能的意思理解；实在听不懂、或者有好几种意思，就简单问一句。
· 不知道的就说不知道，不要编。"""
SYSTEM = p.get("system") or (("你是「捞小智」，捞捞课程表的校园智能体，会讲题、做 PPT、办教务的事。\n" + SPOKEN) if CHAT else
                             ("你是一位耐心的中国中小学数学老师。讲题要一步一步来，每一步说清楚为什么这样做，用学生听得懂的话；"
                              "算式写清楚；最后一行写「答案：」并把最终答案放在 \\boxed{} 里。"))
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
                q = "\n".join(m["content"] for m in r["messages"] if m["role"] == "user")
                last = r["messages"][-1]
                if not q or last["role"] != "assistant":
                    continue
            except (ValueError, KeyError, IndexError, TypeError):
                continue
            h = hashlib.md5((q + last["content"][:50]).encode("utf-8")).hexdigest()
            if h not in seen:
                seen.add(h)
                rows.append(r["messages"])
lg.log("讲解：%d 条（去掉了重复的）" % len(rows))
if len(rows) < int(p.get("minExamples", 300)):
    lg.done(skip="讲解还不够（%d 条，要 %d 条），先攒着" % (len(rows), int(p.get("minExamples", 300))), examples=len(rows))
    raise SystemExit(0)
# ---- 接着上一版训（不用每一轮都把全部数据从头训一遍）----
# 调度中心带来了现在发布的那一版（opt_prev_peft）和它当时用了多少条（prevExamples）：
#   这一轮只训「新增的 + 从旧的里抽一部分复习」（防止学了新的忘了旧的），从上一版的参数接着往下训。
#   数据是按交上来的先后排的，所以前 prevExamples 条就是上一版见过的。
#   新增的比旧的还多、上一版拿不到、参数对不上：就和以前一样从头训全部。考试把关不变：不比现在发布的好不发布。
WARM = None
ALL_ROWS = list(rows)
_prev = (t.get("files") or {}).get("opt_prev_peft")
_pn = int((t.get("extra") or {}).get("prevExamples") or 0)
_total = len(rows)
if _prev and p.get("warm", True) and 0 < _pn < len(rows) <= int(p.get("maxExamples", 8000)):
    new_rows, old_rows = rows[_pn:], rows[:_pn]
    if len(new_rows) <= len(old_rows):
        random.Random(len(rows)).shuffle(old_rows)
        replay = old_rows[: max(int(p.get("replayMin", 600)), int(len(new_rows) * float(p.get("replay", 2))))]
        WARM = {"zip": _prev, "new": len(new_rows), "replay": len(replay)}
        rows = new_rows + replay
# ---- 底座的永久层（base-stack：已经考过、合进底座的几个 LoRA，各带比例）----
# 有的话：先把它们按比例合进底子的权重（CPU 上做，每台电脑同一版只合一次，存在缓存里），在新底子上训；考试也带着它们考。
#   上一版的 LoRA 已经合进底座了：就不能再接着它训（不然算了两遍），在新底座上重新开一个 LoRA（复习数据照样带）。
STACK, STACK_ARG, STACK_SIG = [], {}, ""
_sf, _bf = (t.get("files") or {}).get("m_base-stack_stack"), (t.get("files") or {}).get("m_base-stack_bundle")
if _sf and _bf and os.path.exists(_sf) and os.path.exists(_bf):
    import zipfile
    _st = json.load(open(_sf, encoding="utf-8"))
    _sd = os.path.join(work, "stack")
    for _zf in (_bf, (t.get("files") or {}).get("m_base-stack_train")):
        if _zf and os.path.exists(_zf):
            with zipfile.ZipFile(_zf) as _z:
                _z.extractall(_sd)
    STACK = [dict(l, gguf_path=os.path.join(_sd, os.path.basename(l["gguf"])), peft_path=os.path.join(_sd, os.path.basename(l["peft"])) if l.get("peft") else None) for l in _st.get("layers", []) if l.get("gguf")]
    STACK_SIG = hashlib.md5(json.dumps([(l["name"], l.get("version"), l.get("scale"), l.get("sha")) for l in STACK]).encode("utf-8")).hexdigest()[:12]
    STACK_ARG = {"base": [{"path": l["gguf_path"], "scale": float(l.get("scale", 1))} for l in STACK]}
    lg.log("底座有 %d 层合进去的本事（%s）：在合好的底子上训" % (len(STACK), "、".join("%s 第 %s 版 ×%s" % (l["name"], l.get("version"), l.get("scale")) for l in STACK)))
    if WARM:
        _h = hashlib.sha256(open(WARM["zip"], "rb").read()).hexdigest()
        if any(l.get("sha") == _h for l in STACK):
            lg.log("上一版已经合进底座了：在新底座上重新开一个 LoRA（复习数据照样带）")
            WARM["fresh"] = True
random.Random(0).shuffle(rows)
rows = rows[: int(p.get("maxExamples", 8000))]

# ---- 训练参数自己进化（不用人调）----
# 每一轮从「现在发布的那一版」用的参数出发，有一半的轮次改动其中一个（学习率、训几遍、复习多少）试一试。
# 考试把关：改了以后考得更好 → 这一版发布，它的参数成为下一轮的起点；没更好 → 不发布，下一轮还从原来的参数出发。
# 好的改动留下、坏的自动淘汰，一轮一轮往好的方向走。
PREV = (t.get("extra") or {}).get("prev") or {}
HP = {"lr": float(p.get("lr", 1e-4)), "epochs": int(p.get("epochs", 2)), "replay": float(p.get("replay", 2))}
TRY = None
if p.get("evolve", True):
    for _k, _v in (PREV.get("hp") or {}).items():
        if _k in HP and isinstance(_v, (int, float)) and _v > 0:
            HP[_k] = type(HP[_k])(_v)
    _rng = random.Random("hp-%d" % _total)
    if PREV.get("hp") is not None and _rng.random() < float(p.get("evolveRate", 0.5)):
        _k = _rng.choice(["lr", "lr", "epochs", "replay"])
        _old = HP[_k]
        if _k == "lr":
            HP[_k] = min(4e-4, max(2e-5, _old * _rng.choice([0.67, 1.5])))
        elif _k == "epochs":
            HP[_k] = min(3, max(1, _old + _rng.choice([-1, 1])))
        else:
            HP[_k] = min(6.0, max(0.5, _old * _rng.choice([0.5, 2.0])))
        if HP[_k] != _old:
            TRY = "%s：%s → %s" % ({"lr": "学习率", "epochs": "训几遍", "replay": "复习旧数据的倍数"}[_k], ("%g" % _old), ("%g" % HP[_k]))
            lg.log("这一轮试一个改动（考得更好就留下，没更好就淘汰）：" + TRY)
if WARM and HP["replay"] != float(p.get("replay", 2)):
    # 复习的倍数变了：重新挑一遍
    _new, _old_rows = ALL_ROWS[_pn:], ALL_ROWS[:_pn]
    random.Random(_total).shuffle(_old_rows)
    _rp = _old_rows[: max(int(p.get("replayMin", 600)), int(len(_new) * HP["replay"]))]
    WARM["replay"] = len(_rp)
    rows = _new + _rp
    random.Random(0).shuffle(rows)


# ---------------- 2. 底子（Hugging Face 格式，训练用）----------------
def base_missing(d):
    """底子缺了哪些文件：按 model.safetensors.index.json 里列的分片一个个核对（空文件也算缺）。
    以前只看「有没有 .safetensors」：组件镜像只下好了第 1 片、第 2 片没下下来，也当成下好了、写了 .ok，
    这台电脑以后每次都在「把底子放进显卡」时报 model-00002-of-00002.safetensors 找不到，任务一次次记失败。"""
    has = lambda n: os.path.exists(os.path.join(d, n)) and os.path.getsize(os.path.join(d, n)) > 0
    need = ["config.json"]
    idx = os.path.join(d, "model.safetensors.index.json")
    if os.path.exists(idx):
        try:
            with open(idx, encoding="utf-8") as f:
                need += sorted(set(json.load(f)["weight_map"].values()))
        except Exception:
            return ["model.safetensors.index.json（文件坏了）"]
    elif not has("model.safetensors"):
        return [n for n in need if not has(n)] + ["model.safetensors（或 model.safetensors.index.json）"]
    return [n for n in need if not has(n)]


def base_dir():
    d = os.path.join(CACHE, "hf", BASE_REPO.replace("/", "__"))
    ok = os.path.join(d, ".ok")
    miss = base_missing(d) if os.path.isdir(d) else ["全部"]
    if not miss:
        if not os.path.exists(ok):
            open(ok, "w").close()
        return d
    if os.path.exists(ok):
        os.remove(ok)
        lg.log("这台电脑上的底子不完整（缺 %s）：只补下缺的，不用整个重下" % "、".join(miss[:4]))
    lg.progress(0.02, "下载底子 %s（第一次约 9G；已经有的文件不再下）" % BASE_REPO)
    err = None
    # ① 组件镜像（国内：自己的腾讯云存储；国外：自己的 GitHub）：下过的文件 lg.download 会跳过
    try:
        fs_ = lg.mirror(model="qaBase") if BASE_REPO == "Qwen/Qwen3-VL-4B-Instruct" else []
        if fs_ and any(x["name"].endswith(".safetensors") for x in fs_):
            os.makedirs(d, exist_ok=True)
            for i, x in enumerate(fs_):
                lg.progress(0.02 + 0.05 * i / len(fs_), "从组件镜像下载底子：%s" % x["name"])
                lg.download(x["sources"], os.path.join(d, x["name"]), "下载 %s" % x["name"])
    except Exception as e:
        err = e
        lg.log("组件镜像里的底子没下全（%s），缺的换魔搭 / Hugging Face 补" % str(e)[:160])
    miss = base_missing(d)
    if miss:
        if err is None:
            lg.log("组件镜像里少了这些文件：%s（请管理员把它们补进组件镜像）；先从魔搭 / Hugging Face 补" % "、".join(miss[:4]))

        def ms():
            from modelscope import snapshot_download
            snapshot_download(BASE_REPO, local_dir=d)

        def hf(endpoint):
            os.environ["HF_ENDPOINT"] = endpoint
            from huggingface_hub import snapshot_download as hf_dl
            hf_dl(BASE_REPO, local_dir=d)
        # ② 国内：魔搭 → hf-mirror；国外：Hugging Face 官方 → 魔搭（都只下缺的）
        order = [lambda: hf("https://huggingface.co"), ms] if lg.region() == "global" else [ms, lambda: hf("https://hf-mirror.com")]
        for fn in order:
            try:
                fn()
                if not base_missing(d):
                    break
            except Exception as e:
                err = e
                lg.log("这个源下载不行（%s），换下一个" % str(e)[:120])
    miss = base_missing(d)
    if miss:
        # 这台电脑下不全底子（网不通、硬盘满了）：是这台电脑的事，不记任务失败，交给别的电脑从存档接着训
        why = "底子没下全（缺 %s）：%s" % ("、".join(miss[:4]), err)
        getattr(lg, "unfit", lambda w: None)(why)
        raise RuntimeError(why)
    open(ok, "w").close()
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
def small_opt(sd, torch):
    """存档里优化器的两组数（一阶、二阶动量）改用半精度存：存档小三分之一（379M → 约 250M），
    接着训的时候 PyTorch 读进来会自动转回和参数一样的全精度。LoRA 参数本身照旧全精度（压了会让训练变差）。
    出任何意外就原样存。"""
    try:
        st = {}
        for i, s in sd["state"].items():
            st[i] = {k: (v.to(torch.bfloat16) if k != "step" and torch.is_tensor(v) and v.is_floating_point() and v.dim() > 0 else v) for k, v in s.items()}
        return {"state": st, "param_groups": sd["param_groups"]}
    except Exception:
        return sd


def merged_base(base):
    """把底座的永久层按比例合进底子的权重（CPU，半精度，约 9G 内存）：同一版每台电脑只合一次"""
    if not STACK:
        return base
    d = os.path.join(CACHE, "hf", "merged-" + STACK_SIG)
    if os.path.exists(os.path.join(d, ".ok")):
        return d
    import torch
    import zipfile
    from peft import PeftModel
    from safetensors.torch import load_file, save_file
    from transformers import AutoModelForImageTextToText, AutoProcessor
    lg.progress(0.06, "把底座的永久层合进底子（CPU 上做，第一次要十几分钟）")
    model = AutoModelForImageTextToText.from_pretrained(base, torch_dtype=torch.bfloat16, device_map={"": "cpu"})
    for n, l in enumerate(STACK):
        if not l.get("peft_path") or not os.path.exists(l["peft_path"]):
            raise RuntimeError("底座第 %d 层少了训练用的参数包（%s）" % (n + 1, l["name"]))
        pd = os.path.join(work, "stack-peft-%d" % n)
        with zipfile.ZipFile(l["peft_path"]) as z:
            z.extractall(pd)
        cfgf = glob.glob(os.path.join(pd, "**", "adapter_config.json"), recursive=True)[0]
        ad = os.path.dirname(cfgf)
        sf = os.path.join(ad, "adapter_model.safetensors")
        sd = load_file(sf)
        sc = float(l.get("scale", 1))
        if sc != 1:   # 按比例合：把 B 矩阵乘上比例（ΔW = B·A，乘 B 就是乘整个改动）
            sd = {k: (v * sc if "lora_B" in k else v) for k, v in sd.items()}
            save_file(sd, sf)
        model = PeftModel.from_pretrained(model, ad).merge_and_unload()
        lg.log("合进去了第 %d 层：%s 第 %s 版 ×%s" % (n + 1, l["name"], l.get("version"), sc))
    tmp = d + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    model.save_pretrained(tmp, safe_serialization=True)
    AutoProcessor.from_pretrained(base).save_pretrained(tmp)
    for f in glob.glob(os.path.join(base, "*.json")) + glob.glob(os.path.join(base, "*.jinja")):
        if not os.path.exists(os.path.join(tmp, os.path.basename(f))):
            shutil.copy(f, tmp)
    shutil.rmtree(d, ignore_errors=True)
    os.rename(tmp, d)
    open(os.path.join(d, ".ok"), "w").close()
    del model
    return d


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
    # 梯度检查点是拿时间换显存的（慢三成左右）：8G 的卡必须开；显存空着 14G 以上的大卡关掉它，白捡这三成
    gck = p.get("gradCkpt", "auto")
    gck = (free_g < float(p.get("gradCkptBelow", 14))) if gck == "auto" else bool(gck)
    if not gck:
        lg.log("显存够大（空着 %.1fG）：关掉省显存模式，训练更快" % free_g)
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=gck, **({"gradient_checkpointing_kwargs": {"use_reentrant": False}} if gck else {}))
    cfg = LoraConfig(r=int(p.get("rank", 16)), lora_alpha=int(p.get("alpha", 32)), lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
                     target_modules=r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)")
    model = get_peft_model(model, cfg)
    global WARM
    if WARM and WARM.get("fresh"):
        WARM = None
    if WARM:
        try:
            import zipfile
            from peft import get_peft_model_state_dict, set_peft_model_state_dict
            from safetensors.torch import load_file
            pd = os.path.join(work, "prev-peft")
            with zipfile.ZipFile(WARM["zip"]) as z:
                z.extractall(pd)
            sd = load_file(glob.glob(os.path.join(pd, "**", "adapter_model.safetensors"), recursive=True)[0])
            mine = get_peft_model_state_dict(model)
            # 先核对再动手：名字、形状都一样才用（参数规模改过就对不上）
            if set(sd) != set(mine) or any(tuple(sd[k].shape) != tuple(mine[k].shape) for k in sd):
                raise RuntimeError("和现在的设置对不上（参数规模改过？）")
            set_peft_model_state_dict(model, sd)
            lg.log("接着上一版训：这一轮只训新增的 %d 条 + 复习旧的 %d 条（以前每一轮都把全部 %d 条从头训）" % (WARM["new"], WARM["replay"], _total))
        except Exception as e:
            lg.log("上一版的参数用不了（%s）：这一轮照旧，用全部 %d 条从头训" % (str(e)[:160], _total))
            WARM = None
            rows[:] = ALL_ROWS
            random.Random(0).shuffle(rows)
            del rows[int(p.get("maxExamples", 8000)):]
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

    epochs, accum = int(HP["epochs"]), int(p.get("accum", 16))
    # 留一小部分不训，只用来测（验证集）：训着训着它不再变好，就是学到头了 → 提前停，不白算后面的
    n_val = min(int(p.get("valMax", 64)), int(len(data) * float(p.get("valPart", 0.03)))) if p.get("earlyStop", True) else 0
    val, data = (data[:n_val], data[n_val:]) if n_val >= 8 else ([], data)
    steps = max(1, (len(data) * epochs) // accum)
    opt = torch.optim.AdamW([x for x in model.parameters() if x.requires_grad], lr=float(HP["lr"]), weight_decay=0.0)
    warm = max(1, steps // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * max(0.1, 0.5 * (1 + __import__("math").cos(3.14159 * min(1.0, s / steps)))))
    # 存档：每隔 ckptMin 分钟存一次（LoRA 的参数 + 优化器 + 训到哪了），训完也存一次。
    # 中途停了（同事要用电脑、断网、重开软件、换电脑），下次从最近的存档接着训，不从头来。
    trainable = [(n, x) for n, x in model.named_parameters() if x.requires_grad]
    fp = hashlib.md5(json.dumps([len(data) + len(val), epochs, accum, int(p.get("rank", 16)), max_len, [d[0][:16] for d in data[:3]], len(trainable)]).encode("utf-8")).hexdigest()
    ckpt_min = float(p.get("ckptMin", 20))

    def save_ck(ep, k, step):
        f = os.path.join(work, "ckpt-%d.pt" % step)
        torch.save({"fp": fp, "lora": {n: x.detach().to("cpu") for n, x in trainable}, "opt": small_opt(opt.state_dict(), torch), "sched": sched.state_dict(), "ep": ep, "k": k, "step": step}, f)
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
    run_loss, last_ck = 0.0, time.time()
    OOM = getattr(torch, "OutOfMemoryError", None) or torch.cuda.OutOfMemoryError
    w_tok, w_t, slow = 0, time.time(), 0
    slow_tok = float(p.get("slowTok", 40))      # 每秒不到这么多字 = 慢得不正常（8G 显卡正常是几百）
    # ---- 把显卡用满：按「字数预算」拼批 ----
    # 以前一次只喂一条：短的讲解（两三百字）也独占一次计算，显卡大半空着。现在长短差不多的拼成一批一起算：
    #   一批的大小 = 条数 × 最长那条的字数，不超过预算。预算从「一条最长的」起步（显存占用和以前一样），
    #   显存还有富余就自动加（大显存的卡会一路加上去），放不下（OOM）就退回去并记住这个上限。
    pad_id = getattr(tok, "pad_token_id", None)
    if pad_id is None:
        pad_id = getattr(tok, "eos_token_id", None) or 0
    budget = int(p.get("tokBudget", max_len))
    top = int(p.get("maxBudget", max_len * 8))          # 预算最多加到这儿
    max_bs = int(p.get("maxBatch", accum))
    auto = bool(p.get("autoBatch", True))
    lim = max(1.0, (free_g - 0.5)) * 2 ** 30               # 这次训练最多能用的显存
    peak_of = getattr(torch.cuda, "max_memory_allocated", None)
    reset_peak = getattr(torch.cuda, "reset_peak_memory_stats", lambda: None)
    n_oom, n_skip, n_batch, n_ex, since = 0, 0, 0, 0, 0
    best, stale, stop_early = [float("inf"), 0, None], 0, False
    val_every = int(p.get("valEvery", 0)) or max(5, steps // 10)

    def val_loss():
        model.eval()
        tot, cnt, i = 0.0, 0, 0
        vs = sorted(val, key=lambda d: -len(d[0]))
        with torch.no_grad():
            while i < len(vs):
                n, width = 0, 0
                while i + n < len(vs) and n < max_bs:
                    w2 = max(width, min(len(vs[i + n][0]), budget))
                    if n and (n + 1) * w2 > budget:
                        break
                    n, width = n + 1, w2
                b = [(ids[:width], labels[:width]) for ids, labels in vs[i:i + n]]
                x = torch.tensor([ids + [pad_id] * (width - len(ids)) for ids, _ in b], device="cuda")
                m = torch.tensor([[1] * len(ids) + [0] * (width - len(ids)) for ids, _ in b], device="cuda")
                y = torch.tensor([labels + [-100] * (width - len(labels)) for _, labels in b], device="cuda")
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    tot += model(input_ids=x, attention_mask=m, labels=y).loss.item() * len(b)
                cnt += len(b)
                i += n
        model.train()
        return tot / max(1, cnt)

    bucket = int(p.get("bucket", 128))
    for ep in range(start_ep, epochs):
        order = list(data)
        random.Random(ep).shuffle(order)   # 每一轮的顺序只由轮数决定：接着训的时候知道训到哪条了
        # 每 128 条里按长短排一下（长的在前）：一批里长短接近，补的空位少；最长的先上，显存够不够一开始就知道
        order = [d for i in range(0, len(order), bucket) for d in sorted(order[i:i + bucket], key=lambda d: -len(d[0]))]
        k = start_k if ep == start_ep else 0
        while k < len(order) and not stop_early:
            # 从第 k 条往后拼一批
            n, width = 0, 0
            while k + n < len(order) and n < max_bs:
                w2 = max(width, min(len(order[k + n][0]), budget))
                if n and (n + 1) * w2 > budget:
                    break
                n, width = n + 1, w2
            batch = [(ids[:width], labels[:width]) for ids, labels in order[k:k + n]]
            batch = [(ids, labels) for ids, labels in batch if sum(1 for v in labels if v != -100) >= 4]   # 截短以后没剩下要学的字：跳过
            n_skip += n - len(batch)
            if not batch:
                k += n
                continue
            try:
                x = torch.tensor([ids + [pad_id] * (width - len(ids)) for ids, _ in batch], device="cuda")
                m = torch.tensor([[1] * len(ids) + [0] * (width - len(ids)) for ids, _ in batch], device="cuda")
                y = torch.tensor([labels + [-100] * (width - len(labels)) for _, labels in batch], device="cuda")
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    loss = model(input_ids=x, attention_mask=m, labels=y).loss * (len(batch) / float(accum))
                loss.backward()
                lv = loss.item()
            except OOM:
                x = m = y = loss = None
                torch.cuda.empty_cache()
                n_oom += 1
                used = len(batch) * width
                if used <= 256:
                    why = "显存不够：256 个字的讲解都放不下（别的程序占着显存）。关掉占显存的程序再算"
                    unfit(why)
                    raise RuntimeError(why)
                budget = max(256, int(used * 0.8))
                top = budget                                   # 记住：以后不再往上加
                lg.log("显存不够：一批最多 %d 个字（不会溢出到共享内存拖慢几十倍）" % budget)
                continue                                       # 同一个位置按新的预算重拼
            k += n
            n_batch += 1
            n_ex += len(batch)
            since += len(batch)
            real = sum(len(ids) for ids, _ in batch)
            run_loss += lv
            w_tok += real
            # 一步 10 分钟还没走完：不等了（正常一步是几十秒）
            el = time.time() - w_t
            if el > float(p.get("slowSecs", 600)) and w_tok / el < slow_tok:
                fr, tt = [v / 2 ** 30 for v in torch.cuda.mem_get_info()]
                why = ("这台电脑训练慢得不正常（每秒 %d 字，正常是几百；显存空着 %.1f/%.1fG）：换别的电脑接着训。"
                       "这台电脑请插上电源、把电源模式调到「最佳性能」、关掉占显卡的程序" % (w_tok / el, fr, tt))
                unfit(why)
                raise RuntimeError(why)
            if since >= accum or (k >= len(order) and ep == epochs - 1):
                since = 0
                torch.nn.utils.clip_grad_norm_([x for x in model.parameters() if x.requires_grad], 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                sp = w_tok / max(time.time() - w_t, 1e-6)       # 这一步的速度（不是从头算的平均）
                left_h = max(0, steps - step) * (time.time() - w_t) / 3600.0
                w_tok, w_t = 0, time.time()
                lg.metric(step, loss=run_loss, tok_s=sp, batch=budget)
                lg.progress(0.1 + 0.6 * min(1.0, step / float(steps)), "训练：第 %d/%d 步（每秒 %d 字，一批 %d 字，还要 %s）" % (min(step, steps), steps, sp, budget, ("%.1f 小时" % left_h) if left_h >= 1 else ("%d 分钟" % max(1, left_h * 60))))
                run_loss = 0.0
                # 显存还有富余：一批再多放点（每步最多加四分之一）
                if auto and budget < top and peak_of:
                    pk = peak_of()
                    if pk and pk < 0.7 * lim:
                        budget = min(top, int(budget * 1.25))
                        reset_peak()
                        if n_batch < 200 or step % 50 == 0:
                            lg.log("显存还有富余（用了 %.1f/%.1fG）：一批加到 %d 个字" % (pk / 2 ** 30, lim / 2 ** 30, budget))
                # 隔一段测一次验证集：比最好的那次还好就记下这份参数；连着几次都没更好、而且已经训过四成 → 提前停
                if val and (step % val_every == 0 or step >= steps):
                    v = val_loss()
                    w_t = time.time()                      # 测验证集的时间不算进训练速度
                    lg.metric(step, val=v)
                    if v < best[0] - 1e-4:
                        best[0], best[1], best[2] = v, step, {n: x.detach().to("cpu").clone() for n, x in trainable}
                        stale = 0
                    else:
                        stale += 1
                    if stale >= int(p.get("patience", 2)) and step >= 0.4 * steps and step < steps:
                        lg.log("验证集连着 %d 次没再变好（最好是第 %d 步）：学到头了，提前停，省下后面 %d 步" % (stale, best[1], steps - step))
                        stop_early = True
                # 慢得不正常（显存溢出到共享内存、电脑在省电模式、显卡被别的程序占着）：别在这台电脑上空耗几天
                slow = slow + 1 if sp < slow_tok else 0
                if slow == 2:
                    fr, tt = [v / 2 ** 30 for v in torch.cuda.mem_get_info()]
                    lg.log("训练慢得不正常：每秒只有 %d 字（正常是几百）。显存空着 %.1f/%.1fG。常见原因：没插电源或开着省电/安静模式、别的程序在用显卡" % (sp, fr, tt))
                if slow >= int(p.get("slowSteps", 4)):
                    save_ck(ep, k, step)
                    why = "这台电脑训练慢得不正常（每秒 %d 字，正常几百，照这样还要 %.0f 小时）：存档已经交了，换别的电脑接着训。这台电脑请插上电源、把电源模式调到「最佳性能」、关掉占显卡的程序" % (sp, left_h)
                    unfit(why)
                    raise RuntimeError(why)
                if time.time() - last_ck > ckpt_min * 60:
                    save_ck(ep, k, step)
                    last_ck = time.time()
    lg.log("训练用了 %d 批（%d 条，平均一批 %.1f 条）%s%s" % (n_batch, n_ex, n_ex / float(max(1, n_batch)), "；显存不够退了 %d 次" % n_oom if n_oom else "", "；跳过 %d 条" % n_skip if n_skip else ""))
    # 最后的参数不如中途最好的那次：用最好的那次
    if best[2] is not None and best[1] != step:
        with torch.no_grad():
            for n, x in trainable:
                x.copy_(best[2][n].to(x.device, x.dtype))
        lg.log("用验证集上最好的那一次（第 %d 步）的参数" % best[1])
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
    out = os.path.join(work, NAME + ".gguf")
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


# ---- 口语考试（exam = chat）：念不念得出来、认数字 —— 和 chat_gen.py 里的一字不差（测试里核对）----
LIMIT = {"explain": 220, "math": 170, "chat": 100, "clarify": 60, "followup": 200, "correct": 120}


BAD = [
    (re.compile(r"\n"), "分了好几段"),
    (re.compile(r"[#*`|$\\^_~<>\[\]{}]"), "带符号"),
    (re.compile(r"https?://|www\."), "带链接"),
    (re.compile(r"(^|[。！？\s])\s*(\d+[.、)](?!\d)|[-•·])\s*\S"), "像列表"),
    (re.compile(r"[²³√≤≥≠×÷π∑∫±→⇒°%/+=]"), "数学符号没按读法说"),
    (re.compile(r"[\U0001F300-\U0001FAFF☀-➿]"), "带表情"),
    (re.compile(r"以下是|如下[：:]|总结如下|见下"), "像在写文章"),
    (re.compile(r"你(真|可)?(是)?太(棒|聪明|厉害)了|好问题|非常好的问题|问得(真|太|很)?好"), "空洞夸奖"),
]
# 附和：开口就说「对」「没错」（对方说错了还附和 = 讨好）
AGREE = re.compile(r"^\s*(对|是的|没错|嗯对|对的|是啊|对呀|没问题|嗯嗯)[，,。！!\s]")


def zh_ratio(s):
    t = re.sub(r"\s", "", s)
    return len(re.findall(r"[一-鿿]", t)) / max(len(t), 1)


def speakable(s, kind, english=False):
    """念得出来返回 None；不行返回原因"""
    s = (s or "").strip()
    if len(s) < 6:
        return "太短"
    if len(s) > LIMIT.get(kind, 220):
        return "太长（%d 字）" % len(s)
    for rx, why in BAD:
        if rx.search(s):
            return why
    if s.count("：") + s.count(":") > 2:
        return "冒号太多（像在列条目）"
    if not english and zh_ratio(s) < 0.6:
        return "中文太少"
    if not re.search(r"[。！？?!…~～）)」]$", s):
        return "话没说完"
    if kind == "clarify" and not re.search(r"[？?]|吗|呢", s):
        return "没听清的时候要先问一句"
    return None


CN = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


UNIT = {"十": 10, "百": 100, "千": 1000, "万": 10000}


def cn_num(s):
    total, sec, num = 0, 0, 0
    for ch in s:
        if ch in CN:
            num = CN[ch]
        elif ch in UNIT:
            u = UNIT[ch]
            if u == 10000:
                total += (sec + num) * u
                sec, num = 0, 0
            else:
                sec += (num or 1) * u
                num = 0
    return total + sec + num


def numbers_in(s):
    out = set()
    for m in re.findall(r"-?\d+(?:\.\d+)?", s.replace(",", "")):
        try:
            out.add(round(float(m), 6))
        except ValueError:
            pass
    for m in re.findall(r"[零〇一二两三四五六七八九十百千万]+", s):
        if any(c in CN for c in m) or m in ("十",):
            out.add(float(cn_num(m)))
    for a, b in re.findall(r"([零一二两三四五六七八九十百千]+)分之([零一二两三四五六七八九十百千]+)", s):
        if cn_num(a):
            out.add(round(cn_num(b) / cn_num(a), 6))
    return out


# 固定的口语考题：q 问法（有的带识别错字）、kind 场景、keys 要说到的关键信息（每组里说到一个就算；"#12" = 要说出 12 这个数）
CHAT_EXAM = [
    ("冒泡排序是怎么排的", "explain", [["相邻", "挨着"], ["交换", "换"]]),
    ("嗯那个 冒泡排续是怎么回事", "explain", [["相邻", "挨着"], ["交换", "换"]]),
    ("二分查找是啥意思", "explain", [["一半", "中间"]]),
    ("递归是什么", "explain", [["自己"]]),
    ("书组和链表有啥区别", "explain", [["数组"], ["链表"]]),
    ("寒数的参数是干嘛用的", "explain", [["函数"]]),
    ("栈是什么样的", "explain", [["先进后出", "后进先出", "后放进去的先", "最后放进去的最先"]]),
    ("队列和栈有什么不一样", "explain", [["先进先出", "先来先", "排队"]]),
    ("光合作用是什么", "explain", [["二氧化碳"], ["氧"]]),
    ("那个 牛顿第二定律讲的啥", "explain", [["加速度"], ["质量"]]),
    ("欧姆定律是什么", "explain", [["电流"], ["电压"], ["电阻"]]),
    ("勾股定理怎么用", "explain", [["平方"], ["斜边", "直角"]]),
    ("等差数列是什么意思", "explain", [["差"], ["相等", "一样", "相同", "固定", "不变"]]),
    ("惯性是什么", "explain", [["保持", "维持"]]),
    ("质数是什么", "explain", [["本身", "自己"]]),
    ("嗯 导数有什么意义", "explain", [["变化", "斜率", "快慢"]]),
    ("现在完成时怎么用", "explain", [["have", "has"]]),
    ("比喻和拟人有什么区别", "explain", [["像", "比作", "当成"], ["人"]]),
    ("怎么背单词比较快", "explain", [["复习", "重复", "多看", "反复", "遍"]]),
    ("考前怎么复习", "explain", [["错题", "重点", "复习", "计划"]]),
    ("鸡兔同笼头三十五个脚九十四只兔子有几只", "math", [["#12"]]),
    ("一个长方形长五米宽二米周长是多少", "math", [["#14"]]),
    ("三加五乘二等于几", "math", [["#13"]]),
    ("一百减三十七是多少", "math", [["#63"]]),
    ("十二的一半再乘三是多少", "math", [["#18"]]),
    ("一本书三十块打八折多少钱", "math", [["#24"]]),
    ("二十个苹果分给四个人每人几个", "math", [["#5"]]),
    ("嗯 x 加三等于十 x 是多少", "math", [["#7"]]),
    ("那个 方城 x 平房等于四怎么解", "math", [["#2"]]),
    ("一个正方形边长六厘米面积是多少", "math", [["#36"]]),
    ("你是谁", "chat", [["捞小智"]]),
    ("明天考试好紧张", "chat", [["别", "不要", "放松", "深呼吸", "没关系", "相信", "加油"]]),
    ("谢谢你啊", "chat", [["不客气", "不用谢", "客气", "随时"]]),
    ("今天好累啊", "chat", [["休息", "辛苦", "累"]]),
    ("你会干什么", "chat", [["讲题", "题"], ["PPT", "ppt", "课件", "教务", "请假", "课表"]]),
    ("帮我弄一下那个", "clarify", []),
    ("把它发给我", "clarify", []),
    ("明天那个改一下", "clarify", []),
    ("给我订一个", "clarify", []),
    ("你看着办吧", "clarify", []),
    ("三角形内角和是三百六十度对吧", "correct", [["#180"]]),
    ("一小时是一百分钟对不对", "correct", [["#60"]]),
    ("七乘八等于五十四吧", "correct", [["#56"]]),
    ("嗯 水在一个标准大气压下五十度就开了是吧", "correct", [["#100"]]),
    ("一千克等于一百克对吗", "correct", [["#1000"]]),
]


def chat_hit(reply, kind, keys):
    if kind == "correct" and AGREE.match(reply):   # 对方说错了还附和：不算对
        return False
    if kind == "clarify":
        return bool(re.search(r"[？?]|吗|呢", reply))
    low = reply.lower()
    for g in keys:
        ok = False
        for k in g:
            if k.startswith("#"):
                ok = ok or float(k[1:]) in numbers_in(reply)
            else:
                ok = ok or k.lower() in low
        if not ok:
            return False
    return True


# ---------------- GROUND 考试（exam = ground）：对错全由程序判，题目固定 ----------------
G_ABSTAIN = "资料里没有"
G_ANSWER_SYS = """你是「捞小智」，只根据下面给的资料回答问题。
· 每句话后面用方括号标出依据是第几段资料，比如 [2]；一句话用到两段就写 [1][3]。
· 资料里没写的内容一句也不要加，不要用自己的印象补充；数字、名字、日期照资料抄，不要改。
· 资料里找不到答案：第一句就说「资料里没有」并说清楚缺的是什么，然后建议去哪里查，不要猜。
· 用简体中文，先直接回答，再补充一两句资料里的相关细节。"""
G_CHECK_SYS = """你是核对员。下面有几段资料和一个回答，回答已经按句编了号。逐句判断：
· 有据：这句话的意思资料里明确写了，写成「第N句：有据[资料编号]」
· 无据：资料里找不到这句话说的内容（哪怕它可能是对的），写成「第N句：无据」
· 矛盾：这句话和资料说的不一样（数字、名字、日期、因果不对），写成「第N句：矛盾[资料编号]」
每句一行，不要写别的。"""


def g_norm(s):
    return re.sub(r"[\s，,。．.、“”\"'《》]", "", s)


def g_mats(mats):
    return "\n\n".join("[%d] %s%s" % (k + 1, "（%s）" % m["title"] if m.get("title") else "", m["text"]) for k, m in enumerate(mats))


def g_split(ctx, size=220):
    if len(ctx) <= size * 1.4:
        return [ctx]
    out, cur = [], ""
    for x in re.findall(r"[^。！？]+[。！？]?", ctx):
        if cur and len(cur) + len(x) > size:
            out.append(cur)
            cur = ""
        cur += x
    if cur:
        out.append(cur)
    return out


def g_sents(s):
    out = []
    for m in re.finditer(r"[^。！？!?\n]+(?:[。！？!?]+|$)(?:\s*(?:\[\d+\])+)?", re.sub(r"\n+", "\n", s).strip()):
        x = m.group(0).strip()
        if len(re.sub(r"(\[\d+\])+", "", x).strip()) >= 2:
            out.append(x)
    return out


def as_outline(m):
    """资料换成思维导图的样子（中心主题 › 一句一个分支）：捞小智查资料时导图是这样给的（pptassist/core/mindmap.js）"""
    ss = re.findall(r"[^。！？]+[。！？]?", m["text"])
    return {"title": "导图：" + (m.get("title") or "笔记"), "text": (m.get("title") or "笔记") + " › " + "\n".join("- " + x.strip() for x in ss if x.strip())}


def ground_exam_set():
    f = os.path.join(CACHE, "cmrc2018_dev.json")
    if not os.path.exists(f) or os.path.getsize(f) < 100000:
        for u in p.get("evalUrls") or ["https://cdn.jsdelivr.net/gh/ymcui/cmrc2018@master/squad-style-data/cmrc2018_dev.json",
                                       "https://raw.githubusercontent.com/ymcui/cmrc2018/master/squad-style-data/cmrc2018_dev.json"]:
            try:
                lg.download(u, f)
                break
            except Exception:
                pass
    with open(f, encoding="utf-8") as fh:
        d = json.load(fh)
    items = []
    for art in d["data"]:
        for para in art["paragraphs"]:
            for qa in para["qas"]:
                ans = [a["text"].strip() for a in qa.get("answers", []) if a.get("text", "").strip()]
                if ans:
                    items.append({"title": art.get("title", ""), "context": para["context"].strip(), "q": qa["question"].strip(), "ans": ans})
    R = random.Random(12345)   # 固定的一套题：每次考的都一样，分数才能比
    R.shuffle(items)
    all_ans = [g for it in items for g in it["ans"]]

    def distract(it, n=2):
        out = []
        while len(out) < n:
            o = R.choice(items)
            if o["context"] != it["context"] and not any(g in o["context"] for g in it["ans"]):
                out.append({"title": o["title"], "text": g_split(o["context"])[0]})
        return out

    qs = []
    na, nb, nc = int(p.get("evalAnswer", 60)), int(p.get("evalAbstain", 40)), int(p.get("evalCheck", 50))
    for it in items[:na]:
        real = [{"title": it["title"], "text": x} for x in g_split(it["context"])]
        mats = real + distract(it)
        R.shuffle(mats)
        mats = [as_outline(m) if R.random() < 0.25 else m for m in mats]   # 四分之一的资料是思维导图的样子
        gi = {k for k, m in enumerate(mats) if any(g in m["text"] for g in it["ans"])}
        qs.append(("answer", G_ANSWER_SYS, "资料：\n%s\n\n问题：%s" % (g_mats(mats), it["q"]), {"gold": it["ans"], "gi": gi, "mats": mats}))
    for it in items[na:na + nb]:
        mats = [as_outline(m) if R.random() < 0.25 else m for m in distract(it, 3)]
        qs.append(("abstain", G_ANSWER_SYS, "资料：\n%s\n\n问题：%s" % (g_mats(mats), it["q"]), {"gold": it["ans"]}))
    k = 0
    for it in items[na + nb:]:
        if k >= nc:
            break
        real = [{"title": it["title"], "text": x} for x in g_split(it["context"])]
        mats = real + distract(it)
        R.shuffle(mats)
        g = next((g for g in it["ans"] if len(g) >= 2), None)
        src = next((j for j, m in enumerate(mats) if g and g in m["text"]), None)
        if src is None:
            continue
        ss_src = re.findall(r"[^。！？]{6,80}[。！？]", mats[src]["text"])
        hit = [x for x in ss_src if g in x]
        rest = [x for x in ss_src if g not in x]
        if not hit or not rest:
            continue
        ss = [hit[0] + "[%d]" % (src + 1), rest[0] + "[%d]" % (src + 1)]
        lab = ["有据", "有据"]
        kind = k % 3   # 0 全对；1 把答案换掉（矛盾）；2 插一句别处的话（无据）
        if kind == 1:
            w = next((w for w in R.sample(all_ans, 50) if w not in mats[src]["text"] and 1 <= len(w) <= 20 and w != g), None)
            if not w:
                continue
            ss[0] = ss[0].replace(g, w, 1)
            lab[0] = "矛盾"
        elif kind == 2:
            o = R.choice(items)
            fs = [x for x in re.findall(r"[^。！？]{8,60}[。！？]", o["context"]) if x[:10] not in "".join(m["text"] for m in mats)]
            if not fs or o["context"] == it["context"]:
                continue
            ss.insert(1, fs[0] + "[%d]" % R.randint(1, len(mats)))
            lab.insert(1, "无据")
        user = "资料：\n%s\n\n问题：%s\n\n回答：\n%s" % (g_mats(mats), it["q"], "\n".join("第%d句：%s" % (j + 1, x) for j, x in enumerate(ss)))
        qs.append(("check", G_CHECK_SYS, user, {"labels": lab}))
        k += 1
    return qs


def ground_score(kind, reply, ref):
    """→ 这道题记到哪几项、对了几个：[(项目, 对, 总)]"""
    reply = re.sub(r"<think>.*?</think>", "", reply or "", flags=re.S).strip()
    if kind == "abstain":
        ok = reply.startswith(G_ABSTAIN) and not any(g_norm(g) in g_norm(reply) for g in ref["gold"] if len(g_norm(g)) >= 2)
        return [("abstain", int(ok), 1)]
    if kind == "answer":
        ok = not reply.startswith(G_ABSTAIN) and any(g_norm(g) in g_norm(reply) for g in ref["gold"])
        if ok:
            all_ = "\n".join(m["text"] for m in ref["mats"])
            for x in g_sents(reply):
                cs = [int(c) for c in re.findall(r"\[(\d+)\]", x)]
                if any(n not in all_ for n in re.findall(r"\d+(?:\.\d+)?", re.sub(r"\[\d+\]", "", x))):
                    ok = False
                if any(g_norm(g) in g_norm(x) for g in ref["gold"]) and not any((c - 1) in ref["gi"] for c in cs):
                    ok = False
        return [("acc", int(ok), 1)]
    got = {}
    for m in re.finditer(r"第\s*(\d+)\s*句\s*[：:]\s*(有据|无据|矛盾)", reply):
        got[int(m.group(1)) - 1] = m.group(2)
    out = []
    for j, lab in enumerate(ref["labels"]):
        v = got.get(j)
        if lab == "有据":
            out.append(("clean", int(v == "有据"), 1))
        else:
            out.append(("catch", int(v in ("无据", "矛盾")), 1))
    return out


def ground_exam(url, qs, label):
    tot, hit = {}, {}
    lock = threading.Lock()
    todo = list(qs)

    def ask(sys_, user):
        body = {"messages": [{"role": "system", "content": sys_}, {"role": "user", "content": user}], "temperature": 0, "max_tokens": 600,
                "chat_template_kwargs": {"enable_thinking": False}}
        req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode("utf-8"))["choices"][0]["message"].get("content") or ""

    def work_():
        while True:
            with lock:
                if not todo:
                    return
                kind, sys_, user, ref = todo.pop()
            try:
                s = ask(sys_, user)
            except Exception:
                s = ""
            with lock:
                for k_, a, b in ground_score(kind, s, ref):
                    hit[k_] = hit.get(k_, 0) + a
                    tot[k_] = tot.get(k_, 0) + b
                n = sum(1 for _ in qs) - len(todo)
                if n % 20 == 0:
                    lg.log("%s：考了 %d/%d 道" % (label, n, len(qs)))

    ths = [threading.Thread(target=work_) for _ in range(2)]
    for x in ths:
        x.start()
    for x in ths:
        x.join()
    return {k_: round(hit.get(k_, 0) / max(1, tot.get(k_, 0)), 4) for k_ in ("acc", "abstain", "catch", "clean")}


def exam_set():
    if CHAT:
        return [(q, (kind, keys)) for q, kind, keys in CHAT_EXAM]
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
        body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q if CHAT else q + "\n（请用中文讲解）"}], "temperature": 0, "max_tokens": 400 if CHAT else 1200,
                **({"chat_template_kwargs": {"enable_thinking": False}} if CHAT else {})}
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
                if CHAT:   # 关键信息说对了没有；念不念得出来（zh 这一项记的是 speak）
                    kind, keys = ref
                    s = re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()
                    right[0] += chat_hit(s, kind, keys)
                    zh[0] += speakable(s, kind) is None
                else:
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
    gguf = os.path.join(work, NAME + ".gguf")
    open(gguf, "wb").write(b"GGUF" + b"\0" * 60)
else:
    conv = converter()   # 先准备好转换脚本：下不来就别白训两个小时
    base = merged_base(base_dir())
    adir = train(base)
    gguf = to_gguf(base, adir, conv)
spec = dict(p.get("evalLlm") or teacher_gguf(), ctx=int(p.get("evalCtx", 8192)), slots=2)
if GROUND:
    qs = ground_exam_set()
    _bn = "ground|%s|%d|%s" % (spec.get("name") or "", len(qs), STACK_SIG)
    KS = ("acc", "abstain", "catch", "clean")
    if p.get("reuseBase", True) and PREV.get("base_name") == _bn and all(isinstance(PREV.get("base_" + k), (int, float)) for k in KS):
        r0 = {k: float(PREV["base_" + k]) for k in KS}
        lg.log("原版的成绩用上一轮考的（同一套题、同一个原版），不重复考")
    else:
        lg.progress(0.8, "考试：原版")
        r0 = ground_exam(lg.llm("start", llm=spec, **STACK_ARG)["url"], qs, "原版")
    lg.progress(0.9, "考试：带上新训的 LoRA")
    r1 = ground_exam(lg.llm("start", llm=spec, lora=gguf, **STACK_ARG)["url"], qs, "新训的")
    lg.llm("stop")
    zf = shutil.make_archive(os.path.join(work, NAME + "-peft"), "zip", adir)
    lg.log("该答的答对：%.0f%% → %.0f%%；没有就说没有：%.0f%% → %.0f%%；错句抓出来：%.0f%% → %.0f%%；对的不冤枉：%.0f%% → %.0f%%" % tuple(
        x * 100 for k in KS for x in (r0[k], r1[k])))
    lg.done(lora=gguf, peft=zf, **{k: r1[k] for k in KS}, **{"base_" + k: r0[k] for k in KS},
            examples=_total, trained=len(rows), warm=bool(WARM), hp=HP, tried=TRY, base_name=_bn, mins=round((time.time() - t0) / 60, 1))
    raise SystemExit(0)
qs = exam_set()
_bn = "%s|%d%s" % (spec.get("name") or "", len(qs), "|" + STACK_SIG if STACK_SIG else "")
if p.get("reuseBase", True) and PREV.get("base_name") == _bn and isinstance(PREV.get("base_acc"), (int, float)) and isinstance(PREV.get("base_zh_rate"), (int, float)):
    acc0, zh0 = float(PREV["base_acc"]), float(PREV["base_zh_rate"])
    lg.log("原版的成绩用上一轮考的（同一套题、同一个原版：答对 %.0f%%），不重复考，省一半考试时间" % (acc0 * 100))
else:
    lg.progress(0.8, "考试：原版")
    acc0, zh0 = exam(lg.llm("start", llm=spec, **STACK_ARG)["url"], qs, "原版")
lg.progress(0.9, "考试：带上新训的 LoRA")
acc1, zh1 = exam(lg.llm("start", llm=spec, lora=gguf, **STACK_ARG)["url"], qs, "新训的")
lg.llm("stop")
zf = shutil.make_archive(os.path.join(work, NAME + "-peft"), "zip", adir)
if CHAT:
    lg.log("关键信息说对：原版 %.0f%% → 新训的 %.0f%%；念得出来：%.0f%% → %.0f%%" % (acc0 * 100, acc1 * 100, zh0 * 100, zh1 * 100))
    lg.done(lora=gguf, peft=zf, acc=round(acc1, 4), base_acc=round(acc0, 4), speak=round(zh1, 4), base_speak=round(zh0, 4), base_zh_rate=round(zh0, 4),
            examples=_total, trained=len(rows), warm=bool(WARM), hp=HP, tried=TRY, base_name=_bn, mins=round((time.time() - t0) / 60, 1))
else:
    lg.log("答对率：原版 %.0f%% → 新训的 %.0f%%；用中文讲：%.0f%% → %.0f%%" % (acc0 * 100, acc1 * 100, zh0 * 100, zh1 * 100))
    lg.done(lora=gguf, peft=zf, acc=round(acc1, 4), base_acc=round(acc0, 4), zh_rate=round(zh1, 4), base_zh_rate=round(zh0, 4),
            examples=_total, trained=len(rows), warm=bool(WARM), hp=HP, tried=TRY, base_name=_bn, mins=round((time.time() - t0) / 60, 1))
