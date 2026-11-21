"""捞捞答题 · 前沿搜题（CPU 也能算：「搜索、验证、学会、再搜索」这个循环里的搜索和验证）
题目由程序出、答案由程序算（不靠任何模型判对错），难度分 1～8 级，题型：
  四则混合、简易方程、百分数和折扣、行程和工程、排列组合、数列求和、余数、面积周长
用现在发布的模型（底座的永久层 base-stack + 答题 LoRA qa-lora，有哪个用哪个）每道题做 samples 遍：
  · 全做对 → 太简单，这一题型升一级；全做错 → 太难，降一级（这道题记进「前沿难题」，以后专门考它能不能做出来：模型和老师都做不出的题，做出来了才叫质变）
  · 有对有错 → 正是该学的：做对的讲法留下（最多两种），交给答题大脑训练（tag 和 qa_math 一样：qa-math）
老师和学生是同一个模型：留下的都是它自己做对、程序验证过的，所以下一版学的是它自己最好的那部分；一版版往上走。
"""
# needs: llm
import json
import math
import os
import random
import re
import threading
import time
import urllib.request
from fractions import Fraction

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
i = int(t["input"].get("i", 0))
work = lg.work_dir()
PER = int(p.get("per", 16))
K = int(p.get("samples", 6))
rnd = random.Random(int(p.get("runId", 0)) * 100003 + i * 7919 + int(time.time()) // 3600)
# 讲题的说法：和 qa_math.py、qa_train.py 一字不差（测试里核对）
SYSTEM = p.get("system") or ("你是一位耐心的中国中小学数学老师。讲题要一步一步来，每一步说清楚为什么这样做，用学生听得懂的话；"
                             "算式写清楚；最后一行写「答案：」并把最终答案放在 \\boxed{} 里。")


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


def norm(a):
    if a is None:
        return None
    a = str(a).replace("\\,", "").replace("，", ",").replace("\\text", "").replace("\\dfrac", "\\frac").replace("$", "")
    a = re.sub(r"\\(left|right|!|;|quad)", "", a)
    a = re.sub(r"(元|个|人|只|米|千米|厘米|分钟|小时|天|岁|本|辆|张|块|次|分|秒|克|千克|升|毫升|%|度|°)$", "", a.strip())
    a = re.sub(r"\s+", "", a).rstrip(".。")
    m = re.fullmatch(r"\\frac\{(-?\d+)\}\{(-?\d+)\}", a)
    if m and int(m.group(2)) != 0:
        return str(round(int(m.group(1)) / int(m.group(2)), 6))
    m = re.fullmatch(r"-?[\d,]*\.?\d+", a)
    if m:
        try:
            v = float(a.replace(",", ""))
            return str(int(v)) if v == int(v) else str(round(v, 6))
        except ValueError:
            pass
    return a


def ans_str(v):
    """程序算出来的答案 → 和 norm() 一样的写法"""
    v = Fraction(v)
    if v.denominator == 1:
        return str(v.numerator)
    return str(round(v.numerator / v.denominator, 6))


# ---------------- 出题：答案由程序算，难度 1～8 ----------------
NAMES = ["小明", "小红", "小刚", "小丽", "小华", "小军", "小芳", "小强"]


def g_arith(L, R):
    n = 2 + L // 2
    big = 10 ** (1 + L // 3)
    sym = {"+": "+", "-": "-", "×": "*", "÷": "/"}
    while True:
        xs = [R.randint(2, big) for _ in range(n)]
        ops = [R.choice("+-×÷") for _ in range(n - 1)]
        show = [str(xs[0])]
        py = ["Fraction(%d)" % xs[0]]
        for o, x in zip(ops, xs[1:]):
            show += [o, str(x)]
            py += [sym[o], "Fraction(%d)" % x]
        if L >= 5:   # 给相邻两个数加括号
            k = R.randint(0, n - 2) * 2
            for lst in (show, py):
                lst[k] = "(" + lst[k]
                lst[k + 2] = lst[k + 2] + ")"
        try:
            val = eval(" ".join(py), {"Fraction": Fraction})
        except ZeroDivisionError:
            continue
        if val.denominator <= 8 and abs(val) < 10 ** 7:
            return "计算：%s = ?（不能整除时写成分数或小数）" % " ".join(show), val


def g_equation(L, R):
    x = R.randint(-5 if L >= 4 else 1, 10 * L)
    a = R.randint(2, 3 + L)
    b = R.randint(1, 10 * L)
    if L <= 3:
        return "解方程：%dx + %d = %d，x 等于多少？" % (a, b, a * x + b), Fraction(x)
    c = R.randint(1, a - 1)
    d = (a - c) * x + b
    return "解方程：%dx + %d = %sx + %d，x 等于多少？" % (a, b, str(c) if c > 1 else "", d), Fraction(x)


def g_percent(L, R):
    price = R.randint(2, 20) * 10 * (1 + L)
    off = R.choice([95, 90, 85, 80, 75, 70, 60])
    zhe = ("%g" % (off / 10))
    nm = R.choice(NAMES)
    if L <= 3:
        return "一件衣服原价 %d 元，打 %s 折出售，现价多少元？" % (price, zhe), Fraction(price * off, 100)
    n = R.randint(2, 2 + L)
    coupon = R.randint(1, 5) * 10
    tot = Fraction(price * n * off, 100)
    pay = tot - coupon if tot >= coupon * 2 else tot
    return "%s买了 %d 本原价 %d 元的书，先打 %s 折，再用一张满 %d 减 %d 的券（够满就减一次），一共付多少元？" % (nm, n, price, zhe, coupon * 2, coupon), pay


def g_motion(L, R):
    if R.random() < 0.5:
        v1, v2 = R.randint(3, 8 + L) * 5, R.randint(3, 8 + L) * 5
        tm = R.randint(1, 3 + L)
        d = (v1 + v2) * tm
        return "甲乙两地相距 %d 千米，两辆车同时从两地相向开出，速度分别是每小时 %d 千米和 %d 千米，几小时后相遇？" % (d, v1, v2), Fraction(tm)
    a, b = R.randint(2, 6 + L), R.randint(2, 6 + L)
    return "一项工程，甲单独做 %d 天完成，乙单独做 %d 天完成。两人合作，几天完成？（写成分数或小数）" % (a, b), Fraction(a * b, a + b)


def g_comb(L, R):
    n = R.randint(4, 6 + L)
    k = R.randint(2, min(n - 1, 2 + L // 2))
    if R.random() < 0.5:
        return "从 %d 个不同的人里选 %d 个组成小组（不分顺序），有多少种选法？" % (n, k), Fraction(math.comb(n, k))
    return "从 %d 个不同的人里选 %d 个排成一排，有多少种排法？" % (n, k), Fraction(math.perm(n, k))


def g_series(L, R):
    a1, d = R.randint(1, 10 * L), R.randint(1, 3 + L)
    n = R.randint(5, 10 + 5 * L)
    if L >= 6 and R.random() < 0.5:
        q = R.randint(2, 3)
        n = R.randint(4, 6 + L // 2)
        return "一个等比数列，首项是 %d，公比是 %d，前 %d 项的和是多少？" % (a1, q, n), Fraction(a1 * (q ** n - 1), q - 1)
    return "一个等差数列，首项是 %d，公差是 %d，前 %d 项的和是多少？" % (a1, d, n), Fraction(n * (2 * a1 + (n - 1) * d), 2)


def g_mod(L, R):
    m = R.randint(3, 6 + L)
    if L <= 4:
        x = R.randint(10 ** L, 10 ** (L + 1))
        return "%d 除以 %d，余数是多少？" % (x, m), Fraction(x % m)
    b, e = R.randint(2, 9), R.randint(10, 30 * L)
    return "%d 的 %d 次方除以 %d，余数是多少？" % (b, e, m), Fraction(pow(b, e, m))


def g_area(L, R):
    a, b = R.randint(3, 10 * L), R.randint(3, 10 * L)
    if L <= 2:
        return "一个长方形长 %d 米、宽 %d 米，周长是多少米？" % (a, b), Fraction(2 * (a + b))
    if L <= 5:
        h = R.randint(2, 10 * L)
        return "一个梯形上底 %d 厘米、下底 %d 厘米、高 %d 厘米，面积是多少平方厘米？" % (a, b, h), Fraction((a + b) * h, 2)
    c = R.randint(1, min(a, b) - 1) if min(a, b) > 2 else 1
    return ("一块长 %d 米、宽 %d 米的长方形草地，中间修了两条互相垂直、宽都是 %d 米的小路（一条平行于长、一条平行于宽），剩下的草地面积是多少平方米？"
            % (a, b, c)), Fraction((a - c) * (b - c))


FAMILIES = {"arith": g_arith, "equation": g_equation, "percent": g_percent, "motion": g_motion, "comb": g_comb, "series": g_series, "mod": g_mod, "area": g_area}


# ---------------- 用现在发布的模型做题 ----------------
files = t.get("files") or {}
base, lora = [], None
stack_f = files.get("m_base-stack_stack")
if stack_f and os.path.exists(stack_f) and files.get("m_base-stack_bundle"):
    import zipfile
    st = json.load(open(stack_f, encoding="utf-8"))
    bdir = os.path.join(work, "stack")
    with zipfile.ZipFile(files["m_base-stack_bundle"]) as z:
        z.extractall(bdir)
    base = [{"path": os.path.join(bdir, os.path.basename(l["gguf"])), "scale": float(l.get("scale", 1))} for l in st.get("layers", []) if l.get("gguf")]
    absorbed = {(l["name"], int(l.get("version", 0))) for l in st.get("layers", [])}
else:
    absorbed = set()
ver = ((t.get("extra") or {}).get("models") or {})
# 已经合进底座的那一版答题 LoRA 不再单独挂（不然算了两遍）
if files.get("m_qa-lora_lora") and not any(n == "qa-lora" and v >= int(ver.get("qa-lora", 0)) for n, v in absorbed):
    lora = files["m_qa-lora_lora"]
if base or lora:
    URL = llm_start(**({"base": base} if base else {}), **({"lora": lora} if lora else {}))["url"].rstrip("/")
    lg.log("用现在发布的模型做题：底座永久层 %d 层%s" % (len(base), "，加答题 LoRA 第 %s 版" % ver.get("qa-lora") if lora else ""))
else:
    URL = (t.get("llm") or "").rstrip("/")
if not URL:
    raise RuntimeError("没拿到本地大模型的地址")


def ask(q, temperature):
    body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], "temperature": temperature, "top_p": 0.95,
            "max_tokens": int(p.get("maxTokens", 1200)), "chat_template_kwargs": {"enable_thinking": False}}
    req = urllib.request.Request(URL + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        s = json.loads(r.read().decode("utf-8"))["choices"][0]["message"].get("content") or ""
    return re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()


# ---------------- 开始 ----------------
t0 = time.time()
fams = [f for f in (p.get("families") or list(FAMILIES)) if f in FAMILIES]
level = {f: int((p.get("levels") or {}).get(f, rnd.randint(2, 5))) for f in fams}
lock = threading.Lock()
kept, hard = [], []
stats = {"题": 0, "全对": 0, "全错": 0, "该学": 0}
by_level = {}
todo = [rnd.choice(fams) for _ in range(PER)]


def one(fam):
    with lock:
        L = level[fam]
    q, ans = FAMILIES[fam](L, random.Random(rnd.random()))
    ref = ans_str(ans)
    sols = []
    for k in range(K):
        s = ask(q, 0.6 + 0.4 * k / max(1, K - 1))
        sols.append((s, norm(boxed(s)) == ref))
    right = [s for s, ok in sols if ok]
    with lock:
        stats["题"] += 1
        b = by_level.setdefault("%s-%d" % (fam, L), [0, 0])
        b[0] += len(right)
        b[1] += K
        if len(right) == K:
            stats["全对"] += 1
            level[fam] = min(8, level[fam] + 1)
        elif not right:
            stats["全错"] += 1
            level[fam] = max(1, level[fam] - 1)
            hard.append({"q": q, "answer": ref, "family": fam, "level": L})
        else:
            stats["该学"] += 1
            for s in sorted(set(right), key=len)[:2]:
                kept.append({"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}, {"role": "assistant", "content": s}],
                             "meta": {"src": "search", "family": fam, "level": L, "pass": round(len(right) / K, 3)}})


def worker():
    while True:
        with lock:
            if not todo:
                return
            fam = todo.pop()
        try:
            one(fam)
        except Exception as e:
            lg.log("有一道题出错了：%s" % str(e)[:120])
        with lock:
            lg.progress(stats["题"] / PER, "第 %d/%d 道（该学的 %d 道）" % (stats["题"], PER, stats["该学"]))


ths = [threading.Thread(target=worker) for _ in range(int(p.get("parallel", 1)))]
for x in ths:
    x.start()
for x in ths:
    x.join()

tag = int(p.get("runId", 0))
out = os.path.join(work, "qa-math-search-%d-%d.jsonl" % (tag, i))
with open(out, "w", encoding="utf-8") as f:
    for r in kept:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
if kept:
    lg.output(out)
if hard:   # 前沿难题（现在的模型一道都做不对）：攒起来当「质变」考试的题
    hf = os.path.join(work, "frontier-%d-%d.jsonl" % (tag, i))
    with open(hf, "w", encoding="utf-8") as f:
        for r in hard:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    lg.output(hf)
lg.log("做了 %d 道：全对 %d（太简单，升级）、全错 %d（太难，降级、记进前沿难题）、有对有错 %d（留下 %d 条讲解）；现在的难度：%s"
       % (stats["题"], stats["全对"], stats["全错"], stats["该学"], len(kept), "，".join("%s %d 级" % kv for kv in sorted(level.items()))))
lg.metric(i, kept=len(kept), learn=stats["该学"] / max(1, stats["题"]), secs=time.time() - t0)
lg.done(kept=len(kept), problems=stats["题"], learn=stats["该学"], easy=stats["全对"], hard=len(hard), levels=level,
        pass_by_level={k: round(a / b, 3) for k, (a, b) in by_level.items()}, base_layers=len(base), lora=bool(lora))
