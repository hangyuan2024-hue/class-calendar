# 捞捞 · 3D 形象工坊：生成出来的 3D 模型自己先查一遍硬伤（不用显卡，只用 numpy）
#   一次生成几个候选（不同的随机种子），有硬伤的先淘汰，剩下的按分数排好，最好的那个给老师
#   · 断成好几块：最大的那一块占不到全部面积的 97%（多出来的碎片、飘在旁边的东西）
#   · 有破洞：只挨着一个三角形的边太多（同一个位置的点先合在一起，贴图接缝不算洞）
#   · 左右歪得厉害：正面的剪影和它左右翻过来的样子重合得太少
#   · 比例不对：不像一个站着的公仔（太扁、太细长）
import numpy as np

from .glb import read_glb
from .raster import raster


def _weld(pos, idx, tol=1e-5):
    """位置一样的点合成一个（贴图接缝会把一个点拆成好几个）→ 新的面"""
    q = np.round(np.asarray(pos) / tol).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)[np.asarray(idx)]


def _areas(pos, idx):
    a, b, c = (pos[idx[:, k]] for k in range(3))
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)


def _components(idx, n):
    """连通的几块：每个面属于哪一块（并查集）"""
    par = np.arange(n)

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b, c in idx:
        ra, rb, rc = find(a), find(b), find(c)
        par[rb] = ra
        par[find(rc)] = ra
    roots = np.array([find(v) for v in range(n)])
    return roots[idx[:, 0]]


def check(src):
    """查一个 .glb（路径或 bytes）→ {ok, score 0~1, problems [...], 各项数}"""
    m = read_glb(src)
    pos, idx = m.pos, m.idx
    if len(idx) < 50:
        return {"ok": False, "score": 0.0, "problems": ["几乎是空的（三角形太少）"]}
    widx = _weld(pos, idx)
    area = _areas(pos, idx)
    tot = float(area.sum()) or 1.0
    comp = _components(widx, int(widx.max()) + 1)
    share = max(float(area[comp == c].sum()) for c in np.unique(comp)) / tot
    # 只挨着一个三角形的边（洞的边）
    e = np.sort(np.concatenate([widx[:, [0, 1]], widx[:, [1, 2]], widx[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(e, axis=0, return_counts=True)
    open_edges = float((cnt == 1).sum()) / max(1, len(cnt))
    # 正面剪影和它左右翻过来的重合多少（以模型的中线为轴）
    lo, hi = pos.min(0), pos.max(0)
    cx = float(np.average((pos[:, 0]), weights=None))
    half = max(hi[0] - cx, cx - lo[0]) * 1.05 + 1e-6
    box = (cx - half, cx + half, lo[1], hi[1])
    res = 160.0 / max(1e-6, max(2 * half, hi[1] - lo[1]))
    r = raster(pos, idx, box, res, view="front")
    sil = r["fid"] >= 0
    inter = float((sil & sil[:, ::-1]).sum())
    union = float((sil | sil[:, ::-1]).sum()) or 1.0
    sym = inter / union
    w, h = float(hi[0] - lo[0]) or 1e-6, float(hi[1] - lo[1])
    aspect = h / w
    problems = []
    if share < 0.97:
        problems.append("断成好几块（最大的一块只占 %d%%）" % round(share * 100))
    if open_edges > 0.003:
        problems.append("有破洞（%.1f%% 的边是洞的边）" % (open_edges * 100))
    if sym < 0.8:
        problems.append("左右歪得厉害（正面剪影左右只重合 %d%%）" % round(sym * 100))
    if not 0.9 <= aspect <= 4.0:
        problems.append("比例不像站着的公仔（高是宽的 %.1f 倍）" % aspect)
    score = 0.3 * share + 0.3 * max(0.0, 1 - open_edges * 100) + 0.4 * sym
    return {"ok": not problems, "score": round(score, 4), "problems": problems, "share": round(share, 4), "open_edges": round(open_edges, 5), "sym": round(sym, 4), "aspect": round(aspect, 3)}


def rank(paths):
    """几个候选 → 按「没有硬伤的在前、分数高的在前」排好：[(路径, 查的结果), ...]"""
    out = []
    for p in paths:
        try:
            out.append((p, check(p)))
        except Exception as e:   # 读不了的：放最后
            out.append((p, {"ok": False, "score": 0.0, "problems": ["读不了：%s" % e]}))
    return sorted(out, key=lambda x: (not x[1]["ok"], -x[1]["score"]))
