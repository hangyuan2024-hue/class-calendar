"""捞捞 Q版 · 自动训练 · 训练「Q版打分模型」（新审核攒够了就跑一次，一台电脑几分钟）
用的是大家到现在为止所有的审核结果（「哪张 Q版更好」）：
  · 每张图在生成时已经算好了 CLIP 特征，这里只训练一个很小的打分网络（输入：Q版的特征 + 和照片的关系；只用 numpy，不要显卡）
  · 每 5 条留 1 条当考题（按审核编号固定分，不会今天在训练里、明天又当考题）
  · 同一份考题上同时考「现在发布的那一版」和「今天新训的」：新的答对得更多才发布
以后用它：老师端几张候选里自动把最好的排第一；训练 Q版插件时自动评测画得好不好。
"""
import base64
import json
import os

import numpy as np

import lg

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()
MIN_PAIRS = max(3, int(p.get("minPairs", 40)))
D = 768


def vec(b):
    return np.frombuffer(base64.b64decode(b), dtype=np.float16).astype(np.float32)


# ---- 审核结果 → 成对的数据 ----
items = lg.dataset()
pairs = []   # (审核编号, 赢的特征, 输的特征, 照片特征, 票数)
skipped = 0
for it in items:
    r, pl = it.get("result") or {}, it.get("payload") or {}
    m = pl.get("meta") or {}
    c = r.get("choice")
    if c not in ("a", "b") or not all(k in m for k in ("ea", "eb", "ep")):
        skipped += 1
        continue
    ea, eb, ep = vec(m["ea"]), vec(m["eb"]), vec(m["ep"])
    w, l = (ea, eb) if c == "a" else (eb, ea)
    pairs.append((int(it["id"]), w, l, ep, int((r.get("votes") or {}).get(c, 1))))
lg.log("审核结果 %d 条：能用的 %d 对（差不多 / 都不行 / 平局的 %d 条先不用）" % (len(items), len(pairs), skipped))
if len(pairs) < MIN_PAIRS:
    lg.done(skip="审核结果还不够（能用的 %d 对，要 %d 对），先攒着，明天再训" % (len(pairs), MIN_PAIRS), pairs=len(pairs))
    raise SystemExit(0)

test = [x for x in pairs if x[0] % 5 == 0]
train = [x for x in pairs if x[0] % 5 != 0]
want = max(1, min(5, len(pairs) // 5))   # 考题太少的时候：从训练里挪几条（固定挪编号最大的）
if len(test) < want:
    train.sort(key=lambda x: x[0])
    k = want - len(test)
    test, train = test + train[-k:], train[:-k]


def feats(x, ph):
    # Q版自己的特征 + 和照片的关系（像不像本人）
    return np.concatenate([x, x * ph], axis=-1)


def arr(rows):
    W = np.stack([feats(r[1], r[3]) for r in rows]).astype(np.float32)
    L = np.stack([feats(r[2], r[3]) for r in rows]).astype(np.float32)
    n = np.array([r[4] for r in rows], dtype=np.float32)
    return W, L, n


# ---- 打分网络：线性 + （数据多了以后）一层小网络，只用 numpy，任何电脑几分钟（不要显卡）----
#   审核结果还少的时候只用线性的（参数少，不容易死记硬背）；攒到几千对再加一层
def init(seed, hidden):
    r = np.random.default_rng(seed)
    w = {"v": np.zeros((2 * D, 1), np.float32)}
    if hidden:
        w.update({"w1": (r.normal(0, 1, (2 * D, hidden)) / np.sqrt(2 * D)).astype(np.float32), "b1": np.zeros(hidden, np.float32),
                  "w2": np.zeros((hidden, 1), np.float32)})
    return w


def score(w, X):
    s = (X @ w["v"])[:, 0]
    if "w1" in w:
        s = s + (np.tanh(X @ w["w1"] + w["b1"]) @ w["w2"])[:, 0]
    return s


def acc(w, W, L):
    return float(np.mean(score(w, W) - score(w, L) > 0))


# safetensors 格式（8 字节头长度 + JSON 头 + 数据），自己读写，不用装包
def save_st(f, ws, meta):
    head, off, blobs = {"__metadata__": meta}, 0, []
    for k in sorted(ws):
        b = np.ascontiguousarray(ws[k], dtype=np.float32).tobytes()
        head[k] = {"dtype": "F32", "shape": list(ws[k].shape), "data_offsets": [off, off + len(b)]}
        off += len(b)
        blobs.append(b)
    h = json.dumps(head).encode()
    h += b" " * ((8 - len(h) % 8) % 8)
    with open(f, "wb") as fh:
        fh.write(len(h).to_bytes(8, "little") + h + b"".join(blobs))


def load_st(f):
    with open(f, "rb") as fh:
        n = int.from_bytes(fh.read(8), "little")
        head = json.loads(fh.read(n))
        data = fh.read()
    out = {}
    for k, v in head.items():
        if k == "__metadata__":
            continue
        if v["dtype"] != "F32":
            raise ValueError("不认识的格式 " + v["dtype"])
        a, b = v["data_offsets"]
        out[k] = np.frombuffer(data[a:b], dtype=np.float32).reshape(v["shape"])
    if "v" not in out or out["v"].shape != (2 * D, 1):
        raise ValueError("结构不一样")
    return out


Wtr, Ltr, ntr = arr(train)
Wte, Lte, _ = arr(test)
lg.log("训练 %d 对，考题 %d 对" % (len(train), len(test)))

H = int(p["hidden"]) if p.get("hidden") is not None else (0 if len(train) < 3000 else 64)
w = init(int(p.get("seed", 0)), H)
mom = {k: np.zeros_like(v) for k, v in w.items()}
vel = {k: np.zeros_like(v) for k, v in w.items()}
lr, wd, epochs = float(p.get("lr", 3e-3)), float(p.get("wd", 3e-3)), int(p.get("epochs", 300))
nw = ntr / ntr.sum()
for e in range(epochs):
    d = score(w, Wtr) - score(w, Ltr)
    loss = float(np.sum(nw * np.logaddexp(0, -d)))   # Bradley-Terry：赢的分数要比输的高
    g_d = (-nw / (1 + np.exp(np.clip(d, -50, 50))))[:, None]     # d loss / d d
    g = {"v": Wtr.T @ g_d - Ltr.T @ g_d}
    if H:
        hW, hL = np.tanh(Wtr @ w["w1"] + w["b1"]), np.tanh(Ltr @ w["w1"] + w["b1"])
        g["w2"] = hW.T @ g_d - hL.T @ g_d
        dhW, dhL = (g_d @ w["w2"].T) * (1 - hW ** 2), (-g_d @ w["w2"].T) * (1 - hL ** 2)
        g["w1"] = Wtr.T @ dhW + Ltr.T @ dhL
        g["b1"] = dhW.sum(0) + dhL.sum(0)
    for k in w:   # Adam + L2
        gk = g[k] + (wd * w[k] if k != "b1" else 0)
        mom[k] = 0.9 * mom[k] + 0.1 * gk
        vel[k] = 0.999 * vel[k] + 0.001 * gk ** 2
        mh, vh = mom[k] / (1 - 0.9 ** (e + 1)), vel[k] / (1 - 0.999 ** (e + 1))
        w[k] = (w[k] - lr * mh / (np.sqrt(vh) + 1e-8)).astype(np.float32)
    if e % 10 == 0 or e == epochs - 1:
        lg.metric(e, loss=loss, acc=acc(w, Wte, Lte))
        lg.progress((e + 1) / epochs, "训练打分模型")

a_new = acc(w, Wte, Lte)
a_train = acc(w, Wtr, Ltr)
base = None
ws = (t.get("files") or {}).get("warmStart")
if ws:
    try:
        base = acc(load_st(ws), Wte, Lte)
        lg.log("现在发布的那一版在同样的考题上：答对 %.1f%%" % (base * 100))
    except Exception as e:   # 结构换了，旧的读不了：当作没有
        lg.log("读不了现在发布的那一版（%s），只看新的" % e)
lg.log("新训的：考题答对 %.1f%%（训练题 %.1f%%）" % (a_new * 100, a_train * 100))

out = os.path.join(work, "qversion-scorer.safetensors")
save_st(out, w, {
    "format": "laolao-qversion-scorer-1",
    "embed": "openai/clip-vit-large-patch14 image_embeds, L2-normalized; image padded to a white square, 224x224 bicubic",
    "input": "x = concat(q, q*photo); score = x@v" + (" + tanh(x@w1+b1)@w2 (hidden %d)" % H if H else ""),
    "acc": "%.4f" % a_new, "pairs": str(len(pairs)),
})
res = {"scorer": out, "acc": round(a_new, 4), "train_acc": round(a_train, 4), "pairs": len(pairs), "test": len(test)}
if base is not None:
    res["base_acc"] = round(base, 4)
lg.done(**res)
