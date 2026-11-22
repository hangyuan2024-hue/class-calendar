"""捞小智 · PPT 操作工厂（练「听懂老师的要求 → 调对工具 → 改对 PPT」，对错全由程序判，不要人）
练习场是捞捞PPT助手自己改 PPT 的那一套（app/ppt/pptlab.js，用软件自带的 Node 跑）：
  · 程序随机做一份课件（课本上的公开知识点 + 随机版式、故意弄乱）+ 出一道老师式的要求，带标准答案
  · 用现在发布的模型（底座永久层 base-stack + PPT LoRA ppt-lora，有哪个用哪个）每道题做 tries 遍（有一点随机）：
    真的调工具去改，改完程序打开文件判对错（标题是不是那几个字、别的页有没有被误改、颜色、页数……）
  · 做对的那一遍留下来当训练数据（模型自己写得出来的，口吻不跑偏）；每一步一条（看过的、调过的工具和结果都在里面）
  · 几遍都没做对：按 demoShare 的比例改用程序写的示范（参考做法真的去改，也要判对才算）；其余的记下来，说明现在还不会
工具调用用通义千问自己的格式（llama.cpp 的 OpenAI 接口 + tools），和老师那边用的一模一样。
留下来的是 {"messages": [...], "tools": "$ppt", "kind": "ppt", "fam": ...}，以后用来训练（qa_train.py，exam=ppt）。
"""
# needs: llm
import json
import os
import random
import re
import subprocess
import threading
import time
import urllib.request

import lg


def llm_start(**kw):
    """开本地大模型；要挂底座永久层却没挂上（旧版客户端不认得 base）→ 这台电脑做不了，交给别的电脑"""
    r = lg.llm("start", **kw)
    if kw.get("base") and r.get("base") != len(kw["base"]):
        why = "这台电脑的客户端太旧，挂不上底座永久层：更新客户端以后再领这个任务"
        getattr(lg, "unfit", lambda w: None)(why)
        raise RuntimeError(why)
    return r


# ==== PPT 练习场（ppt_gen.py 和 qa_train.py 里这一段一字不差，测试里核对）====
class PptLab:
    """捞捞PPT助手的练习场（app/ppt/pptlab.js）：出题、调工具、判对错。一行一个 JSON 命令"""

    def __init__(self):
        node, lab = os.environ.get("LG_NODE"), os.environ.get("LG_PPTLAB")
        if not node or not lab or not os.path.exists(lab):
            why = "这台电脑的客户端太旧，没有 PPT 练习场：更新客户端以后再领这个任务"
            getattr(lg, "unfit", lambda w: None)(why)
            raise RuntimeError(why)
        env = dict(os.environ, ELECTRON_RUN_AS_NODE="1")
        self.p = subprocess.Popen([node, lab], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env, cwd=os.path.dirname(lab))
        self.lock = threading.Lock()

    def ask(self, **m):
        with self.lock:
            self.p.stdin.write((json.dumps(m, ensure_ascii=False) + "\n").encode("utf-8"))
            self.p.stdin.flush()
            line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("PPT 练习场退出了")
        return json.loads(line.decode("utf-8"))

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=10)
        except Exception:
            try:
                self.p.kill()
            except Exception:
                pass


def ppt_chat(url, msgs, tools, temp, extra=None):
    body = {"messages": msgs, "tools": tools, "temperature": temp, "top_p": 0.95, "max_tokens": 1500, "chat_template_kwargs": {"enable_thinking": False}, **(extra or {})}
    req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read().decode("utf-8"))["choices"][0]["message"]


def ppt_episode(url, lab, seed, split, temp=0.0, rounds=8, extra=None):
    """做一道题：模型说一句 → 调工具（练习场真的去改，结果原样给它看）→ 再说……直到不调工具为止；最后程序判对错。
    返回 dict(ok, why, fam, messages 整段对话（第一条是系统提示）, steps 模型说话的那几条的位置, id 题号)"""
    t = lab.ask(op="task", seed=seed, split=split)
    if not t.get("ok"):
        raise RuntimeError(t.get("error") or "出不了题")
    msgs = [{"role": "system", "content": t["system"]}] + t["messages"]
    calls, reply, steps = [], "", []
    for r in range(rounds):
        m = ppt_chat(url, msgs, t["tools"], temp, extra)
        content = re.sub(r"<think>.*?</think>", "", m.get("content") or "", flags=re.S).strip()
        am = {"role": "assistant", "content": content}
        tc = m.get("tool_calls") or []
        if tc:
            am["tool_calls"] = [{"id": c.get("id") or "call_%d_%d" % (r, j), "type": "function",
                                 "function": {"name": (c.get("function") or {}).get("name") or "", "arguments": (c.get("function") or {}).get("arguments") or "{}"}} for j, c in enumerate(tc)]
        msgs.append(am)
        steps.append(len(msgs) - 1)
        if not tc:
            reply = content
            break
        for c in am["tool_calls"]:
            name = c["function"]["name"]
            calls.append(name)
            try:
                args = json.loads(c["function"]["arguments"] or "{}")
            except ValueError:
                args = {}
            res = lab.ask(op="tool", id=t["id"], name=name, args=args if isinstance(args, dict) else {})
            out = res["result"] if res.get("ok") else {"error": res.get("error")}
            msgs.append({"role": "tool", "tool_call_id": c["id"], "name": name, "content": json.dumps(out, ensure_ascii=False, separators=(",", ":"))[:6000]})
    ck = lab.ask(op="check", id=t["id"], reply=reply, calls=calls)
    return {"ok": bool(ck.get("pass")), "why": ck.get("why"), "fam": t["fam"], "messages": msgs, "steps": steps, "id": t["id"], "tools": t["tools"], "nref": t.get("nref", 0)}
# ==== PPT 练习场 结束 ====


t = lg.task()
p = t["job"]["params"]
i = int(t["input"].get("i", 0))
work = lg.work_dir()
PER = int(p.get("per", 12))
TRIES = int(p.get("tries", 4))
run_id = int(p.get("runId", 0))
rnd = random.Random(run_id * 100003 + i * 7919 + int(time.time()) // 3600)

# ---------------- 用现在发布的模型 ----------------
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
if files.get("m_ppt-lora_lora") and not any(n == "ppt-lora" and v >= int(ver.get("ppt-lora", 0)) for n, v in absorbed):
    lora = files["m_ppt-lora_lora"]
if base or lora:
    URL = llm_start(**({"base": base} if base else {}), **({"lora": lora} if lora else {}))["url"].rstrip("/")
    lg.log("用现在发布的模型做题：底座永久层 %d 层%s" % (len(base), "，加 PPT LoRA 第 %s 版" % ver.get("ppt-lora") if lora else ""))
else:
    URL = (t.get("llm") or "").rstrip("/")
if not URL:
    raise RuntimeError("没拿到本地大模型的地址")

lab = PptLab()
t0 = time.time()
lock = threading.Lock()
rows, stats = [], {"题": 0, "做对": 0, "示范": 0, "不会": 0}
by_fam = {}
seeds = [run_id * 1000003 + i * 1009 + k for k in range(PER)]
todo = list(seeds)


def rows_of(ep, kind):
    """一道做对的题 → 每一步一条训练数据（到模型说的那一句为止；系统提示在里面）"""
    out = []
    for s in ep["steps"]:
        out.append({"messages": ep["messages"][: s + 1], "tools": "$ppt", "kind": kind, "fam": ep["fam"]})
    return out


def worker():
    while True:
        with lock:
            if not todo:
                return
            seed = todo.pop()
        try:
            got, fam, last = None, None, None
            for k in range(TRIES):
                ep = ppt_episode(URL, lab, seed, "train", temp=0.0 if k == 0 else float(p.get("temperature", 0.7)))
                fam, last = ep["fam"], ep
                lab.ask(op="close", id=ep["id"])
                if ep["ok"]:
                    got = ep
                    break
            new = []
            if got:
                new = rows_of(got, "self")
            elif rnd.random() < float(p.get("demoShare", 0.5)):
                # 程序写的示范：同一道题重新出一遍（干净的），照参考做法改，判对了才要
                tk = lab.ask(op="task", seed=seed, split="train")
                dm = lab.ask(op="demo", id=tk["id"])
                ck = lab.ask(op="check", id=tk["id"], reply=dm.get("reply", ""), calls=dm.get("calls", []))
                lab.ask(op="close", id=tk["id"])
                if dm.get("ok") and ck.get("pass"):
                    msgs = [{"role": "system", "content": tk["system"]}] + tk["messages"] + dm["messages"]
                    steps = [j for j, m in enumerate(msgs) if m["role"] == "assistant" and j >= len(tk["messages"]) + 1]
                    new = rows_of({"messages": msgs, "steps": steps, "fam": tk["fam"]}, "demo")
            with lock:
                stats["题"] += 1
                f = by_fam.setdefault(fam or "?", [0, 0])
                f[1] += 1
                if got:
                    stats["做对"] += 1
                    f[0] += 1
                elif new:
                    stats["示范"] += 1
                else:
                    stats["不会"] += 1
                    if last is not None:
                        lg.log("没做对（%s）：%s" % (fam, last.get("why")))
                rows.extend(new)
        except Exception as e:
            lg.log("有一道题出错了：%s" % str(e)[:160])
        with lock:
            lg.progress(stats["题"] / float(PER), "第 %d/%d 道（自己做对 %d、示范 %d）" % (stats["题"], PER, stats["做对"], stats["示范"]))


ths = [threading.Thread(target=worker) for _ in range(int(p.get("parallel", 2)))]
for x in ths:
    x.start()
for x in ths:
    x.join()
lab.close()

out = os.path.join(work, "ppt-%d-%d.jsonl" % (run_id, i))
with open(out, "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
if rows:
    lg.output(out)
lg.log("做了 %d 道：自己做对 %d、用示范 %d、还不会 %d；留下 %d 条（每一步一条）" % (stats["题"], stats["做对"], stats["示范"], stats["不会"], len(rows)))
lg.metric(i, rows=len(rows), solved=stats["做对"] / max(1, stats["题"]), secs=time.time() - t0)
lg.done(rows=len(rows), problems=stats["题"], solved=stats["做对"], demos=stats["示范"], failed=stats["不会"],
        by_fam={k: [a, b] for k, (a, b) in by_fam.items()}, base_layers=len(base), lora=bool(lora))
