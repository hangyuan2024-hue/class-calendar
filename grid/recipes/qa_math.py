"""捞捞答题 · 数据工厂 · 数学讲解（同事的显卡跑本地大模型，做题、写讲解，自动核对，对的才留）
每个小任务做一小批题（默认 12 道），两种来源轮着来：
  · gsm8k：OpenAI 的小学应用题（MIT 许可，有标准答案）→ 改写成中文 → 讲 4 遍 → 和标准答案对得上的才留
  · topics：按中国中小学数学的知识点出新题 → 讲 4 遍 → 至少 3 遍答案一样的才留（没有标准答案，用「多数一致」核对）
留下来的是「题目 + 讲给学生听的讲解」，以后用来微调老师端的答题大脑。
要在新版客户端上跑（自带 llama.cpp）；模型第一次自动下载（魔搭优先，国内快，不花存储流量费）。
"""
# needs: llm
import json
import os
import random
import re
import threading
import time
import urllib.request

import lg

t = lg.task()
p = t["job"]["params"]
i = int(t["input"].get("i", 0))
work = lg.work_dir()
URL = (t.get("llm") or "").rstrip("/")
if not URL:
    raise RuntimeError("没拿到本地大模型的地址")
PER = int(p.get("per", 12))
K = int(p.get("samples", 4))
rnd = random.Random(int(p.get("runId", 0)) * 100003 + i)
SYSTEM = p.get("system") or ("你是一位耐心的中国中小学数学老师。讲题要一步一步来，每一步说清楚为什么这样做，用学生听得懂的话；"
                             "算式写清楚；最后一行写「答案：」并把最终答案放在 \\boxed{} 里。")


# ---------------- 和本地大模型说话 ----------------
def ask(messages, temperature=0.7, max_tokens=1200, think=False):
    body = {"messages": messages, "temperature": temperature, "top_p": 0.9, "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": bool(think)}}
    req = urllib.request.Request(URL + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        m = json.loads(r.read().decode("utf-8"))["choices"][0]["message"]
    s = m.get("content") or ""
    return re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()


def fetch_text(urls):
    err = None
    for u in urls:
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "laolao-grid"}), timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # 换下一个地址
            err = e
    raise IOError("题库下载失败：%s" % err)


# ---------------- 答案核对 ----------------
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


# ---------------- 题从哪来 ----------------
GSM8K = p.get("gsm8kUrls") or [
    "https://cdn.jsdelivr.net/gh/openai/grade-school-math@master/grade_school_math/data/train.jsonl",
    "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/train.jsonl",
]
TOPICS = p.get("topics") or [
    "小学二年级：100 以内的加减法应用题", "小学二年级：表内乘法", "小学三年级：两位数乘两位数", "小学三年级：长方形和正方形的周长",
    "小学四年级：运算律与简便计算", "小学四年级：三位数乘两位数的应用题", "小学五年级：小数乘除法", "小学五年级：简易方程",
    "小学五年级：多边形的面积", "小学五年级：分数的加减法", "小学六年级：分数乘除法应用题", "小学六年级：百分数（利率、折扣）",
    "小学六年级：比和比例", "小学六年级：圆的周长和面积", "小学六年级：圆柱和圆锥的体积", "小学：鸡兔同笼", "小学：行程问题（相遇、追及）",
    "小学：工程问题", "七年级：有理数的混合运算", "七年级：一元一次方程应用题", "七年级：整式的加减", "七年级：二元一次方程组",
    "七年级：不等式与不等式组", "八年级：全等三角形", "八年级：勾股定理", "八年级：一次函数", "八年级：分式方程", "八年级：二次根式",
    "九年级：一元二次方程", "九年级：二次函数的最值", "九年级：圆的性质", "九年级：相似三角形", "九年级：锐角三角函数", "九年级：概率初步",
    "高一：集合与常用逻辑用语", "高一：函数的单调性与奇偶性", "高一：指数函数与对数函数", "高一：三角函数的图像与性质", "高一：平面向量",
    "高二：等差数列", "高二：等比数列", "高二：直线与圆的方程", "高二：椭圆", "高二：空间向量与立体几何", "高二：导数与函数的单调性",
    "高二：排列组合", "高三：二项式定理", "高三：离散型随机变量的期望", "高三：解三角形（正弦定理、余弦定理）",
]


def problems():
    src = p.get("sources") or ["gsm8k", "topics"]
    s = src[i % len(src)]
    if s == "gsm8k":
        cache = os.path.abspath(os.path.join(work, "..", "..", "cache", "gsm8k-train.jsonl"))
        if not os.path.exists(cache):
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            with open(cache + ".part", "w", encoding="utf-8") as f:
                f.write(fetch_text(GSM8K))
            os.replace(cache + ".part", cache)
        with open(cache, encoding="utf-8") as f:
            lines = [json.loads(x) for x in f if x.strip()]
        n = len(lines)
        start = (i // len(src) * PER) % max(n, 1)
        out = []
        for x in lines[start:start + PER]:
            ref = x["answer"].split("####")[-1].strip()
            out.append({"src": "gsm8k", "en": x["question"], "ref": ref})
        return s, out
    topic = TOPICS[(i // len(src)) % len(TOPICS)]
    lg.log("出题：%s" % topic)
    raw = ask([{"role": "user", "content": "请按「%s」这个知识点，出 %d 道难度不同、情境不同的题（贴近中国学校的课本和考试），"
                "每道题单独一行，以「题目：」开头，只写题目，不写答案。" % (topic, PER)}], temperature=1.0, max_tokens=2000)
    qs = [re.sub(r"^\s*(\d+[.、)]\s*)?题目[:：]\s*", "", x).strip() for x in raw.splitlines() if "题目" in x]
    return s, [{"src": "topics", "topic": topic, "q": q} for q in qs if len(q) > 8][:PER]


# ---------------- 一道题：改写 → 讲 K 遍 → 核对 ----------------
lock = threading.Lock()
kept, stats = [], {"题": 0, "留下": 0, "答错": 0, "不一致": 0}


def one(item):
    if item["src"] == "gsm8k":
        q = ask([{"role": "user", "content": "把下面这道英文数学应用题改写成自然的中文小学应用题：人名换成中文名，钱用「元」，"
                  "数字和题意一个都不能改。只输出改写后的题目。\n\n" + item["en"]}], temperature=0.2, max_tokens=600)
    else:
        q = item["q"]
    sols = []
    for _ in range(K):
        s = ask([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], temperature=0.7, max_tokens=1500)
        sols.append((s, norm(boxed(s))))
    ans = [a for _, a in sols if a]
    good = []
    if item["src"] == "gsm8k":
        ref = norm(item["ref"])
        good = [s for s, a in sols if a == ref]
        why = "答错"
    elif ans:
        top = max(set(ans), key=ans.count)
        if ans.count(top) >= max(3, (K * 3 + 3) // 4):
            good = [s for s, a in sols if a == top]
        why = "不一致"
    else:
        why = "不一致"
    with lock:
        stats["题"] += 1
        if not good:
            stats[why] += 1
            return
        stats["留下"] += 1
        # 最多留两种讲法：讲法不一样，学得更好
        for s in sorted(set(good), key=len)[:2]:
            kept.append({"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}, {"role": "assistant", "content": s}],
                         "meta": {k: v for k, v in item.items() if k != "q"}})


t0 = time.time()
src, items = problems()
lg.log("这一批：%d 道（%s）" % (len(items), "GSM8K 改写" if src == "gsm8k" else "按知识点出题"))
todo = list(items)
done_n = [0]


def worker():
    while True:
        with lock:
            if not todo:
                return
            it = todo.pop(0)
        try:
            one(it)
        except Exception as e:  # 一道题出错不影响别的
            lg.log("有一道题出错了：%s" % str(e)[:120])
        with lock:
            done_n[0] += 1
            lg.progress(done_n[0] / max(len(items), 1), "第 %d/%d 道" % (done_n[0], len(items)))


ths = [threading.Thread(target=worker) for _ in range(int(p.get("parallel", 2)))]   # 本地大模型同时处理两道（-np 2）
for th in ths:
    th.start()
for th in ths:
    th.join()

out = os.path.join(work, "qa-math-%d-%d.jsonl" % (int(p.get("runId", 0)), i))
with open(out, "w", encoding="utf-8") as f:
    for r in kept:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
if kept:
    lg.output(out)
lg.log("做了 %d 道，留下 %d 道（%d 条讲解）；答错 %d、答案不一致 %d" % (stats["题"], stats["留下"], len(kept), stats["答错"], stats["不一致"]))
lg.metric(i, kept=len(kept), rate=stats["留下"] / max(stats["题"], 1), secs=time.time() - t0)
lg.done(kept=len(kept), problems=stats["题"], rate=round(stats["留下"] / max(stats["题"], 1), 3), source=src)
