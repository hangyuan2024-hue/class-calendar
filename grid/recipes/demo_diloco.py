"""示例 · 多台一起训（DiLoCo）：每一轮，各台电脑从同一个存档出发，用自己那份数据各算一段，交上「改了多少」；
收齐以后合并（平均 + 外层动量），成为下一轮的存档。掉线的那台不等，下一轮再加入。家里的网也够用：一轮只传一次。"""
import os
import time

import numpy as np

import lg

t = lg.task()
p = t["job"]["params"]
inp = t["input"]
H = 32
KEYS = ("w1", "b1", "w2", "b2")


def init():
    r = np.random.default_rng(7)
    return {"w1": r.normal(0, 1, (1, H)), "b1": np.zeros(H), "w2": r.normal(0, 1 / np.sqrt(H), (H, 1)), "b2": np.zeros(1)}


def load(path):
    if not path:
        g = init()
        return g, {k: np.zeros_like(v) for k, v in g.items()}
    z = np.load(path)
    return {k: z[k] for k in KEYS}, {k: z["v_" + k] for k in KEYS}


def data(r, n=64):
    x = r.uniform(-3, 3, (n, 1))
    return x, np.sin(x) * 0.8 + 0.1 * x


def loss_of(s, x, y):
    return float(((np.tanh(x @ s["w1"] + s["b1"]) @ s["w2"] + s["b2"] - y) ** 2).mean())


work = lg.work_dir()
glob, vel = load(t.get("resume"))

if t.get("kind") == "merge":
    # 合并：各份「改了多少」取平均，当成外层的梯度，用带动量（Nesterov）的一步更新
    parts = [np.load(f) for f in t["parts"]]
    lg.log(f"第 {inp['round'] + 1} 轮：合并 {len(parts)} 份")
    lr, mu = float(p.get("outerLr", 0.7)), float(p.get("outerMomentum", 0.9))
    for k in KEYS:
        d = np.mean([z[k] for z in parts], axis=0)
        vel[k] = mu * vel[k] + d
        glob[k] = glob[k] - lr * (d + mu * vel[k])
    x, y = data(np.random.default_rng(999), 512)
    loss = loss_of(glob, x, y)
    lg.metric(inp["round"] + 1, loss=loss)
    f = os.path.join(work, f"global-{inp['round'] + 1}.npz")
    np.savez(f, **glob, **{"v_" + k: v for k, v in vel.items()})
    lg.done(**{"global": f, "loss": loss})
else:
    # 自己这一份：从这一轮的存档出发，算 innerSteps 步
    s = {k: v.copy() for k, v in glob.items()}
    m = {k: np.zeros_like(v) for k, v in s.items()}
    r = np.random.default_rng(1000 * inp["round"] + inp["shard"])
    steps = int(inp.get("innerSteps") or p.get("innerSteps", 50))
    for i in range(steps):
        x, y = data(r)
        h = np.tanh(x @ s["w1"] + s["b1"])
        err = h @ s["w2"] + s["b2"] - y
        go = 2 * err / len(x)
        g = {"w2": h.T @ go, "b2": go.sum(0)}
        gh = (go @ s["w2"].T) * (1 - h ** 2)
        g["w1"], g["b1"] = x.T @ gh, gh.sum(0)
        for k in KEYS:
            m[k] = 0.9 * m[k] + g[k]
            s[k] -= 0.03 * m[k]
        if i % 10 == 0:
            lg.metric(inp["round"] * steps + i, inner_loss=float((err ** 2).mean()))
        lg.progress((i + 1) / steps)
        if p.get("sleep"):
            time.sleep(float(p["sleep"]))
    f = os.path.join(work, f"delta-{inp['round']}-{inp['shard']}.npz")
    np.savez(f, **{k: glob[k] - s[k] for k in KEYS})
    lg.done(delta=f)
