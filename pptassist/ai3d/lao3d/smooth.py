# 磨皮：生成的模型表面常有一圈圈小台阶、褶皱（体素化 / 抽面留下的），这里把它磨平。
# 用 Taubin 平滑（一步收、一步放，体积基本不缩），而且只沿法线方向挪点：
# 点不在表面上滑，贴图就不会跑位。贴图接缝处重合的点先合起来算，磨完法线也按合起来的算，接缝处不会有一道线。
import numpy as np
from scipy.sparse import coo_matrix, diags


def weld(pos, tol):
    key = np.round(pos / max(tol, 1e-9)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return first, inv.reshape(-1)


def _normals(P, F):
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    fn = np.cross(b - a, c - a)
    n = np.zeros_like(P)
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def _laplacian(P, F):
    """邻居的平均（按边长倒数加权，网格疏密不均时也不会把点往密的地方拉）"""
    n = len(P)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    e = np.unique(e, axis=0)
    e = e[e[:, 0] != e[:, 1]]
    L = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
    w = 1.0 / np.maximum(L, np.median(L) * 0.05)
    W = coo_matrix((w, (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    d = np.asarray(W.sum(1)).reshape(-1)
    return diags(1.0 / np.maximum(d, 1e-12)) @ W, e


def _boundary(F, n):
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    u, c = np.unique(e, axis=0, return_counts=True)
    b = np.zeros(n, bool)
    b[u[c == 1].reshape(-1)] = True
    return b


def taubin(P, F, iters=10, lam=0.5, mu=-0.53, normal_only=True):
    """P (n,3) 焊接好的点，F (m,3)。返回磨好的点。"""
    P = P.copy()
    A, _ = _laplacian(P, F)
    fixed = _boundary(F, len(P))
    for _ in range(iters):
        for f in (lam, mu):
            d = A @ P - P
            if normal_only:
                N = _normals(P, F)
                d = N * np.sum(d * N, axis=1, keepdims=True)
            d[fixed] = 0
            P += f * d
    return P


def roughness(P, F):
    """表面有多不平：相邻面法线夹角的中位数（度）。只用来做测试和日志。"""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    fn = np.cross(b - a, c - a)
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    m = len(F)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(m), 3)
    e = np.sort(e, axis=1)
    order = np.lexsort((e[:, 1], e[:, 0]))
    e, fid = e[order], fid[order]
    same = np.all(e[1:] == e[:-1], axis=1)
    f1, f2 = fid[:-1][same], fid[1:][same]
    cos = np.clip(np.sum(fn[f1] * fn[f2], axis=1), -1, 1)
    return float(np.degrees(np.median(np.arccos(cos)))) if len(cos) else 0.0


def iters_for(P, F, strength=1.0, height=1.25):
    """磨几遍：按网格疏密定（密的网格要多磨几遍才能磨掉同样大小的疙瘩）。
    身高 1.25、边长 0.0054（体素 230 层抽出来的面）时磨 150 遍正合适，其它按边长的平方换算"""
    e = np.linalg.norm(P[F[:, 0]] - P[F[:, 1]], axis=1)
    edge = float(np.median(e)) * 1.25 / max(height, 1e-9)
    return int(np.clip(round(strength * 150 * (0.0054 / max(edge, 1e-6)) ** 2), 0 if strength <= 0 else 6, 300))


def smooth_mesh(mesh, strength=1.0, tol=None):
    """原地磨 mesh（lao3d.glb.Mesh），重算顺滑的法线。strength：1 = 默认，0 = 只把法线弄顺、不磨。
    返回 (磨之前的不平度, 磨之后的不平度, 磨了几遍)。"""
    ext = np.ptp(mesh.pos, axis=0).max()
    first, inv = weld(mesh.pos, tol or ext * 1e-5)
    P, F = mesh.pos[first], inv[mesh.idx]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])]
    r0 = roughness(P, F)
    iters = iters_for(P, F, strength, np.ptp(P[:, 1]))
    if iters > 0:
        P = taubin(P, F, iters)
    mesh.pos = P[inv]
    mesh.nor = _normals(P, F)[inv]
    return r0, roughness(P, F), iters
