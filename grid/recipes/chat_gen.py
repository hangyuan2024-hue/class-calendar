"""捞捞对话 · 数据工厂 · 口语对话（同事的显卡跑本地大模型，造「打电话时怎么说话」的例子，自动检查，合格的才留）
成品展示里能像打电话一样和捞小智说话：它说的每一句都会被念出来，所以回答要
  · 短、像说话：一次两三句，先说要紧的；长的先讲第一步，再问要不要接着讲
  · 念得出来：不带列表、标题、符号、表情、LaTeX；公式和数字按读法说（「x 的平方」「三分之二」）
  · 听错字也懂：对方的话是语音识别出来的，可能有同音错字、没标点、夹着「嗯」「那个」
每个小任务造一小批（默认 16 条），几种场景轮着来：
  · explain 讲概念 / 讲题（口头）：按学科知识点出一个学生会问的问题 → 用口语答两遍，挑念得出来、长短合适的
  · math    口头算题：出一道小应用题 → 先在纸上认真解一遍（\\boxed{} 里的答案）→ 口语讲解里的答案和它对得上才留
  · chat    闲聊、鼓励、问它是谁（考试紧张、学不进去…）
  · clarify 没说清楚的话（「帮我弄一下那个」）→ 要先问一句、很短
  · 一部分讲解再追问一句（「能再简单点吗」「举个例子呗」），两轮的对话
  · 三成左右把学生那句改成「识别出来的样子」（同音错字、去掉标点、加「嗯」「那个」），回答不变：学会听错字也懂
留下来的是「对话 + 口语回答」，以后用来微调口语对话大脑（qa_train.py，exam=chat）。
"""
# needs: llm
import json
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
PER = int(p.get("per", 16))
rnd = random.Random(int(p.get("runId", 0)) * 100003 + i)

# 语音通话的规则：和成品展示打电话时加给捞小智的那一段一字不差（pptassist/core/xiaozhi.js 的 SPOKEN；测试里核对）
SPOKEN = """现在是语音通话：你说的每一句都会被念出来。
· 说口语、用短句，一次说两三句，先说最要紧的；要讲的内容很长，先讲第一步，再问对方要不要接着讲。
· 不要用列表、标题、加粗、表格、表情、链接和代码；不要写 LaTeX 和数学符号，公式和数字按读法说（比如「x 的平方」「三分之二」「根号二」）。
· 对方的话是语音识别出来的，可能有同音错字、没有标点、夹着「嗯」「那个」：按最可能的意思理解；实在听不懂、或者有好几种意思，就简单问一句。
· 不知道的就说不知道，不要编。"""
SYSTEM = p.get("system") or ("你是「捞小智」，捞捞课程表的校园智能体，会讲题、做 PPT、办教务的事。\n" + SPOKEN)


# ---------------- 和本地大模型说话 ----------------
def ask(messages, temperature=0.7, max_tokens=600, think=False):
    body = {"messages": messages, "temperature": temperature, "top_p": 0.9, "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": bool(think)}}
    req = urllib.request.Request(URL + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        m = json.loads(r.read().decode("utf-8"))["choices"][0]["message"]
    s = m.get("content") or ""
    return re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()


# ---------------- 念不念得出来（规则检查，不靠模型自己说） ----------------
# 场景 → 最多多少个字（太长了打电话听着累）
LIMIT = {"explain": 220, "math": 170, "chat": 100, "clarify": 60, "followup": 200}
BAD = [
    (re.compile(r"\n"), "分了好几段"),
    (re.compile(r"[#*`|$\\^_~<>\[\]{}]"), "带符号"),
    (re.compile(r"https?://|www\."), "带链接"),
    (re.compile(r"(^|[。！？\s])\s*(\d+[.、)](?!\d)|[-•·])\s*\S"), "像列表"),
    (re.compile(r"[²³√≤≥≠×÷π∑∫±→⇒°%/+=]"), "数学符号没按读法说"),
    (re.compile(r"[\U0001F300-\U0001FAFF☀-➿]"), "带表情"),
    (re.compile(r"以下是|如下[：:]|总结如下|见下"), "像在写文章"),
]


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


# ---------------- 识别出来的样子：同音错字、没标点、加口头禅 ----------------
HOMO = [("的", "得"), ("在", "再"), ("做", "作"), ("是", "事"), ("他", "她"), ("那", "哪"), ("题", "提"), ("数组", "书组"), ("函数", "寒数"), ("方程", "方城"),
        ("排序", "排续"), ("指针", "指真"), ("循环", "寻环"), ("变量", "变亮"), ("公式", "公事"), ("质数", "指数"), ("因式", "音式"), ("化学", "画学"), ("物理", "无理"),
        ("向量", "像量"), ("概率", "盖率"), ("平方", "平房"), ("周长", "周常"), ("面积", "面基"), ("课表", "课标"), ("请假", "清假"), ("考试", "烤试"), ("作业", "做业")]
FILL = ["嗯", "那个", "就是", "呃", "嗯那个"]


def asr_noise(q, r):
    s = q
    hits = [(a, b) for a, b in HOMO if a in s]
    r.shuffle(hits)
    for a, b in hits[: r.choice([1, 1, 2])]:
        k = s.find(a)
        s = s[:k] + b + s[k + len(a):]
    s = re.sub(r"[，。！？、,.!?；;：:「」“”\"']", " " if r.random() < 0.3 else "", s).strip()
    if r.random() < 0.6:
        s = r.choice(FILL) + (" " if r.random() < 0.5 else "") + s
    if r.random() < 0.3 and len(s) > 8:
        k = r.randint(3, len(s) - 3)
        s = s[:k] + r.choice(FILL) + s[k:]
    return re.sub(r"\s+", " ", s).strip()


# ---------------- 数字（口语里的「十八」也算对） ----------------
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


# ---------------- 场景 ----------------
WHO = ["大一学生", "大二学生", "高中生", "初中生", "大学老师", "辅导员"]
TOPICS = {
    "数学": ["一元二次方程", "函数的单调性", "导数的意义", "三角函数", "等差数列", "概率", "向量", "勾股定理", "分数的加减", "极限", "矩阵乘法", "排列组合"],
    "编程": ["冒泡排序", "二分查找", "递归", "数组和链表的区别", "指针", "for 循环", "函数的参数", "栈和队列", "哈希表", "时间复杂度", "面向对象", "变量的作用域"],
    "物理": ["牛顿第二定律", "动能和势能", "电阻", "欧姆定律", "光的折射", "惯性", "加速度"],
    "化学": ["化学方程式配平", "酸碱中和", "氧化还原", "摩尔", "元素周期表"],
    "生物": ["光合作用", "细胞分裂", "DNA", "遗传规律"],
    "语文": ["比喻和拟人", "议论文的结构", "文言文里的之", "诗歌的意象"],
    "英语": ["现在完成时", "定语从句", "被动语态", "冠词 a 和 the"],
    "学习方法": ["怎么背单词", "考前怎么复习", "上课走神怎么办", "怎么做错题本", "怎么安排时间"],
}
CHAT = ["你是谁", "你会干什么", "今天好累啊", "明天考试好紧张", "学不进去怎么办", "谢谢你", "你说话能慢一点吗", "我刚才说到哪了", "讲个冷笑话", "你是真人吗",
        "我数学好差", "室友太吵了睡不着", "期末周压力好大", "早上好", "再见啦"]
VAGUE = ["帮我弄一下那个", "明天那个改一下", "就是上次那个", "帮我查一下", "这个怎么弄", "给我订一个", "把它发给我", "那个什么时候", "你看着办吧", "改成那样"]
FOLLOW = ["能再说简单一点吗", "举个例子呗", "那为什么是这样", "嗯然后呢", "没听懂再讲一遍", "这个考试会考吗", "有什么好记的办法吗"]


def gen_question(kind):
    who = rnd.choice(WHO)
    if kind == "chat":
        base = rnd.choice(CHAT)
        return ask([{"role": "user", "content": "下面这句话是一个%s对着校园智能助手随口说的。换一种说法再说一遍，意思不变，口语，只输出这一句：\n%s" % (who, base)}], temperature=0.9, max_tokens=60) or base, {"seed": base}
    if kind == "clarify":
        base = rnd.choice(VAGUE)
        return ask([{"role": "user", "content": "下面这句话是一个人没说清楚就发出去的语音，换一种同样没说清楚、同样含糊的说法，只输出这一句：\n%s" % base}], temperature=0.9, max_tokens=60) or base, {"seed": base}
    subj = rnd.choice(list(TOPICS))
    topic = rnd.choice(TOPICS[subj])
    if kind == "math":
        q = ask([{"role": "user", "content": "出一道和「%s」有关的小题，%s能口算或者心算的，数字简单、答案是一个数。像在语音里问助手那样说出来，口语，20～50 个字，只输出这一句。" % (rnd.choice(TOPICS["数学"]), who)}], temperature=0.9, max_tokens=120)
        return q, {"subject": "数学"}
    q = ask([{"role": "user", "content": "一个%s在语音里问校园智能助手一个关于「%s」（%s）的问题。写出他会怎么说：像真的在说话，口语，10～40 个字，只输出这一句。" % (who, topic, subj)}], temperature=0.9, max_tokens=100)
    return q, {"subject": subj, "topic": topic}


def clean_q(q):
    q = re.sub(r"<think>.*?</think>", "", q or "", flags=re.S).strip().strip("\"“”「」").strip()
    return q.split("\n")[0].strip()


def answer(msgs, kind, english):
    """口语答两遍，挑念得出来的（两遍都行挑长短更合适的）；都不行返回 (None, 原因)"""
    cands, whys = [], []
    for _ in range(int(p.get("tries", 2))):
        s = ask([{"role": "system", "content": SYSTEM}] + msgs, temperature=0.7, max_tokens=500).strip()
        why = speakable(s, kind, english)
        if why:
            whys.append(why)
        else:
            cands.append(s)
    if not cands:
        return None, whys[0] if whys else "没答"
    ideal = {"explain": 110, "math": 80, "chat": 40, "clarify": 25, "followup": 100}.get(kind, 90)
    return min(cands, key=lambda s: abs(len(s) - ideal)), None


kept, lock = [], threading.Lock()
stats = {"问": 0, "留下": 0, "念不出来": 0, "答错": 0, "没出好题": 0}
why_n = {}


def one(kind):
    q, meta = gen_question(kind)
    q = clean_q(q)
    if not (4 <= len(q) <= 80):
        with lock:
            stats["问"] += 1
            stats["没出好题"] += 1
        return
    english = meta.get("subject") == "英语"
    ref = None
    if kind == "math":
        # 先在纸上认真解一遍：口语里的答案要和它对上
        w = ask([{"role": "system", "content": "你是数学老师。一步一步解，最后一行写「答案：」并把最终答案（一个数）放在 \\boxed{} 里。"}, {"role": "user", "content": q}], temperature=0.2, max_tokens=900)
        ref = num(boxed(w))
        if ref is None:
            with lock:
                stats["问"] += 1
                stats["没出好题"] += 1
            return
    noisy = rnd.random() < float(p.get("noise", 0.35))
    said = asr_noise(q, rnd) if noisy else q
    msgs = [{"role": "user", "content": said}]
    a, why = answer(msgs, kind, english)
    if a and kind == "math" and ref not in numbers_in(a):
        a, why = None, "答错"
    with lock:
        stats["问"] += 1
        if not a:
            stats["答错" if why == "答错" else "念不出来"] += 1
            why_n[why] = why_n.get(why, 0) + 1
            return
    rows = [{"messages": [{"role": "system", "content": SYSTEM}] + msgs + [{"role": "assistant", "content": a}], "meta": dict(meta, kind=kind, noisy=noisy, heard=q if noisy else None)}]
    # 讲解再追问一句：两轮的对话
    if kind == "explain" and rnd.random() < float(p.get("followup", 0.3)):
        f = rnd.choice(FOLLOW)
        f = asr_noise(f, rnd) if rnd.random() < 0.3 else f
        msgs2 = msgs + [{"role": "assistant", "content": a}, {"role": "user", "content": f}]
        a2, _ = answer(msgs2, "followup", english)
        if a2:
            rows.append({"messages": [{"role": "system", "content": SYSTEM}] + msgs2 + [{"role": "assistant", "content": a2}], "meta": dict(meta, kind="followup")})
    with lock:
        stats["留下"] += 1
        kept.extend(rows)


MIX = p.get("mix") or {"explain": 5, "math": 2, "chat": 2, "clarify": 1}
bag = [k for k, n in MIX.items() for _ in range(int(n))]
todo = [rnd.choice(bag) for _ in range(PER)]
total = len(todo)
t0 = time.time()
lg.log("这一批：%d 条（%s）" % (total, "、".join("%s %d" % (k, todo.count(k)) for k in MIX if todo.count(k))))
done_n = [0]


def worker():
    while True:
        with lock:
            if not todo:
                return
            k = todo.pop(0)
        try:
            one(k)
        except Exception as e:  # 一条出错不影响别的
            lg.log("有一条出错了：%s" % str(e)[:120])
        with lock:
            done_n[0] += 1
            lg.progress(done_n[0] / max(total, 1), "第 %d/%d 条" % (done_n[0], total))


ths = [threading.Thread(target=worker) for _ in range(int(p.get("parallel", 2)))]
for th in ths:
    th.start()
for th in ths:
    th.join()

out = "%s/chat-%d-%d.jsonl" % (work, int(p.get("runId", 0)), i)
with open(out, "w", encoding="utf-8") as f:
    for r in kept:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
if kept:
    lg.output(out)
top = sorted(why_n.items(), key=lambda x: -x[1])[:3]
lg.log("问了 %d 条，留下 %d 条（%d 段对话）；念不出来 %d%s、答错 %d、没出好题 %d" % (stats["问"], stats["留下"], len(kept), stats["念不出来"],
                                                               "（" + "、".join("%s %d" % x for x in top) + "）" if top else "", stats["答错"], stats["没出好题"]))
lg.metric(i, kept=len(kept), rate=stats["留下"] / max(stats["问"], 1), secs=time.time() - t0)
lg.done(kept=len(kept), asked=stats["问"], rate=round(stats["留下"] / max(stats["问"], 1), 3))
