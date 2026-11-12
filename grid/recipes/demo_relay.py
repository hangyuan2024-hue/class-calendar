"""示例 · 接力训练：一台电脑算一段，每隔几步存一次档；中途断电，下一台从最近的存档接着算，结果和不断电一模一样。
（用一个很小的神经网络学一条曲线，只要 numpy，用来试训练网通不通。）"""
import os
import time

import numpy as np

import lg

t = lg.task()
inp = t["input"]
p = t["job"]["params"]
start, stop = inp["from"], inp["to"]
every = int(p.get("ckptEvery", 20))
pause = float(p.get("sleep", 0.0))
H = 32


def init():
    r = np.random.default_rng(1234)
    return {
        "w1": r.normal(0, 1, (1, H)), "b1": np.zeros(H),
        "w2": r.normal(0, 1 / np.sqrt(H), (H, 1)), "b2": np.zeros(1),
        "m_w1": np.zeros((1, H)), "m_b1": np.zeros(H), "m_w2": np.zeros((H, 1)), "m_b2": np.zeros(1),
    }


def batch(step):
    # 每一步用哪批数据只由步数决定：谁接着算都一样
    r = np.random.default_rng(10_000 + step)
    x = r.uniform(-3, 3, (64, 1))
    return x, np.sin(x) * 0.8 + 0.1 * x


def train_step(s, step):
    x, y = batch(step)
    h = np.tanh(x @ s["w1"] + s["b1"])
    out = h @ s["w2"] + s["b2"]
    err = out - y
    loss = float((err ** 2).mean())
    g_out = 2 * err / len(x)
    g = {"w2": h.T @ g_out, "b2": g_out.sum(0)}
    g_h = (g_out @ s["w2"].T) * (1 - h ** 2)
    g["w1"], g["b1"] = x.T @ g_h, g_h.sum(0)
    lr = 0.05 * (0.5 if step > 600 else 1.0)
    for k in ("w1", "b1", "w2", "b2"):
        s["m_" + k] = 0.9 * s["m_" + k] + g[k]
        s[k] = s[k] - lr * s["m_" + k]
    return loss


# 从最近的存档接着算（可能是上一台电脑存的）
state, step = init(), start
if t.get("resume"):
    z = np.load(t["resume"])
    state = {k: z[k] for k in z.files if k != "step"}
    step = int(z["step"])
    lg.log(f"从第 {step} 步的存档接着算")
else:
    lg.log("从头开始训练")

work = lg.work_dir()
loss = None
while step < stop:
    loss = train_step(state, step)
    step += 1
    if step % 5 == 0:
        lg.metric(step, loss=loss)
    lg.progress((step - start) / max(1, stop - start))
    if step % every == 0 and step < stop:
        f = os.path.join(work, f"ckpt-{step}.npz")
        np.savez(f, step=step, **state)
        lg.checkpoint(f, step)
    if pause:
        time.sleep(pause)

f = os.path.join(work, f"ckpt-{step}.npz")
np.savez(f, step=step, **state)
lg.done(ckpt=f, loss=loss, step=step)
