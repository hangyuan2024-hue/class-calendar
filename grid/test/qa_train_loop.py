"""训练答题大脑的那个循环：用假的 torch / 模型跑（不用显卡），核对
  1. 显存不够（OOM）→ 把最长的讲解截短再来，不崩、也不溢出到共享内存
  2. 慢得不正常 → 存档、告诉客户端「这台电脑算不了」（不算任务失败）
  3. 显存被别的程序占了 → 一开始就说清楚，不硬训
"""
import ast, os, sys, types, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "..", "recipes", "qa_train.py"), encoding="utf-8").read()
FN = next(n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name == "train")
CODE = compile(ast.Module(body=[FN], type_ignores=[]), "qa_train.py", "exec")


class OOM(RuntimeError):
    pass


def run(free_g=7.0, oom_over=None, secs_per_tok=0.001, n=64, params=None, bytes_per_tok=2 ** 20, plateau=None):
    clock = [1000.0]
    calls, seen, peak = [], [], [0]
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
        def __call__(self, input_ids, labels, attention_mask=None):
            assert attention_mask is not None and len(attention_mask) == len(input_ids)
            width = len(input_ids[0])
            assert all(len(r) == width for r in input_ids) and all(len(r) == width for r in labels), "一批里要补齐到一样长"
            padded = width * len(input_ids)
            if oom_over and padded > oom_over:
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
    torch.cuda = types.SimpleNamespace(is_available=lambda: True, mem_get_info=lambda: (int(free_g * 2 ** 30), 8 * 2 ** 30), empty_cache=lambda: None,
                                       set_per_process_memory_fraction=lambda f: sent.append(("frac", round(f, 2))), OutOfMemoryError=OOM,
                                       max_memory_allocated=lambda: peak[0], reset_peak_memory_stats=lambda: peak.__setitem__(0, 0))
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

    class Proc:
        tokenizer = Tok()
        @staticmethod
        def from_pretrained(b): return Proc()
        def apply_chat_template(self, ms, tokenize=False, add_generation_prompt=False): return "".join(m["content"][0]["text"] for m in ms)

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
    rows = [[{"role": "system", "content": "s"}, {"role": "user", "content": "q" * 20}, {"role": "assistant", "content": "a" * (100 + (i * 37) % 800)}] for i in range(n)]
    import hashlib, json, random, math
    ns = dict(HP={"lr": 1e-4, "epochs": 1, "replay": 2.0}, WARM=None, _total=len(rows), ALL_ROWS=list(rows), lg=lg, p={"epochs": 1, **(params or {})}, rows=rows, work=work, t={}, time=fake_time, os=os, json=json, hashlib=hashlib, random=random)
    exec(CODE, ns)
    err = None
    try:
        ns["train"]("base")
    except Exception as e:
        err = e
    return dict(err=err, sent=sent, logs=logs, ckpts=ckpts, clock=clock[0] - 1000.0, calls=calls, seen=seen, rows=rows, vals=vals, restored=restored, nstep=nstep[0])


ok = lambda m: print("✓", m)

r = run(params={"autoBatch": False})
assert r["err"] is None, r["err"]
steps = [x for x in r["sent"] if x[0] == "metric"]
assert len(steps) == 4 and ("frac", 0.81) in r["sent"], (len(steps), r["sent"][:3])
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

r = run(oom_over=100)
assert r["err"] is not None and any(x[0] == "unfit" and "显存不够" in x[1] for x in r["sent"]), r["sent"][-3:]
ok("显存实在不够（256 个字都放不下）：告诉客户端「这台电脑算不了」，不算任务失败")

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
print("训练答题大脑的循环：全部通过")
