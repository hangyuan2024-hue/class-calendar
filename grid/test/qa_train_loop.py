"""训练答题大脑的那个循环：用假的 torch / 模型跑（不用显卡），核对
  1. 显存不够（OOM）→ 把最长的讲解截短再来，不崩、也不溢出到共享内存
  2. 慢得不正常 → 存档、告诉客户端「这台电脑算不了」（不算任务失败）
  3. 显存被别的程序占了 → 一开始就说清楚，不硬训
"""
import ast, json, os, sys, types, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "..", "recipes", "qa_train.py"), encoding="utf-8").read()
FNS = [n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name in ("train", "small_opt")]
CODE = compile(ast.Module(body=FNS, type_ignores=[]), "qa_train.py", "exec")


class OOM(RuntimeError):
    pass


def run(free_g=7.0, oom_over=None, secs_per_tok=0.001, n=64, params=None, bytes_per_tok=2 ** 20, plateau=None, extra_rows=None, img_oom=False, reserved_g=None, oom_after=0):
    clock = [1000.0]
    calls, seen, peak = [], [], [0]
    imgs_seen, tmpl_tools, kept = [], [], []
    nstep, mode, vals = [0], [True], []
    sent, logs, ckpts, restored = [], [], [], []
    fake_time = types.SimpleNamespace(time=lambda: clock[0])

    class Loss:
        def __init__(self, v): self.v = v
        def __truediv__(self, k): return Loss(self.v / k)
        def __mul__(self, k): return Loss(self.v * k)
        def backward(self): pass
        def item(self): return self.v

    class P:
        requires_grad = True
        device, dtype = "cuda", "bf16"
        def numel(self): return 1000
        def detach(self): return self
        def to(self, *a, **k): return self
        def copy_(self, x): restored.append(1)
        def clone(self): return self

    class Model:
        def parameters(self): return [P()]
        def named_parameters(self): return [("lora_A", P())]
        def train(self): mode[0] = True
        def eval(self): mode[0] = False
        def save_pretrained(self, out): os.makedirs(out, exist_ok=True)
        def gradient_checkpointing_enable(self, **k): sent.append(("gck",))
        def __call__(self, input_ids, labels, attention_mask=None, pixel_values=None, image_grid_thw=None, logits_to_keep=0):
            assert attention_mask is not None and len(attention_mask) == len(input_ids)
            if logits_to_keep:
                assert all(len(r) == logits_to_keep for r in labels) and logits_to_keep < len(input_ids[0]), "只算要学的那一段：标签跟着截"
                assert all(r[0] == -100 for r in labels), "截的地方从要学的前一个字开始"
                kept.append(logits_to_keep)
                labels = [[-100] * (len(input_ids[0]) - logits_to_keep) + list(r) for r in labels]
            if pixel_values is not None:
                assert len(input_ids) == 1 and image_grid_thw == "thw@cuda", "带图的一条一批，图跟着这一条"
                imgs_seen.append(pixel_values)
                if img_oom:
                    raise OOM("CUDA out of memory")
            width = len(input_ids[0])
            assert all(len(r) == width for r in input_ids) and all(len(r) == width for r in labels), "一批里要补齐到一样长"
            padded = width * len(input_ids)
            if oom_over and padded > oom_over and nstep[0] >= oom_after:
                raise OOM("CUDA out of memory")
            # 假的损失：一步一步往下降；plateau = 降到第几步就不再降了（学到头了）
            lv = 2.0 / (1 + min(nstep[0], plateau if plateau is not None else 10 ** 9))
            if not mode[0]:
                vals.append(lv)
                return types.SimpleNamespace(loss=Loss(lv))
            calls.append((len(input_ids), width))
            seen.extend(sum(m) for m in attention_mask)
            peak[0] = max(peak[0], padded * bytes_per_tok)
            clock[0] += 0.05 + sum(sum(m) for m in attention_mask) * secs_per_tok      # 每次计算有固定开销：拼批才省时间
            return types.SimpleNamespace(loss=Loss(1.0))

    class Opt:
        def __init__(self, *a, **k): pass
        def step(self): nstep[0] += 1
        def zero_grad(self, **k): pass
        def state_dict(self): return {}
        def load_state_dict(self, d): pass

    class Ctx:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    torch = types.ModuleType("torch")
    torch.OutOfMemoryError = OOM
    torch.bfloat16 = "bf16"
    torch.tensor = lambda v, device=None: v
    torch.autocast = lambda *a, **k: Ctx()
    torch.no_grad = lambda: Ctx()
    torch.save = lambda obj, f: open(f, "wb").close()
    torch.load = lambda f, map_location=None: {}
    torch.cuda = types.SimpleNamespace(get_device_name=lambda i=0: "Fake 8G", is_available=lambda: True, mem_get_info=lambda: (int(free_g * 2 ** 30), 8 * 2 ** 30), empty_cache=lambda: None,
                                       set_per_process_memory_fraction=lambda f: sent.append(("frac", round(f, 2))), OutOfMemoryError=OOM,
                                       max_memory_allocated=lambda: peak[0], reset_peak_memory_stats=lambda: peak.__setitem__(0, 0),
                                       memory_reserved=lambda: int(((reserved_g if reserved_g is not None else (8 - free_g)) * 2 ** 30)))
    torch.optim = types.SimpleNamespace(AdamW=Opt, lr_scheduler=types.SimpleNamespace(LambdaLR=Opt))
    torch.nn = types.SimpleNamespace(utils=types.SimpleNamespace(clip_grad_norm_=lambda *a: None))
    peft = types.ModuleType("peft")
    peft.LoraConfig = lambda **k: k
    peft.get_peft_model = lambda m, c: m
    peft.prepare_model_for_kbit_training = lambda m, **k: m
    tf = types.ModuleType("transformers")

    class Tok:
        pad_token_id = 0
        def __call__(self, s, add_special_tokens=False): return {"input_ids": list(range(len(s)))}

    class T:
        def __init__(self, v): self.v = v
        def tolist(self): return list(self.v)
        def __len__(self): return len(self.v)
        def to(self, dev, dtype=None): return "%s@%s" % (self.v, dev) if isinstance(self.v, str) else self

    class Proc:
        tokenizer = Tok()
        @staticmethod
        def from_pretrained(b): return Proc()
        def apply_chat_template(self, ms, tokenize=False, add_generation_prompt=False, tools=None):
            if tools is not None:
                tmpl_tools.append(tools)
            txt = lambda c: c if isinstance(c, str) else "".join("<img>" * 40 if x.get("type") == "image" else x.get("text", "") for x in c)
            return "".join(txt(m["content"]) + ("".join(c["function"]["name"] + json.dumps(c["function"]["arguments"]) for c in m.get("tool_calls") or [])) for m in ms) + ("<gen>" if add_generation_prompt else "")
        def __call__(self, text, images=None, return_tensors=None):
            assert images and all(hasattr(i, "size") for i in images), "图交给 processor"
            return {"input_ids": [T(range(len(text[0])))], "pixel_values": T("pv"), "image_grid_thw": T("thw")}

    tf.AutoProcessor = Proc
    tf.AutoModelForImageTextToText = types.SimpleNamespace(from_pretrained=lambda *a, **k: Model())
    tf.BitsAndBytesConfig = lambda **k: k
    sys.modules.update(torch=torch, peft=peft, transformers=tf)

    sys.path.insert(0, os.path.join(HERE, "..", "py"))
    import lg as real_lg
    lg = types.SimpleNamespace(log=lambda *a: logs.append(" ".join(map(str, a))), progress=lambda p, note=None: sent.append(("progress", note)), metric=lambda step, **kv: sent.append(("metric", step, kv)),
                               checkpoint=lambda f, step, **k: ckpts.append(step), unfit=lambda why: sent.append(("unfit", why)), gpu_guard=real_lg.gpu_guard)
    work = tempfile.mkdtemp(prefix="qa-loop-")
    # 讲解长短不一：最长的 900 个字
    rows = [[{"role": "system", "content": "s"}, {"role": "user", "content": "q" * 20}, {"role": "assistant", "content": "a" * (100 + (i * 37) % 800)}] for i in range(n)] + list(extra_rows or [])
    import hashlib, random, math
    ns = dict(HP={"lr": 1e-4, "epochs": 1, "replay": 2.0}, WARM=None, _total=len(rows), ALL_ROWS=list(rows), lg=lg, p={"epochs": 1, **(params or {})}, rows=rows, work=work, t={}, time=fake_time, os=os, json=json, hashlib=hashlib, random=random,
              ppt_tools=lambda: [{"type": "function", "function": {"name": "set_text"}}], CACHE=work)
    exec(CODE, ns)
    err = None
    try:
        ns["train"]("base")
    except Exception as e:
        err = e
    return dict(err=err, sent=sent, logs=logs, ckpts=ckpts, clock=clock[0] - 1000.0, calls=calls, seen=seen, rows=rows, vals=vals, restored=restored, nstep=nstep[0], imgs=imgs_seen, tools=tmpl_tools, kept=kept, work=work)


ok = lambda m: print("✓", m)

r = run(params={"autoBatch": False})
r0 = r
assert r["err"] is None, r["err"]
steps = [x for x in r["sent"] if x[0] == "metric"]
# 显存上限：空着 7G，Windows 留 1.3G、别的系统留 0.8G（CUDA 自己和桌面要用，不然会溢出到共享内存）
assert len(steps) == 4 and ("frac", 0.71 if os.name == "nt" else 0.78) in r["sent"], (len(steps), r["sent"][:3])
assert "还要" in [x for x in r["sent"] if x[0] == "progress"][-1][1]
ok("正常：训完 4 步；只用现在空着的显存（7G 里留 0.5G）；进度里写着还要多久")

# 拼批：64 条不再是 64 次计算；每条都训到、不多不少；一批（补齐以后）不超过预算
one = run(params={"autoBatch": False, "maxBatch": 1})
assert len(one["calls"]) == 64
assert len(r["calls"]) < 50 and all(n * w <= 1024 for n, w in r["calls"]), len(r["calls"])
assert len(r["seen"]) == 64 and sorted(r["seen"]) == sorted(one["seen"])
assert r["clock"] < one["clock"]
ok("长短差不多的拼成一批：64 条只算了 %d 次（以前 64 次），每条都训到一次，显存占用不超过以前最长的那一条" % len(r["calls"]))

# 显存有富余（大显卡）：一批自动越放越多
big = run(n=512, bytes_per_tok=2 ** 19, params={"earlyStop": False})     # 每个字占得少 = 显存富余
assert big["err"] is None, big["err"]
assert max(n * w for n, w in big["calls"]) > 2048 and len(big["calls"]) < 512 / 3, (max(n * w for n, w in big["calls"]), len(big["calls"]))
assert len(big["seen"]) == 512
ok("显存有富余：一批自动加大（最大一批 %d 个字），512 条只算了 %d 次" % (max(n * w for n, w in big["calls"]), len(big["calls"])))

# 加过头放不下了：退回去，记住上限，不再反复撞
r2 = run(n=512, bytes_per_tok=2 ** 19, oom_over=3000, params={"earlyStop": False})
assert r2["err"] is None, r2["err"]
assert 1 <= len([l for l in r2["logs"] if "一批最多" in l]) <= 2 and max(n * w for n, w in r2["calls"]) <= 3000 and len(r2["seen"]) == 512, [l for l in r2["logs"] if "显存" in l]
ok("加到放不下：退回去并记住上限（不反复撞），照样每条都训到")

r = run(oom_over=500)
assert r["err"] is None, r["err"]
assert any("一批最多" in l for l in r["logs"]) and not any(x[0] == "unfit" for x in r["sent"]), r["logs"]
assert all(n * w <= 500 for n, w in r["calls"])
ok("显存不够：把一批缩小、最长的讲解截短再来，照样训完（不崩，也不会溢出到共享内存拖慢几十倍）")

r = run(oom_over=100, reserved_g=0.2)
assert r["err"] is not None and any(x[0] == "unfit" and "显存不够" in x[1] for x in r["sent"]), r["sent"][-3:]
ok("显存实在不够（256 个字都放不下）：告诉客户端「这台电脑算不了」，不算任务失败")

# 只给要学的那部分算概率：一批里只截掉前面谁都不学的部分，损失照样只算要学的字
assert r0["kept"] and all(k > 0 for k in r0["kept"]), "只算要学的那一段"
ok("只给要学的那部分算概率（logits_to_keep）：前面谁都不学的提示部分不算 15 万个词的概率，省显存")
# 档位记下来：同一台电脑下次直接从试出来的档位开始
t1 = run(n=512, bytes_per_tok=2 ** 19, oom_over=3000, params={"earlyStop": False})
tier = json.load(open(os.path.join(t1["work"], "vram-tier.json")))
assert any(v["cap"] <= 3000 for v in tier.values()), tier
ok("这台电脑试出来的档位记下来（一批最多 %d 字），下次直接从这里开始、不再撞同一个上限" % min(v["cap"] for v in tier.values()))
# 显存不够、还没开省显存模式（大显卡默认不开）：先退一档打开它，再接着训
g = run(free_g=15.0, oom_over=200, oom_after=0, params={"autoBatch": False, "earlyStop": False})
assert any(x[0] == "gck" for x in g["sent"]), g["sent"][-3:]
ok("显存不够：先退一档打开省显存模式接着训，不直接放弃")

# 训了一阵以后显存碎了（训练进程自己留着一大块、别的程序没占）：存档、退出换新进程接着训，不说「这台电脑做不了」
r = run(oom_over=100, oom_after=2, params={"autoBatch": False, "earlyStop": False})
assert r["err"] is not None and "显存碎片" in str(r["err"]) and not any(x[0] == "unfit" for x in r["sent"]) and r["ckpts"], (r["err"], r["sent"][-3:], r["ckpts"])
ok("训了一阵以后显存碎了（不是别的程序占的）：存档、换个新进程从这里接着训，不说这台电脑做不了")

r = run(secs_per_tok=0.15)   # 每秒 6～7 个字：同事电脑上实际出现过的速度
assert r["err"] is not None and any(x[0] == "unfit" and "慢得不正常" in x[1] for x in r["sent"]), (r["err"], r["sent"][-3:])
assert r["clock"] < 1500, r["clock"]
ok("慢得不正常（每秒 6 个字）：%d 分钟就发现、交给别的电脑，不空耗几天" % (r["clock"] / 60))

r = run(free_g=3.0)
assert r["err"] is not None and any(x[0] == "unfit" and "显存只空着" in x[1] for x in r["sent"])
ok("显存被别的程序占了（只空着 3G）：一开始就说清楚，不硬训")
# 提前停：留一小部分只测不训；它不再变好就停，用最好的那次参数
full = run(n=512)
assert full["err"] is None and len(full["seen"]) == 512 - 15 and full["vals"], (full["err"], len(full["seen"]))
es = run(n=512, plateau=12)
assert es["err"] is None, es["err"]
assert any("提前停" in l for l in es["logs"]) and es["nstep"] < full["nstep"] and len(es["seen"]) < len(full["seen"]), (es["nstep"], full["nstep"], [l for l in es["logs"] if "验证" in l])
assert es["restored"], "要换回最好的那次参数"
ok("验证集不再变好就提前停：%d 步就停了（本来要 %d 步），并换回最好那一次的参数；一直在变好的照常训完" % (es["nstep"], full["nstep"]))

# 带图的（看图反推）、带工具调用的（改 PPT）：带图的一条一批、图跟着那一条；工具说明交给对话模板；带图的放不下就跳过那一条（不死循环）
from PIL import Image as _Im
_d = tempfile.mkdtemp(prefix="qa-img-")
_Im.new("RGB", (64, 48), "white").save(os.path.join(_d, "a.jpg"))


class Msgs(list):
    tools = None
    images = ()


def _img_row(i):
    m = Msgs([{"role": "system", "content": "看图"}, {"role": "user", "content": [{"type": "image", "image": "a.jpg"}, {"type": "text", "text": "还原"}]}, {"role": "assistant", "content": "{\"title\":\"x%d\"}" % i}])
    m.images = [os.path.join(_d, "a.jpg")]
    return m


def _tool_row(i):
    m = Msgs([{"role": "system", "content": "改 PPT"}, {"role": "user", "content": "第 2 页标题改成 x"},
              {"role": "assistant", "content": "", "tool_calls": [{"id": "c", "type": "function", "function": {"name": "set_text", "arguments": "{\"slide\": 2}"}}]},
              {"role": "tool", "tool_call_id": "c", "name": "set_text", "content": "{\"ok\":true}"}, {"role": "assistant", "content": "改好了：第 2 页的标题已经改成了 x，这是第 %d 次" % i}])
    m.tools = "$ppt"
    return m


mix = [_img_row(i) for i in range(6)] + [_tool_row(i) for i in range(6)]
r = run(n=40, extra_rows=mix, params={"autoBatch": False, "earlyStop": False})
assert r["err"] is None, r["err"]
assert len(r["imgs"]) == 6 and len(r["seen"]) == 52, (len(r["imgs"]), len(r["seen"]))
assert r["tools"] and all(t == [{"type": "function", "function": {"name": "set_text"}}] for t in r["tools"]), "工具说明交给对话模板"
assert any("带图的 6 条、带工具调用的 6 条" in l for l in r["logs"]), r["logs"]
r = run(n=40, extra_rows=mix, img_oom=True, params={"autoBatch": False, "earlyStop": False})
assert r["err"] is None and len(r["seen"]) == 46, (r["err"], len(r["seen"]))
ok("带图的一条一批（图跟着那一条），带工具调用的照通义千问自己的模板写；一张图都放不下就跳过那一条，照样训完")

# 接着上一版训：只训新增的 + 复习一部分旧的
A, B = SRC.index("# ---- 接着上一版训"), SRC.index("# ---------------- 2. 底子")
import random as _r


def pick(n_all, n_prev, prev="x.zip", params=None):
    ns = dict(rows=[[i] for i in range(n_all)], t={"files": {"opt_prev_peft": prev} if prev else {}, "extra": {"prevExamples": n_prev}}, p=params or {}, random=_r)
    exec(SRC[A:B], ns)
    return ns


n = pick(4570, 4270)
got = sorted(r[0] for r in n["rows"])
assert n["WARM"] and n["WARM"]["new"] == 300 and len(got) == 900 and set(range(4270, 4570)) <= set(got) and len(n["ALL_ROWS"]) == 4570
ok("接着上一版训：4570 条里新增 300 条 → 这一轮只训 300 条新的 + 600 条旧的复习（以前是全部 4570 条从头训）")
assert pick(4570, 0)["WARM"] is None and len(pick(4570, 0)["rows"]) == 4570
assert pick(4570, 4270, prev=None)["WARM"] is None
assert pick(4570, 1000)["WARM"] is None            # 新增的比旧的还多：从头训
assert pick(4570, 4270, params={"warm": False})["WARM"] is None
ok("没有上一版、新增的比旧的多、设置里关了：和以前一样用全部数据从头训")
# 训练参数自己进化
H0, H1 = SRC.index("# ---- 训练参数自己进化"), SRC.index("# ---------------- 2. 底子")


def evo(total, prev, params=None):
    logs = []
    ns = dict(t={"extra": {"prev": prev} if prev is not None else {}}, p=params or {}, random=_r, _total=total, WARM=None, ALL_ROWS=[], _pn=0, rows=[],
              lg=types.SimpleNamespace(log=lambda *a: logs.append(a[0])))
    exec(SRC[H0:H1], ns)
    return ns["HP"], ns["TRY"], logs


hp, tr, _ = evo(1000, None)
assert hp == {"lr": 1e-4, "epochs": 2, "replay": 2.0} and tr is None
hp, tr, _ = evo(1000, {"hp": {"lr": 1.5e-4, "epochs": 3}}, {"evolveRate": 0})
assert hp["lr"] == 1.5e-4 and hp["epochs"] == 3 and tr is None
tried = [evo(n, {"hp": {"lr": 1e-4, "epochs": 2, "replay": 2.0}}) for n in range(1000, 1200)]
changed = [x for x in tried if x[1]]
assert 60 < len(changed) < 140 and all(2e-5 <= h["lr"] <= 4e-4 and 1 <= h["epochs"] <= 3 and 0.5 <= h["replay"] <= 6 for h, _, _ in tried)
assert all(sum(1 for k in ("lr", "epochs", "replay") if h[k] != {"lr": 1e-4, "epochs": 2, "replay": 2.0}[k]) == 1 for h, _, _ in changed)
assert evo(1234, {"hp": {}})[0] == evo(1234, {"hp": {}})[0]
ok("训练参数自己进化：没有上一版用默认的；有上一版从它的参数出发，约一半的轮次改动其中一个（每次只改一个、不出范围），同一轮重来改动一样")
# 考试准了以后调得更快：现在发布的那一版是「改了某个参数发布的」→ 大概率接着往同一个方向试
mom = [evo(n, {"hp": {"lr": 1e-4, "epochs": 2, "replay": 2.0}, "tried_k": "lr", "tried_x": 1.5}, {"momentum": 0.7}) for n in range(2000, 2200)]
same_dir = [h for h, t, _ in mom if t and abs(h["lr"] - 1.5e-4) < 1e-12]
assert 120 < len(same_dir) < 180, len(same_dir)
ok("考试准了以后调得更快：上一次往哪个方向改、考得更好发布了，这一轮约七成接着往同一个方向再试一步（%d/200）" % len(same_dir))

# 和考题去重、按类型均衡、数据指纹
F2 = [n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name in ("ctext", "decontam")]
ns2 = {"re": __import__("re"), "os": os}
exec(compile(ast.Module(body=F2, type_ignores=[]), "qa_train.py", "exec"), ns2)
exam_q = ["小明有 5 个苹果，又买了 3 个，吃掉 2 个，还剩几个苹果？请写出过程"]
rs = [[{"role": "user", "content": "小明有 5 个苹果，又买了 3 个，吃掉 2 个，还剩几个苹果？请写出过程"}, {"role": "assistant", "content": "6"}],
      [{"role": "user", "content": "题目：小明有5个苹果，又买了3个，吃掉2个，还剩几个苹果？"}, {"role": "assistant", "content": "6"}],
      [{"role": "user", "content": "小红有 7 支铅笔，送给同学 4 支，还剩几支？"}, {"role": "assistant", "content": "3"}],
      [{"role": "user", "content": [{"type": "image", "image": "a.jpg"}, {"type": "text", "text": "还原"}]}, {"role": "assistant", "content": "{}"}]]
keep, bad = ns2["decontam"](rs, exam_q)
assert bad == 2 and len(keep) == 2 and keep[0] is rs[2], (bad, keep)
ok("和考题去重：问的几乎就是考题原话的（空格不同也算）不用；别的照常")
B0, B1 = SRC.index("# ---- 按类型均衡"), SRC.index("# ---- 接着上一版训")


class M(list):
    pass


def mk(kind, i):
    m = M([{"role": "user", "content": "q%d" % i}, {"role": "assistant", "content": "a"}])
    m.kind, m.fam, m.h = kind, None, "%s%04d" % (kind, i)
    return m


rs = [mk("doll", i) for i in range(80)] + [mk("slide", i) for i in range(20)]
nsb = dict(rows=list(rs), EXAM_ROWS=[], p={"balance": {"by": "kind", "max": 0.5}, "minExamples": 1}, random=__import__("random"), hashlib=__import__("hashlib"), t={"files": {"data0": "x"}}, lg=types.SimpleNamespace(log=lambda *a: None))
exec(SRC[B0:B1], nsb)
kinds = [r.kind for r in nsb["rows"]]
assert kinds.count("doll") == 50 and kinds.count("slide") == 20, (kinds.count("doll"), kinds.count("slide"))
_ids = {id(r) for r in nsb["rows"]}
assert [r.h for r in nsb["rows"]] == [r.h for r in rs if id(r) in _ids], "原来的先后不变"
assert nsb["DATA_BY"] == {"doll": 50, "slide": 20} and len(nsb["DATA_SIG"]) == 16 and nsb["DATA_FILES"] == 1
ok("按类型均衡：一类最多占一半（卡通小人 80 条只用 50 条），先后不变；记下各类多少条、数据指纹")
print("训练答题大脑的循环：全部通过")
