"""存档变小（真的 PyTorch，CPU 上跑）：
  1. 优化器的两组数用半精度存：存档小三分之一左右
  2. 读回来接着训：优化器状态回到全精度，和没压过的几乎一样；接着训出来的参数和一直不停训的差得很少
  3. 以前的存档（全精度）照样能读
没装 PyTorch 就跳过（打包机上只跑 JS 的测试）
"""
import ast, io, os, sys

try:
    import torch
except Exception:
    print("没装 PyTorch：跳过存档变小的测试")
    sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "..", "recipes", "qa_train.py"), encoding="utf-8").read()
FN = next(n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name == "small_opt")
ns = {}
exec(compile(ast.Module(body=[FN], type_ignores=[]), "qa_train.py", "exec"), ns)
small_opt = ns["small_opt"]

torch.manual_seed(0)


def make():
    torch.manual_seed(1)
    # 像 LoRA：一堆细长的矩阵，参数全精度（prepare_model_for_kbit_training 会把要训的参数转成全精度）
    m = torch.nn.Sequential(*[torch.nn.Linear(256, 16, bias=False) if i % 2 == 0 else torch.nn.Linear(16, 256, bias=False) for i in range(16)])
    return m, torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=0.0)


def step(m, opt, i):
    g = torch.Generator().manual_seed(1000 + i)
    x = torch.randn(32, 256, generator=g)
    loss = sum((layer(x if j % 2 == 0 else torch.randn(32, 16, generator=g)) ** 2).mean() for j, layer in enumerate(m))
    opt.zero_grad(); loss.backward(); opt.step()


def size(obj):
    b = io.BytesIO(); torch.save(obj, b); return len(b.getvalue())


m, opt = make()
for i in range(30):
    step(m, opt, i)
lora = {n: x.detach().clone() for n, x in m.named_parameters()}
full = {"lora": lora, "opt": opt.state_dict()}
small = {"lora": lora, "opt": small_opt(opt.state_dict(), torch)}
a, b = size(full), size(small)
assert b < a * 0.72, (a, b)
print("✓ 存档：%d → %d 字节（小了 %.0f%%）" % (a, b, 100 - 100 * b / a))

# 读回来：优化器状态回到全精度，和原来的差很少
buf = io.BytesIO(); torch.save(small, buf); buf.seek(0)
ck = torch.load(buf, map_location="cpu", weights_only=False)
m2, opt2 = make()
with torch.no_grad():
    for n, x in m2.named_parameters():
        x.copy_(ck["lora"][n].to(x.device, x.dtype))
opt2.load_state_dict(ck["opt"])
worst = 0.0
for p1, p2 in zip(m.parameters(), m2.parameters()):
    s1, s2 = opt.state[p1], opt2.state[p2]
    for k in ("exp_avg", "exp_avg_sq"):
        assert s2[k].dtype == torch.float32, s2[k].dtype
        rel = ((s1[k] - s2[k]).abs().max() / s1[k].abs().max().clamp_min(1e-30)).item()
        worst = max(worst, rel)
    assert float(s2["step"]) == float(s1["step"])
assert worst < 0.01, worst
print("✓ 读回来：优化器状态回到全精度，最大相对误差 %.3f%%" % (worst * 100))

# 接着训 30 步：和一直不停训的几乎一样
for i in range(30, 60):
    step(m, opt, i); step(m2, opt2, i)
diff = max(((x1 - x2).abs().max() / x1.abs().max()).item() for x1, x2 in zip(m.parameters(), m2.parameters()))
assert diff < 0.01, diff
print("✓ 接着训 30 步：参数和一直不停训的最多差 %.3f%%" % (diff * 100))

# 以前的存档（全精度）照样能读
buf = io.BytesIO(); torch.save(full, buf); buf.seek(0)
ck = torch.load(buf, map_location="cpu", weights_only=False)
m3, opt3 = make(); opt3.load_state_dict(ck["opt"])
print("✓ 以前的全精度存档照样能读")

# 出意外（不是正常的优化器状态）：原样返回，不报错
odd = {"weird": 1}
assert small_opt(odd, torch) is odd
print("✓ 不认识的格式原样存")
print("存档变小：全部通过")
