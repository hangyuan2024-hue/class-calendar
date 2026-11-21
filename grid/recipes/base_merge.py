"""捞捞底座 · 合进底座（让底座本身一版版变强）
把考过试的 LoRA（答题 qa-lora、口语 chat-lora……，params.merge 里列的）按比例合进底座，变成新一版的「底座永久层」base-stack：
  · 底座永久层 = 原版通义千问 4B + 一层层合进去的 LoRA（各带比例）。llama.cpp 直接按比例挂着用（不用重新发 2.5G 的模型），
    训练的电脑把它们合进权重再训下一层（qa_train.py 的 merged_base）：一层层累起来，底座的改动就不再受单个 LoRA 的大小限制
  · 合多少：比例试 params.scales（默认 1.0、0.7、0.5），每个比例都过一遍回归考试，挑「哪一项都不退步、总分涨得最多」的那个
  · 回归考试（都用发给用户的那种量化文件考，对错全由程序判）：
      gsm8k  数学应用题（固定 60 道，看 \\boxed{} 里的数）
      read   照资料回答（CMRC 2018 验证集固定 40 道：答案在回答里）
      ceval  大学学科选择题（C-Eval 验证集里大学的几科，固定 60 道；下不来就不考这一项，日志里说清楚）
    任何一项比现在的底座退步超过 tol → 这个比例不要；所有比例都不行 → 这一轮不合，底座不变
CPU 也能做（考试慢一点）：req 里写 cpu 就派给 CPU 工位。
"""
# needs: llm
import csv
import hashlib
import io
import json
import os
import random
import re
import shutil
import threading
import time
import urllib.request
import zipfile

import lg


def llm_start(**kw):
    """开本地大模型；要挂底座永久层却没挂上（旧版客户端不认得 base）→ 这台电脑做不了，交给别的电脑"""
    r = lg.llm("start", **kw)
    if kw.get("base") and r.get("base") != len(kw["base"]):
        why = "这台电脑的客户端太旧，挂不上底座永久层：更新客户端以后再领这个任务"
        getattr(lg, "unfit", lambda w: None)(why)
        raise RuntimeError(why)
    return r

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()
CACHE = os.path.abspath(os.path.join(work, "..", "..", "cache"))
files = t.get("files") or {}
ver = (t.get("extra") or {}).get("models") or {}
t0 = time.time()
TOL = float(p.get("tol", 0.02))
SYSTEM_MATH = ("你是一位耐心的中国中小学数学老师。讲题要一步一步来，每一步说清楚为什么这样做，用学生听得懂的话；"
               "算式写清楚；最后一行写「答案：」并把最终答案放在 \\boxed{} 里。")

# ---------------- 现在的底座 + 要合进去的 LoRA ----------------
old_layers = []
if files.get("m_base-stack_stack") and files.get("m_base-stack_bundle"):
    st = json.load(open(files["m_base-stack_stack"], encoding="utf-8"))
    sd = os.path.join(work, "old")
    for k in ("m_base-stack_bundle", "m_base-stack_train"):
        if files.get(k) and os.path.exists(files[k]):
            with zipfile.ZipFile(files[k]) as z:
                z.extractall(sd)
    for l in st.get("layers", []):
        old_layers.append(dict(l, gguf_path=os.path.join(sd, os.path.basename(l["gguf"])), peft_path=os.path.join(sd, os.path.basename(l["peft"])) if l.get("peft") else None))
sha = lambda f: hashlib.sha256(open(f, "rb").read()).hexdigest()
new = []
for name in p.get("merge") or ["qa-lora"]:
    g, pf = files.get("m_%s_lora" % name), files.get("m_%s_peft" % name)
    if not g or not os.path.exists(g):
        lg.log("「%s」还没有发布过：这次不合它" % name)
        continue
    v = int(ver.get(name, 0))
    if any(l["name"] == name and int(l.get("version", 0)) >= v for l in old_layers):
        lg.log("「%s」第 %d 版已经在底座里了：不重复合" % (name, v))
        continue
    if not pf or not os.path.exists(pf):
        lg.log("「%s」第 %d 版没有训练用的参数包（peft）：合进去以后没法在它上面接着训，这次不合" % (name, v))
        continue
    new.append({"name": name, "version": v, "gguf_path": g, "peft_path": pf, "sha": sha(pf)})
if not new:
    lg.done(skip="没有新的、考过试的 LoRA 要合进底座", layers=len(old_layers))
    raise SystemExit(0)
lg.log("现在的底座：%d 层；这次要合进去：%s" % (len(old_layers), "、".join("%s 第 %d 版" % (x["name"], x["version"]) for x in new)))


# ---------------- 回归考试 ----------------
def get(urls, name):
    f = os.path.join(CACHE, name)
    if os.path.exists(f) and os.path.getsize(f) > 1000:
        return f
    os.makedirs(CACHE, exist_ok=True)
    for u in urls:
        try:
            lg.download(u, f)
            return f
        except Exception:
            pass
    return None


def boxed(s):
    k = s.rfind("\\boxed{")
    if k < 0:
        m = re.findall(r"答案[:：]\s*([^\n]+)", s)
        return m[-1].strip() if m else None
    k += 7
    depth, out = 1, []
    while k < len(s) and depth:
        ch = s[k]
        depth += ch == "{"
        depth -= ch == "}"
        if depth:
            out.append(ch)
        k += 1
    return "".join(out).strip()


def num(a):
    if a is None:
        return None
    a = re.sub(r"[,\s$元个人米]", "", str(a))
    m = re.search(r"-?\d+(\.\d+)?", a)
    try:
        return round(float(m.group(0)), 4) if m else None
    except ValueError:
        return None


def suites():
    out = {}
    R = random.Random(12345)   # 固定的一套题：每次考的都一样，分数才能比
    f = get(p.get("gsm8kUrls") or ["https://cdn.jsdelivr.net/gh/openai/grade-school-math@master/grade_school_math/data/test.jsonl",
                                   "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl"], "gsm8k-test.jsonl")
    if f:
        qs = [json.loads(x) for x in open(f, encoding="utf-8") if x.strip()]
        R.shuffle(qs)
        out["gsm8k"] = [("math", q["question"] + "\n（请用中文讲解）", num(q["answer"].split("####")[-1])) for q in qs[: int(p.get("gsm8kN", 60))]]
    f = get(p.get("cmrcUrls") or ["https://cdn.jsdelivr.net/gh/ymcui/cmrc2018@master/squad-style-data/cmrc2018_dev.json",
                                  "https://raw.githubusercontent.com/ymcui/cmrc2018/master/squad-style-data/cmrc2018_dev.json"], "cmrc2018_dev.json")
    if f:
        items = []
        for art in json.load(open(f, encoding="utf-8"))["data"]:
            for para in art["paragraphs"]:
                for qa in para["qas"]:
                    ans = [a["text"].strip() for a in qa.get("answers", []) if a.get("text", "").strip()]
                    if ans:
                        items.append(("read", "阅读下面的资料，用一两句话回答问题。\n资料：%s\n问题：%s" % (para["context"], qa["question"]), ans))
        R.shuffle(items)
        out["read"] = items[: int(p.get("readN", 40))]
    f = get(p.get("cevalUrls") or ["https://hf-mirror.com/datasets/ceval/ceval-exam/resolve/main/ceval-exam.zip",
                                   "https://huggingface.co/datasets/ceval/ceval-exam/resolve/main/ceval-exam.zip"], "ceval-exam.zip")
    if f:
        try:
            rows = []
            with zipfile.ZipFile(f) as z:
                for n in sorted(z.namelist()):
                    m = re.match(r"^(?:.*/)?val/(college_\w+|advanced_mathematics|discrete_mathematics|probability_and_statistics|computer_architecture|operating_system|computer_network)_val\.csv$", n)
                    if not m:
                        continue
                    for r in csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8")):
                        if r.get("answer") in ("A", "B", "C", "D"):
                            q = "%s\nA. %s\nB. %s\nC. %s\nD. %s\n只回答选项字母。" % (r["question"], r["A"], r["B"], r["C"], r["D"])
                            rows.append(("choice", q, r["answer"]))
            R.shuffle(rows)
            if rows:
                out["ceval"] = rows[: int(p.get("cevalN", 60))]
        except Exception as e:
            lg.log("C-Eval 读不了（%s）：这一项不考" % e)
    for k in ("gsm8k", "read", "ceval"):
        if k not in out:
            lg.log("「%s」这一项的题下不来：这次不考它（合不合只看别的几项）" % k)
    return out


def score(kind, reply, ref):
    reply = re.sub(r"<think>.*?</think>", "", reply or "", flags=re.S).strip()
    if kind == "math":
        return int(ref is not None and num(boxed(reply)) == ref)
    if kind == "read":
        z = re.sub(r"\s", "", reply)
        return int(any(re.sub(r"\s", "", a) in z for a in ref))
    m = re.search(r"\b([ABCD])\b", reply) or re.search(r"([ABCD])", reply)
    return int(bool(m) and m.group(1) == ref)


def exam(url, S, label):
    res = {}
    for k, qs in S.items():
        hit, todo, lock = [0], list(qs), threading.Lock()

        def ask(kind, q):
            msgs = ([{"role": "system", "content": SYSTEM_MATH}] if kind == "math" else []) + [{"role": "user", "content": q}]
            body = {"messages": msgs, "temperature": 0, "max_tokens": 1200 if kind == "math" else 200, "chat_template_kwargs": {"enable_thinking": False}}
            req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=1800) as r:
                return json.loads(r.read().decode("utf-8"))["choices"][0]["message"].get("content") or ""

        def w():
            while True:
                with lock:
                    if not todo:
                        return
                    kind, q, ref = todo.pop()
                try:
                    s = ask(kind, q)
                except Exception:
                    s = ""
                with lock:
                    hit[0] += score(kind, s, ref)

        ths = [threading.Thread(target=w) for _ in range(int(p.get("parallel", 2)))]
        for x in ths:
            x.start()
        for x in ths:
            x.join()
        res[k] = round(hit[0] / max(1, len(qs)), 4)
    lg.log("%s：%s" % (label, "，".join("%s %.0f%%" % (k, v * 100) for k, v in res.items())))
    return res


S = suites()
if not S:
    lg.done(skip="回归考试的题一项都下不来：这次不合（底座不变）")
    raise SystemExit(0)
spec = dict(p.get("llm") or {})
arg = lambda layers: {"base": [{"path": l["gguf_path"], "scale": float(l.get("scale", 1))} for l in layers]} if layers else {}
lg.progress(0.1, "回归考试：现在的底座")
r0 = exam(llm_start(llm=spec, **arg(old_layers))["url"], S, "现在的底座（%d 层）" % len(old_layers))
best = None
scales = [float(x) for x in (p.get("scales") or [1.0, 0.7, 0.5])]
for n, sc in enumerate(scales):
    lg.progress(0.2 + 0.7 * n / len(scales), "回归考试：新合进去的按 ×%s" % sc)
    cand = old_layers + [dict(x, scale=sc) for x in new]
    r = exam(llm_start(llm=spec, **arg(cand))["url"], S, "合进去 ×%s" % sc)
    worse = [k for k in r if r[k] < r0[k] - TOL]
    gain = sum(r[k] - r0[k] for k in r)
    if worse:
        lg.log("×%s：%s 退步了，不要" % (sc, "、".join("%s %.0f%%→%.0f%%" % (k, r0[k] * 100, r[k] * 100) for k in worse)))
        continue
    if best is None or gain > best[1]:
        best = (sc, gain, r, cand)
lg.llm("stop")
if best is None:
    lg.done(skip="哪个比例合进去都有一项退步：这一轮不合，底座不变", **{"base_" + k: v for k, v in r0.items()})
    raise SystemExit(0)
sc, gain, r1, layers = best

# ---------------- 新一版底座永久层：stack.json + bundle.zip（每层的 .gguf，老师端要）+ train.zip（每层训练用的参数包，只有训练的电脑要）----------------
out_layers, bundle, trainz = [], os.path.join(work, "base-stack.zip"), os.path.join(work, "base-stack-train.zip")
with zipfile.ZipFile(bundle, "w", zipfile.ZIP_STORED) as z, zipfile.ZipFile(trainz, "w", zipfile.ZIP_STORED) as zt:
    for n, l in enumerate(layers):
        g = "layer%d-%s-v%s.gguf" % (n, l["name"], l.get("version"))
        pz = "layer%d-%s-v%s-peft.zip" % (n, l["name"], l.get("version"))
        z.write(l["gguf_path"], g)
        if l.get("peft_path") and os.path.exists(l["peft_path"]):
            zt.write(l["peft_path"], pz)
        out_layers.append({"name": l["name"], "version": int(l.get("version", 0)), "scale": float(l.get("scale", 1)), "gguf": g,
                           "peft": pz if l.get("peft_path") and os.path.exists(l["peft_path"]) else None, "sha": l.get("sha") or (sha(l["peft_path"]) if l.get("peft_path") and os.path.exists(l["peft_path"]) else None)})
stack = os.path.join(work, "stack.json")
json.dump({"base": "Qwen3-VL-4B-Instruct", "layers": out_layers, "exam": r1, "at": int(time.time())}, open(stack, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
lg.log("合进去了：×%s，底座现在 %d 层；回归考试 %s" % (sc, len(out_layers), "，".join("%s %.0f%%→%.0f%%" % (k, r0[k] * 100, r1[k] * 100) for k in r1)))
res = {"stack": stack, "bundle": bundle, "train": trainz, "scale": sc, "layers": len(out_layers), "mins": round((time.time() - t0) / 60, 1)}
for k in ("gsm8k", "read", "ceval"):
    if k in r1:
        res[k], res["base_" + k] = r1[k], r0[k]
lg.done(**res)
