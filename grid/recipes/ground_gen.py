"""捞小智 · 数据工厂 · 先核对再回答（同事的显卡跑本地大模型造例子；对错不靠模型自己说，靠构造时就知道的答案）
要训练的本事有两样，用同一个 LoRA（ground-lora）：
  · 照资料回答：给几段资料 + 一个问题 → 每句标出处 [n]；资料里没有就说「资料里没有」，不编
  · 逐句核对：给资料 + 一个回答 → 每句「有据 / 无据 / 矛盾」
资料用 CMRC 2018 的训练集（中文维基百科段落 + 人工标的问答，CC BY-SA 4.0；考试用它的验证集，两边不重叠）：
  · answer：真段落 + 两段别的段落当干扰 → 大模型照资料回答 → 程序核对：标准答案在回答里、标的出处里真的有这个答案、
            回答里的数字资料里都有、没说「资料里没有」→ 合格才留
  · abstain：把真段落拿掉，只留干扰段落 → 回答必须以「资料里没有」开头、不能出现标准答案 → 合格才留
  · check：拿合格的回答做核对题，标签是构造出来的（不靠模型判断）：
            原句 → 有据；把答案换成别的段落里的答案 → 矛盾；插一句别的段落里的话 → 无据
留下来的是 {"messages": [...], "kind": ...}，以后用来训练（qa_train.py，exam=ground）。
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
CACHE = os.path.abspath(os.path.join(work, "..", "..", "cache"))
URL = (t.get("llm") or "").rstrip("/")
if not URL:
    raise RuntimeError("没拿到本地大模型的地址")
PER = int(p.get("per", 24))
rnd = random.Random(int(p.get("runId", 0)) * 100003 + i)

# 回答、核对的说法：和捞小智用的（pptassist/core/ground.js）一字不差（测试里核对）
ABSTAIN = "资料里没有"
ANSWER_SYS = """你是「捞小智」，只根据下面给的资料回答问题。
· 每句话后面用方括号标出依据是第几段资料，比如 [2]；一句话用到两段就写 [1][3]。
· 资料里没写的内容一句也不要加，不要用自己的印象补充；数字、名字、日期照资料抄，不要改。
· 资料里找不到答案：第一句就说「资料里没有」并说清楚缺的是什么，然后建议去哪里查，不要猜。
· 用简体中文，先直接回答，再补充一两句资料里的相关细节。"""
CHECK_SYS = """你是核对员。下面有几段资料和一个回答，回答已经按句编了号。逐句判断：
· 有据：这句话的意思资料里明确写了，写成「第N句：有据[资料编号]」
· 无据：资料里找不到这句话说的内容（哪怕它可能是对的），写成「第N句：无据」
· 矛盾：这句话和资料说的不一样（数字、名字、日期、因果不对），写成「第N句：矛盾[资料编号]」
每句一行，不要写别的。"""
TRAIN_URLS = p.get("trainUrls") or [
    "https://cdn.jsdelivr.net/gh/ymcui/cmrc2018@master/squad-style-data/cmrc2018_train.json",
    "https://raw.githubusercontent.com/ymcui/cmrc2018/master/squad-style-data/cmrc2018_train.json",
]


def load_squad(urls, name):
    f = os.path.join(CACHE, name)
    if not os.path.exists(f) or os.path.getsize(f) < 100000:
        os.makedirs(CACHE, exist_ok=True)
        last = None
        for u in urls:
            try:
                lg.download(u, f)
                break
            except Exception as e:
                last = e
        else:
            raise RuntimeError("资料下不来：%s" % last)
    with open(f, encoding="utf-8") as fh:
        d = json.load(fh)
    out = []
    for art in d["data"]:
        for para in art["paragraphs"]:
            ctx = para["context"].strip()
            for qa in para["qas"]:
                ans = [a["text"].strip() for a in qa.get("answers", []) if a.get("text", "").strip()]
                if ans:
                    out.append({"title": art.get("title", ""), "context": ctx, "q": qa["question"].strip(), "ans": ans})
    return out


def split_ctx(ctx, size=220):
    """一个段落切成一两段资料（和 ground.js 的 chunks 差不多长）"""
    if len(ctx) <= size * 1.4:
        return [ctx]
    out, cur = [], ""
    for s in re.findall(r"[^。！？]+[。！？]?", ctx):
        if cur and len(cur) + len(s) > size:
            out.append(cur)
            cur = ""
        cur += s
    if cur:
        out.append(cur)
    return out


def as_outline(m):
    """资料换成思维导图的样子（中心主题 › 一句一个分支）：捞小智查资料时导图是这样给的（pptassist/core/mindmap.js）"""
    ss = re.findall(r"[^。！？]+[。！？]?", m["text"])
    return {"title": "导图：" + (m.get("title") or "笔记"), "text": (m.get("title") or "笔记") + " › " + "\n".join("- " + x.strip() for x in ss if x.strip())}


def mat_text(mats):
    return "\n\n".join("[%d] %s%s" % (k + 1, "（%s）" % m["title"] if m.get("title") else "", m["text"]) for k, m in enumerate(mats))


def sentences(s):
    t_ = re.sub(r"\n+", "\n", s.replace("\r", "")).strip()
    out = []
    for m in re.finditer(r"[^。！？!?\n]+(?:[。！？!?]+|$)(?:\s*(?:\[\d+\])+)?", t_):
        x = m.group(0).strip()
        if len(re.sub(r"(\[\d+\])+", "", x).strip()) >= 2:
            out.append(x)
    return out


def numbered(ss):
    return "\n".join("第%d句：%s" % (k + 1, s) for k, s in enumerate(ss))


def cites(s):
    return [int(x) for x in re.findall(r"\[(\d+)\]", s)]


def nums(s):
    return re.findall(r"\d+(?:\.\d+)?", re.sub(r"\[\d+\]", "", s))


def norm(s):
    return re.sub(r"[\s，,。．.、“”\"'《》]", "", s)


def ask(messages, temperature=0.3, max_tokens=700):
    body = {"messages": messages, "temperature": temperature, "top_p": 0.9, "max_tokens": max_tokens, "chat_template_kwargs": {"enable_thinking": False}}
    req = urllib.request.Request(URL + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        s = json.loads(r.read().decode("utf-8"))["choices"][0]["message"].get("content") or ""
    return re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()


# ---------------- 程序核对（和考试里的一样） ----------------
def good_answer(reply, mats, gold, gold_idx):
    """合格的回答：没说没有；标准答案在里面；含答案的那句标的出处里真有答案；数字资料里都有；每句都标了出处"""
    if reply.startswith(ABSTAIN):
        return "说了资料里没有"
    ss = sentences(reply)
    if not ss or len(ss) > 6:
        return "句数不对"
    if not any(norm(g) in norm(reply) for g in gold):
        return "没答到标准答案"
    all_ = "\n".join(m["text"] for m in mats)
    for s in ss:
        cs = cites(s)
        if not cs:
            return "有句子没标出处"
        if any(c < 1 or c > len(mats) for c in cs):
            return "出处编号不存在"
        if any(x not in all_ for x in nums(s)):
            return "数字资料里没有"
        if any(norm(g) in norm(s) for g in gold) and not any((c - 1) in gold_idx for c in cs):
            return "答案那句标错了出处"
    return None


def good_abstain(reply, gold):
    if not reply.startswith(ABSTAIN):
        return "没说资料里没有"
    if any(norm(g) in norm(reply) for g in gold if len(norm(g)) >= 2):
        return "说没有却说出了答案（在编）"
    if len(reply) > 160:
        return "太长"
    return None


def check_item(q, mats, ss, labels):
    user = "资料：\n%s\n\n问题：%s\n\n回答：\n%s" % (mat_text(mats), q, numbered(ss))
    out = "\n".join("第%d句：%s" % (k + 1, lab) for k, lab in enumerate(labels))
    return {"messages": [{"role": "system", "content": CHECK_SYS}, {"role": "user", "content": user}, {"role": "assistant", "content": out}], "kind": "check"}


def make_checks(q, mats, ss, gold, others):
    """从一个合格的回答造核对题：标签构造出来，不靠模型判断"""
    out = []
    base = ["有据" + "".join("[%d]" % c for c in cites(s)) for s in ss]
    out.append(check_item(q, mats, ss, base))   # 全对的也要有，学会不乱报
    all_ = "\n".join(m["text"] for m in mats)
    # 矛盾：把答案换成别的题的答案（资料里没有的）
    k = next((j for j, s in enumerate(ss) if any(norm(g) in norm(s) for g in gold)), None)
    if k is not None:
        g = next(g for g in gold if g in ss[k]) if any(g in ss[k] for g in gold) else None
        wrong = [w for w in others if w not in all_ and 1 <= len(w) <= 20 and w != g]
        if g and wrong:
            w = rnd.choice(wrong)
            ss2 = list(ss)
            ss2[k] = ss[k].replace(g, w, 1)
            lab = list(base)
            lab[k] = "矛盾" + "".join("[%d]" % c for c in cites(ss[k]))
            out.append(check_item(q, mats, ss2, lab))
    # 无据：插一句别的段落里的话（标一个假出处）
    if others_ctx:
        src = rnd.choice(others_ctx)
        fake = [s for s in re.findall(r"[^。！？]{8,60}[。！？]", src) if s[:12] not in all_]
        if fake:
            ins = fake[rnd.randrange(len(fake))] + " [%d]" % rnd.randint(1, len(mats))
            pos = rnd.randint(1, len(ss))
            ss3 = ss[:pos] + [ins] + ss[pos:]
            lab = base[:pos] + ["无据"] + base[pos:]
            out.append(check_item(q, mats, ss3, lab))
    return out


# ---------------- 开始 ----------------
lg.progress(0.02, "准备资料（CMRC 2018 训练集）")
items = load_squad(TRAIN_URLS, "cmrc2018_train.json")
rnd.shuffle(items)
pool = items[: PER * 6]
answers_all = [g for it in items[:3000] for g in it["ans"]]
others_ctx = [it["context"] for it in items[:2000]]
lg.log("资料：%d 条问答" % len(items))
out_f = os.path.join(work, "ground-%d-%d.jsonl" % (int(p.get("runId", 0)), i))
t0 = time.time()
keep, tried, why = [], 0, {}
lock = threading.Lock()
todo = list(pool)
want = {"answer": PER, "abstain": max(1, int(PER * float(p.get("abstainShare", 0.35))))}
got = {"answer": 0, "abstain": 0, "check": 0}


def one(it):
    gold = it["ans"]
    real = [{"title": it["title"], "text": x} for x in split_ctx(it["context"])]
    gold_real = [k for k, m in enumerate(real) if any(g in m["text"] for g in gold)]
    dis = []
    while len(dis) < 2:
        o = rnd.choice(items)
        if o["context"] != it["context"] and not any(g in o["context"] for g in gold):
            dis.append({"title": o["title"], "text": split_ctx(o["context"])[0]})
    with lock:
        mode = "abstain" if got["abstain"] < want["abstain"] and rnd.random() < 0.4 else "answer"
    if mode == "abstain":
        mats = list(dis)
        rnd.shuffle(mats)
    else:
        mats = real + dis
        order = list(range(len(mats)))
        rnd.shuffle(order)
        mats = [mats[k] for k in order]
        gold_real = [order.index(k) for k in gold_real]
    # 一部分资料换成思维导图的样子：学会读导图（gold 还是原文里的那几个字，判分不变）
    mats = [as_outline(m) if rnd.random() < float(p.get("outlineShare", 0.25)) else m for m in mats]
    user = "资料：\n%s\n\n问题：%s" % (mat_text(mats), it["q"])
    msgs = [{"role": "system", "content": ANSWER_SYS}, {"role": "user", "content": user}]
    for tr in range(int(p.get("tries", 2))):
        reply = ask(msgs, temperature=0.2 + 0.3 * tr)
        bad = good_abstain(reply, gold) if mode == "abstain" else good_answer(reply, mats, gold, set(gold_real))
        with lock:
            why[bad or "合格"] = why.get(bad or "合格", 0) + 1
        if bad:
            continue
        ex = [{"messages": msgs + [{"role": "assistant", "content": reply}], "kind": mode}]
        if mode == "answer":
            ex += make_checks(it["q"], mats, sentences(reply), gold, answers_all)
        return ex
    return []


def worker():
    global tried
    while True:
        with lock:
            if not todo or got["answer"] >= want["answer"]:
                return
            it = todo.pop()
            tried += 1
        try:
            ex = one(it)
        except Exception as e:
            lg.log("出错：%s" % e)
            ex = []
        with lock:
            for x in ex:
                got[x["kind"]] += 1
                keep.append(x)
            lg.progress(min(0.98, 0.05 + 0.9 * got["answer"] / want["answer"]), "照资料回答 %d/%d，资料里没有 %d，核对题 %d" % (got["answer"], want["answer"], got["abstain"], got["check"]))


ths = [threading.Thread(target=worker) for _ in range(int(p.get("parallel", 2)))]
for x in ths:
    x.start()
for x in ths:
    x.join()
with open(out_f, "w", encoding="utf-8") as fh:
    for x in keep:
        fh.write(json.dumps(x, ensure_ascii=False) + "\n")
lg.log("检查结果：" + "，".join("%s %d" % kv for kv in sorted(why.items(), key=lambda kv: -kv[1])))
if keep:
    lg.output(out_f)
lg.metric(i, kept=len(keep), rate=got["answer"] / max(1, tried), secs=time.time() - t0)
lg.done(kept=len(keep), answer=got["answer"], abstain=got["abstain"], check=got["check"], tried=tried,
        pass_rate=round(got["answer"] / max(1, tried), 3))
