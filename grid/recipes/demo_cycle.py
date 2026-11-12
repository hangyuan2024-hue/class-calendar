"""示例 · 每日一轮（一个配方三种用法，看 job 参数里的 stageKey）：
  gen   生成今天的训练数据（每个小任务一份）
  train 接着上一版发布的模型训练（第一天从头开始）；用到前面 gen 交的所有数据
  eval  在固定的评测集上打分；分数比现在发布的高，调度中心就发布这一版，老师端自动换上
（用一个很小的模型学一条曲线，只要 numpy；真的会换成 Q版插件、改 PPT 的模型。）"""
import os

import numpy as np

import lg

t = lg.task()
p = t["job"]["params"]
key = p.get("stageKey")
work = lg.work_dir()
H = 16


def init():
    r = np.random.default_rng(0)
    return {"w1": r.normal(0, 1, (1, H)), "b1": np.zeros(H), "w2": r.normal(0, 0.3, (H, 1)), "b2": np.zeros(1)}


def f(x):
    return np.sin(x) * 0.8 + 0.1 * x


def predict(s, x):
    return np.tanh(x @ s["w1"] + s["b1"]) @ s["w2"] + s["b2"]


if key == "gen":
    seed = int(p.get("runId", 0)) * 100 + int(t["input"].get("i", 0))
    r = np.random.default_rng(seed)
    x = r.uniform(-3, 3, (256, 1))
    out = os.path.join(work, f"data-{seed}.npz")
    np.savez(out, x=x, y=f(x))
    lg.output(out)
    lg.done(n=len(x))

elif key == "train":
    # 起点：昨天发布的那一版（warmStart）；没有就从头开始
    s = init()
    ws = t.get("files", {}).get("warmStart")
    if ws:
        z = np.load(ws)
        s = {k: z[k] for k in s}
        lg.log("接着上一版训练")
    else:
        lg.log("第一版：从头开始")
    xs, ys = [], []
    for o in t["deps"]["gen"]["outputs"]:
        d = np.load(lg.download(o["url"], os.path.join(work, o["name"])))
        xs.append(d["x"]); ys.append(d["y"])
    x, y = np.concatenate(xs), np.concatenate(ys)
    steps, lr, noise = int(p.get("steps", 300)), float(p.get("lr", 0.05)), float(p.get("noise", 0))
    m = {k: np.zeros_like(v) for k, v in s.items()}
    r = np.random.default_rng(int(p.get("runId", 0)))
    for i in range(steps):
        idx = r.integers(0, len(x), 64)
        xb, yb = x[idx], y[idx] + noise * r.normal(0, 1, (64, 1))
        h = np.tanh(xb @ s["w1"] + s["b1"])
        err = h @ s["w2"] + s["b2"] - yb
        go = 2 * err / len(xb)
        g = {"w2": h.T @ go, "b2": go.sum(0)}
        gh = (go @ s["w2"].T) * (1 - h ** 2)
        g["w1"], g["b1"] = xb.T @ gh, gh.sum(0)
        for k in s:
            m[k] = 0.9 * m[k] + g[k]
            s[k] = s[k] - lr * m[k]
        if i % 20 == 0:
            lg.metric(i, loss=float((err ** 2).mean()))
        lg.progress((i + 1) / steps)
    out = os.path.join(work, "model.npz")
    np.savez(out, **s)
    lg.done(model=out)

elif key == "eval":
    mf = t["files"]["train.model"]
    z = np.load(mf)
    s = {k: z[k] for k in z.files}
    x = np.linspace(-3, 3, 400).reshape(-1, 1)   # 固定的评测集，每天都一样，分数才能比
    mse = float(((predict(s, x) - f(x)) ** 2).mean())
    score = round(1.0 / (1.0 + 20 * mse), 6)
    lg.log(f"评测分数 {score}（误差 {mse:.5f}）")
    lg.metric(int(p.get("runId", 0)), score=score)
    lg.done(model=mf, score=score)
