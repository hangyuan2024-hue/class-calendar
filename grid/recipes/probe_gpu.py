"""测试 · 这台电脑能不能算：看 PyTorch 能不能用显卡，测一下矩阵乘法有多快、显存有多少。
（任务向导第 3 步「跑通测试」用的就是它。）"""
import platform
import time

import lg

info = {"python": platform.python_version()}
lg.progress(0.05, "看看有没有 PyTorch")
try:
    import torch
except Exception as e:  # noqa
    lg.log("没装 PyTorch：先在「装环境」那一步装好")
    lg.done(ok=False, why="没装 PyTorch", **info)
    raise SystemExit(0)

info["torch"] = torch.__version__
info["cuda"] = bool(torch.cuda.is_available())
if not info["cuda"]:
    lg.log("PyTorch 看不到显卡：显卡驱动太旧，或者装的是 CPU 版")
    lg.done(ok=False, why="看不到显卡", **info)
    raise SystemExit(0)

dev = torch.device("cuda")
prop = torch.cuda.get_device_properties(0)
info.update(gpu=prop.name, vram=round(prop.total_memory / 2**30, 1), capability=f"{prop.major}.{prop.minor}")
lg.log(f"显卡：{prop.name}，显存 {info['vram']}G，算力版本 {info['capability']}")

# 测速：半精度矩阵乘法，算一共能跑多少 TFLOPS
n = 4096
a = torch.randn(n, n, device=dev, dtype=torch.float16)
b = torch.randn(n, n, device=dev, dtype=torch.float16)
for _ in range(3):
    a @ b
torch.cuda.synchronize()
rounds = 30
t0 = time.time()
for i in range(rounds):
    c = a @ b
    if i % 5 == 0:
        torch.cuda.synchronize()
        lg.progress(0.2 + 0.7 * i / rounds, "测速中")
torch.cuda.synchronize()
dt = time.time() - t0
info["tflops"] = round(2 * n ** 3 * rounds / dt / 1e12, 1)
lg.metric(1, tflops=info["tflops"])
free, total = torch.cuda.mem_get_info()
info["free_vram"] = round(free / 2**30, 1)
lg.log(f"半精度算力：{info['tflops']} TFLOPS，空闲显存 {info['free_vram']}G")
lg.done(ok=True, **info)
