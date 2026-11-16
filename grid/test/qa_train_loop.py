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


def run(free_g=7.0, oom_over=None, secs_per_tok=0.001, n=64, params=None):
    clock = [1000.0]
    sent, logs, ckpts = [], [], []
    fake_time = types.SimpleNamespace(time=lambda: clock[0])

    class Loss:
        def __init__(self, v): self.v = v
        def __truediv__(self, k): return Loss(self.v / k)
        def backward(self): pass
        def item(self): return self.v

    class P:
        requires_grad = True
        device, dtype = "cuda", "bf16"
        def numel(self): return 1000
        def detach(self): return self
        def to(self, *a, **k): return self
        def copy_(self, x): pass

    class Model:
        def parameters(self): return [P()]
        def named_parameters(self): return [("lora_A", P())]
        def train(self): pass
        def save_pretrained(self, out): os.makedirs(out, exist_ok=True)
        def __call__(self, input_ids, labels):
            L = len(input_ids[0])
            if oom_over and L > oom_over:
                raise OOM("CUDA out of memory")
            clock[0] += L * secs_per_tok
            return types.SimpleNamespace(loss=Loss(1.0))

    class Opt:
        def __init__(self, *a, **k): pass
        def step(self): pass
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
                                       set_per_process_memory_fraction=lambda f: sent.append(("frac", round(f, 2))), OutOfMemoryError=OOM)
    torch.optim = types.SimpleNamespace(AdamW=Opt, lr_scheduler=types.SimpleNamespace(LambdaLR=Opt))
    torch.nn = types.SimpleNamespace(utils=types.SimpleNamespace(clip_grad_norm_=lambda *a: None))
    peft = types.ModuleType("peft")
    peft.LoraConfig = lambda **k: k
    peft.get_peft_model = lambda m, c: m
    peft.prepare_model_for_kbit_training = lambda m, **k: m
    tf = types.ModuleType("transformers")

    class Tok:
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
    ns = dict(lg=lg, p={"epochs": 1, **(params or {})}, rows=rows, work=work, t={}, time=fake_time, os=os, json=json, hashlib=hashlib, random=random)
    exec(CODE, ns)
    err = None
    try:
        ns["train"]("base")
    except Exception as e:
        err = e
    return dict(err=err, sent=sent, logs=logs, ckpts=ckpts, clock=clock[0] - 1000.0)


ok = lambda m: print("✓", m)

r = run()
assert r["err"] is None, r["err"]
steps = [x for x in r["sent"] if x[0] == "metric"]
assert len(steps) == 4 and ("frac", 0.81) in r["sent"], r["sent"][:3]
assert "还要" in [x for x in r["sent"] if x[0] == "progress"][-1][1]
ok("正常：训完 4 步；只用现在空着的显存（7G 里留 0.5G）；进度里写着还要多久")

r = run(oom_over=500)
assert r["err"] is None, r["err"]
assert any("截到" in l for l in r["logs"]) and not any(x[0] == "unfit" for x in r["sent"]), r["logs"]
assert len([x for x in r["sent"] if x[0] == "metric"]) == 4
ok("显存不够：把最长的讲解截短再来，照样训完（不崩，也不会溢出到共享内存拖慢几十倍）")

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
print("训练答题大脑的循环：全部通过")
