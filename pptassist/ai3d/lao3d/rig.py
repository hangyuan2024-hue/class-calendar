# 捞捞 · 3D 形象工坊：自动绑骨骼（从零写的，不用显卡）
#   生成出来的公仔只是一张「皮」，要让它挥手、点头，得知道关节在哪、每块皮跟着哪根骨头动。
#   1. 摆正：脚踩在 y=0，身高统一成 1.25，正面朝 +z（看贴图：脸是皮肤色的那一面是正面）
#   2. 体素化：把模型变成一格一格的实心体
#   3. 找关节：一层一层横着切开，看切面有几块——最下面两块是两条腿，合成一块的地方是裆部；
#      身子旁边单独的、一直垂到下面的两块是胳膊（最低处是手）；身子往上最细的地方是脖子
#   4. 蒙皮：每根骨头在实心体里面走「最短路」（体积测地线，Geodesic Voxel Binding 的做法），
#      皮离哪根骨头近就跟哪根动——胳膊贴着身子的地方，隔着空气不算近，不会把衣服一起带走
import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

H_TARGET = 1.25   # 统一的身高（和程序画的公仔一样高，镜头、动作都按这个调的）

JOINTS = [   # 名字、父关节
    ("hips", None), ("spine", "hips"), ("chest", "spine"), ("neck", "chest"), ("head", "neck"),
    ("shoulder_L", "chest"), ("elbow_L", "shoulder_L"), ("wrist_L", "elbow_L"),
    ("shoulder_R", "chest"), ("elbow_R", "shoulder_R"), ("wrist_R", "elbow_R"),
    ("hip_L", "hips"), ("knee_L", "hip_L"), ("ankle_L", "knee_L"),
    ("hip_R", "hips"), ("knee_R", "hip_R"), ("ankle_R", "knee_R"),
]
# _L 是模型自己的左边（+x，从正面看在画面右边），_R 是 -x


# ---------------------------------------------------------------- 摆正
def normalize(mesh):
    p = mesh.pos
    lo, hi = p.min(0), p.max(0)
    s = H_TARGET / max(hi[1] - lo[1], 1e-9)
    c = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    mesh.pos = (p - c) * s
    return {"scale": float(s), "offset": [float(x) for x in c]}


def turn_around(mesh):
    """绕竖轴转 180°（x → -x，z → -z）"""
    mesh.pos = mesh.pos * np.array([-1, 1, -1])
    if mesh.nor is not None:
        mesh.nor = mesh.nor * np.array([-1, 1, -1])


def skin_score(rgb, mask):
    """一块图里「像皮肤」的比例：暖色、不太暗、不太灰（头发是深色的，后脑勺几乎没有皮肤色）"""
    if mask.sum() < 20:
        return 0.0
    c = rgb[mask].astype(np.float64) / 255.0
    mx, mn = c.max(1), c.min(1)
    v, s = mx, (mx - mn) / np.maximum(mx, 1e-6)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    warm = (r >= g) & (g >= b * 0.85) & (r - b > 0.04)
    skin = warm & (v > 0.5) & (s > 0.06) & (s < 0.65)
    return float(skin.mean())


def facing(mesh, textures):
    """正面朝 +z 吗：比较头部正面、背面的皮肤色多少。返回 (正面分, 背面分)"""
    from .raster import raster, shade
    p = mesh.pos
    H = p[:, 1].max()
    y0 = H * 0.62
    sel = np.nonzero(p[mesh.idx].max(1)[:, 1] > y0)[0]
    hx = np.abs(p[p[:, 1] > y0, 0]).max() if (p[:, 1] > y0).any() else 0.3
    out = []
    for view in ("front", "back"):
        R = raster(p, mesh.idx, (-hx, hx, y0, H), 160 / max(H - y0, 1e-6), view, faces=sel)
        rgb, m, _ = shade(mesh, R, textures)
        h, w = m.shape
        win = np.zeros_like(m)
        win[int(h * 0.3): int(h * 0.95), int(w * 0.3): int(w * 0.7)] = True
        out.append(skin_score(rgb, m & win))
    return out


# ---------------------------------------------------------------- 体素化
def voxelize(mesh, ny=200):
    """实心体素：沿 z 方向打射线数穿过几层皮（进 +1、出 -1），不膨胀，腿缝、胳膊和身子之间的缝都留着。
    皮不完全封闭的地方再用「表面 + 补洞」兜一下"""
    p = mesh.pos
    lo, hi = p.min(0), p.max(0)
    vs = (hi[1] - lo[1]) / ny
    pad = 3
    origin = lo - pad * vs
    dims = (np.ceil((hi - lo) / vs).astype(int) + 2 * pad + 1)
    tri = p[mesh.idx]
    # 1) 表面
    surf = np.zeros(dims, bool)
    L = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
    kk = np.clip(np.ceil(L / (vs * 0.5)).astype(int), 1, 64)
    for k in np.unique(kk):
        t = tri[kk == k]
        i, j = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
        ok = (i + j) <= k
        a, b = (i[ok] / k)[None, :, None], (j[ok] / k)[None, :, None]
        pts = t[:, None, 0] * (1 - a - b) + t[:, None, 1] * a + t[:, None, 2] * b
        q = np.clip(np.floor((pts.reshape(-1, 3) - origin) / vs).astype(int), 0, dims - 1)
        surf[q[:, 0], q[:, 1], q[:, 2]] = True
    # 2) 射线奇偶：每个三角形盖住哪些 (x, y) 柱子的中心，算出那里的 z
    gx = (tri[..., 0] - origin[0]) / vs - 0.5
    gy = (tri[..., 1] - origin[1]) / vs - 0.5
    gz = (tri[..., 2] - origin[2]) / vs - 0.5
    area = (gx[:, 1] - gx[:, 0]) * (gy[:, 2] - gy[:, 0]) - (gx[:, 2] - gx[:, 0]) * (gy[:, 1] - gy[:, 0])
    good = np.abs(area) > 1e-12
    x0 = np.ceil(gx.min(1)).astype(int)
    x1 = np.floor(gx.max(1)).astype(int)
    y0 = np.ceil(gy.min(1)).astype(int)
    y1 = np.floor(gy.max(1)).astype(int)
    D = np.zeros(dims, np.int16)
    JX, JY = 1.37e-4, 2.91e-4   # 射线稍微错开一点点，不会正好打在两个三角形的公共边上（那样会数两次）
    K = 6
    ox, oy = np.meshgrid(np.arange(K), np.arange(K))
    ox, oy = ox.ravel(), oy.ravel()
    sel = np.nonzero(good & (x1 >= x0) & (y1 >= y0))[0]
    big = sel[((x1 - x0)[sel] >= K) | ((y1 - y0)[sel] >= K)]
    small = sel[((x1 - x0)[sel] < K) & ((y1 - y0)[sel] < K)]

    def hits(k, cx, cy):
        A = area[k][:, None]
        w0 = ((gx[k, 1][:, None] - cx) * (gy[k, 2][:, None] - cy) - (gx[k, 2][:, None] - cx) * (gy[k, 1][:, None] - cy)) / A
        w1 = ((gx[k, 2][:, None] - cx) * (gy[k, 0][:, None] - cy) - (gx[k, 0][:, None] - cx) * (gy[k, 2][:, None] - cy)) / A
        w2 = 1 - w0 - w1
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0) & ~((w0 == 0) & (w1 == 0))
        z = w0 * gz[k, 0][:, None] + w1 * gz[k, 1][:, None] + w2 * gz[k, 2][:, None]
        return ins, z

    def add(k, cx, cy, ins, z):
        sgn = np.where(area[k] > 0, -1, 1)   # 三角形朝 +z（逆时针）：出去；朝 -z：进来
        ti, ci = np.nonzero(ins)
        X, Y = cx[ti, ci], cy[ti, ci]
        Z = np.clip(np.ceil(z[ti, ci]).astype(int), 0, dims[2] - 1)
        okk = (X >= 0) & (X < dims[0]) & (Y >= 0) & (Y < dims[1])
        np.add.at(D, (X[okk], Y[okk], Z[okk]), sgn[ti][okk].astype(np.int16))

    for c in range(0, len(small), 50000):
        k = small[c: c + 50000]
        cx = x0[k][:, None] + ox[None]
        cy = y0[k][:, None] + oy[None]
        ins, z = hits(k, cx + JX, cy + JY)
        ins &= (cx <= x1[k][:, None]) & (cy <= y1[k][:, None])
        add(k, cx, cy, ins, z)
    for k in big:
        X, Y = np.meshgrid(np.arange(x0[k], x1[k] + 1), np.arange(y0[k], y1[k] + 1))
        kk_ = np.array([k])
        cx, cy = X.reshape(1, -1), Y.reshape(1, -1)
        ins, z = hits(kk_, cx + JX, cy + JY)
        add(kk_, cx, cy, ins, z)
    wind = np.cumsum(D, axis=2)
    solid = (wind != 0) | surf
    # 皮有破洞时奇偶会乱：穿过去以后没回到 0 的柱子，用「表面补洞」的结果
    filled = ndimage.binary_fill_holes(ndimage.binary_dilation(surf, iterations=1))
    filled = ndimage.binary_erosion(filled, iterations=1) | surf
    bad = wind[:, :, -1] != 0
    if bad.any():
        solid[bad] = filled[bad]
    if abs(int(solid.sum()) - int(filled.sum())) > 0.25 * max(int(filled.sum()), 1) and filled.sum() > surf.sum() * 1.5:
        solid = filled
    return {"solid": solid, "origin": origin, "vs": vs, "dims": dims}


def _w(V, ijk):
    return V["origin"] + (np.asarray(ijk, np.float64) + 0.5) * V["vs"]


def _ijk(V, xyz):
    return np.clip(np.floor((np.asarray(xyz) - V["origin"]) / V["vs"]).astype(int), 0, V["dims"] - 1)


# ---------------------------------------------------------------- 找关节（看正面剪影）
def _runs(row):
    """一行里连续的几段：[(开始, 结束)]"""
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1))


def _ov(a, b):
    return min(a[1], b[1]) - max(a[0], b[0]) + 1


def _crotch_from_hands(RUNS, rt, rb, Wp):
    """两条腿并在一起时估裆部：A 字站姿垂下来的两只手，手尖差不多在裆部那么高（Q版公仔手更短，正好在胯边上）。
    身子（中间那段）两边单独的块里，左右各取最低的那块，两个手尖的平均高度就是裆部。找不到返回 None"""
    Hn = rb - rt
    cmid = Wp / 2
    side = np.zeros((rb + 1, Wp), bool)
    for r in range(rt + int(0.25 * Hn), rb + 1):
        R = RUNS[r]
        if len(R) < 2:
            continue
        c = min(R, key=lambda q: 0 if q[0] <= cmid <= q[1] else min(abs(q[0] - cmid), abs(q[1] - cmid)))
        for q in R:
            if q != c:
                side[r, q[0]: q[1] + 1] = True
    lab, n = ndimage.label(side, structure=np.ones((3, 3), bool))
    low = {}
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if len(ys) < 20 or ys.max() - ys.min() < 0.03 * Hn:
            continue
        s = 1 if xs.mean() > cmid else -1
        if ys.max() > rb - 0.06 * Hn:   # 一直到地上的是腿 / 鞋，不是手
            continue
        if s not in low or ys.max() > low[s]:
            low[s] = ys.max()
    if len(low) < 2 or abs(low[1] - low[-1]) > 0.08 * Hn:
        return None
    r = int((low[1] + low[-1]) / 2)
    return int(np.clip(r, rb - 0.45 * Hn, rb - 0.12 * Hn))


def find_joints(mesh, V, px=1200):
    from .raster import raster
    p = mesh.pos
    lo, hi = p.min(0), p.max(0)
    pad = 0.01
    res = px / (hi[1] - lo[1] + 2 * pad)
    R = raster(p, mesh.idx, (lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad), res, "front")
    M = R["fid"] >= 0
    Hp, Wp = M.shape
    X0, Y1 = lo[0] - pad, hi[1] + pad
    xw = lambda c: X0 + (c + 0.5) / res
    yw = lambda r: Y1 - (r + 0.5) / res
    rows = np.nonzero(M.any(1))[0]
    rt, rb = rows[0], rows[-1]
    Hn = rb - rt
    warn = []
    side = np.zeros_like(M)
    RUNS = [_runs(M[r]) for r in range(Hp)]
    # --- 腿：从脚往上跟着两段走，合成一段的地方是裆部
    r = rb - max(2, int(Hn * 0.015))
    runs = sorted(RUNS[r], key=lambda q: -(q[1] - q[0]))
    legs, crotch = None, None
    if len(runs) >= 2 and (runs[1][1] - runs[1][0]) > 0.3 * (runs[0][1] - runs[0][0]):
        two = sorted(runs[:2])
        legs = [[(r, two[0])], [(r, two[1])]]
        for q in RUNS[r]:
            if q not in two:
                side[r, q[0]: q[1] + 1] = True
        for r in range(r - 1, rt + int(Hn * 0.3), -1):
            pick = []
            for L in legs:
                prev = L[-1][1]
                cand = [q for q in RUNS[r] if _ov(q, prev) > 0]
                pick.append(max(cand, key=lambda q: _ov(q, prev)) if cand else None)
            if pick[0] is None or pick[1] is None:
                break
            if pick[0] == pick[1]:
                crotch = r
                break
            for L, q in zip(legs, pick):
                L.append((r, q))
            for q in RUNS[r]:
                if q not in pick:
                    side[r, q[0]: q[1] + 1] = True
    if crotch is None or not (0.12 * Hn < rb - crotch < 0.6 * Hn):
        warn.append("没分清两条腿（裙子太长或者腿并在一起），按两只手的高度估的")
        crotch = _crotch_from_hands(RUNS, rt, rb, Wp)
        if crotch is None:
            warn[-1] = "没分清两条腿（裙子太长或者腿并在一起），按一般公仔的比例估的"
            crotch = rb - int(0.34 * Hn)
        legs = None
    # --- 身子：从裆部往上跟着中间那段走；两边单独的段记下来（胳膊、垂下来的头发）
    cmid = Wp / 2
    cand = RUNS[crotch]
    trunk = min(cand, key=lambda q: 0 if q[0] <= cmid <= q[1] else min(abs(q[0] - cmid), abs(q[1] - cmid)))
    width = {crotch: trunk}
    for q in cand:
        if q != trunk:
            side[crotch, q[0]: q[1] + 1] = True
    for r in range(crotch - 1, rt - 1, -1):
        prev = width[r + 1]
        cand = [q for q in RUNS[r] if _ov(q, prev) > 0]
        if not cand:
            break
        t = max(cand, key=lambda q: _ov(q, prev))
        width[r] = t
        for q in RUNS[r]:
            if q != t:
                side[r, q[0]: q[1] + 1] = True
    # --- 胳膊：身子两边、一直垂到最下面的那两块（最低处是手）
    lab, n = ndimage.label(side, structure=np.ones((3, 3), bool))
    tc = (width[crotch][0] + width[crotch][1]) / 2
    arms = {}
    if n:
        for s, nm in ((1, "L"), (-1, "R")):
            best = None
            for k in range(1, n + 1):
                ys, xs = np.nonzero(lab == k)
                if len(ys) < 30 or (xs.mean() - tc) * s <= 0:
                    continue
                # 手要垂到比胸口低（裆部往上不到三成）；垂到肩膀附近就停的是两边的头发
                if ys.max() - ys.min() < 0.08 * Hn or ys.max() < crotch - 0.28 * (crotch - rt):
                    continue
                if best is None or ys.max() > best[1].max():
                    best = (k, ys, xs)
            if best:
                arms[nm] = best
    ap = min((arms[a][1].min() for a in arms), default=None)   # 胳膊最上面（腋下），行号越小越高
    # --- 脖子：腋下（没找到胳膊就身子中间）到头顶之间，中间那段最窄的地方
    top_lim = rt + int(0.1 * Hn)
    start = ap - 1 if ap is not None else crotch - int(0.45 * (crotch - rt))
    rs = [r for r in range(start, top_lim, -1) if r in width]
    if len(rs) >= 3:
        w = ndimage.uniform_filter1d(np.array([width[r][1] - width[r][0] for r in rs], np.float64), 5)
        neck = rs[int(np.argmin(w))]
    else:
        neck = rt + int(0.34 * Hn)
        warn.append("没找到脖子，按比例估的")
    if not (0.12 * Hn < neck - rt < 0.58 * Hn):
        neck = rt + int(0.34 * Hn)
        warn.append("脖子的位置不对劲，按比例估的")
    # --- z：在实心体素里，这个 (x, y) 那一竖条从前到后的中间
    S, vs, org = V["solid"], V["vs"], V["origin"]

    def zmid(x, y, fallback=None):
        ix, iy = _ijk(V, [x, y, 0])[:2]
        best = None
        for dx in (0, -1, 1, -2, 2):
            for dy in (0, -1, 1):
                a, b = min(max(ix + dx, 0), S.shape[0] - 1), min(max(iy + dy, 0), S.shape[1] - 1)
                col = S[a, b]
                if col.any():
                    rr = _runs(col)
                    q = max(rr, key=lambda q: q[1] - q[0])
                    best = org[2] + ((q[0] + q[1]) / 2 + 0.5) * vs
                    return best
        return fallback if fallback is not None else np.nan

    def P(x, y):
        return np.array([x, y, zmid(x, y)])

    def mid(r):
        r = min(max(r, min(width)), max(width))
        while r not in width:
            r += 1
        q = width[r]
        return xw((q[0] + q[1]) / 2)

    yc, yn = yw(crotch), yw(neck)
    J = {}
    for name, f in (("hips", 0.06), ("spine", 0.4), ("chest", 0.75)):
        y = yc + f * (yn - yc)
        J[name] = P(mid(int(round(crotch - f * (crotch - neck)))), y)
    xn = mid(neck)
    J["neck"] = P(xn, yn - 0.03 * H_TARGET)
    J["head"] = np.array([xn, yn + 0.015 * H_TARGET, zmid(xn, yn)])
    J["headTop"] = np.array([xn, yw(rt), J["head"][2]])
    # 胳膊：每一行的中心连成线，上面一段拟合直线往上延长到肩膀；手腕、手肘按长度比例放
    def trace(s, pts, r0, outer, arm_w):
        """顺着胳膊外侧的轮廓往上走（中心 = 外沿往里半个胳膊粗），到肩膀顶上轮廓急转弯（或者到脖子那么高）为止"""
        hist = [outer]
        r = r0 - 1
        limit = max(r0 - int(0.5 * Hn), neck + 2)   # 肩膀顶不会比脖子还高（再往上是头发）
        while r > max(limit, rt):
            cand = [q for q in RUNS[r] if (q[1] if s > 0 else q[0]) * s >= (outer - s * arm_w) * s]
            if not cand:
                break
            q = min(cand, key=lambda q: abs((q[1] if s > 0 else q[0]) - outer))
            o2 = q[1] if s > 0 else q[0]
            if (o2 - outer) * s > max(3, 0.3 * arm_w):   # 一下子往外冒出来（头发、袖子边）
                break
            hist.append(o2)
            if len(hist) > 6 and (hist[-6] - hist[-1]) * s > 2.5 * 5:   # 外沿往里收得很急：到肩膀顶上了
                break
            outer = o2
            pts.insert(0, [outer - s * arm_w / 2, r])
            r -= 1
        return pts

    info = {}
    for s, nm in ((1, "L"), (-1, "R")):
        if nm in arms:
            _, ys, xs = arms[nm]
            seg_ = {}
            for r in range(ys.min(), ys.max() + 1):
                m = ys == r
                if m.any():
                    seg_[r] = (xs[m].min(), xs[m].max())
            rr = sorted(seg_)
            wd = np.array([seg_[r][1] - seg_[r][0] + 1 for r in rr], np.float64)
            arm_w = float(np.median(wd[: max(3, len(wd) // 2)]))   # 上半段的粗细
            if rr[-1] - rr[0] < 0.15 * Hn:   # 单独出来的只有手（上面的袖子贴着身子）：手比袖子细，按袖子的一般粗细算
                arm_w = max(arm_w, 0.095 * Hn)
                warn.append(("左" if nm == "L" else "右") + "胳膊贴着身子，顺着外侧轮廓找的（挥手时可能会带动一点衣服）")
            pts = trace(s, [[(seg_[r][0] + seg_[r][1]) / 2, r] for r in rr], rr[0], seg_[rr[0]][1] if s > 0 else seg_[rr[0]][0], arm_w)
        else:
            # 胳膊和身子贴在一起：从手（外侧轮廓在胯旁边最靠外、最低的地方）开始，顺着外沿往上走
            q = width[crotch]
            hipw = (q[1] - q[0]) / 2
            ctr = (q[0] + q[1]) / 2
            arm_w = max(4.0, 0.095 * Hn)
            tip = None
            for r in range(min(rb, crotch + int(0.12 * Hn)), crotch - int(0.3 * (crotch - rt)), -1):
                if not RUNS[r]:
                    continue
                o = max(q_[1] for q_ in RUNS[r]) if s > 0 else min(q_[0] for q_ in RUNS[r])
                if (o - ctr) * s > hipw * 1.12:
                    tip = (r, o)
                    break
            if tip is None:
                warn.append(("左" if nm == "L" else "右") + "胳膊和身子贴在一起，没单独找到，按比例估的（挥手时可能会带动衣服）")
                r_sh = int(round(crotch - 0.86 * (crotch - neck)))
                q2 = width.get(r_sh, width[crotch])
                sx = (q2[1] if s > 0 else q2[0]) - s * arm_w / 2
                pts = [[sx + s * (k / 11) * arm_w * 0.6, r_sh + (crotch + 0.02 * Hn - r_sh) * k / 11] for k in range(12)]
            else:
                warn.append(("左" if nm == "L" else "右") + "胳膊贴着身子，顺着外侧轮廓找的（挥手时可能会带动一点衣服）")
                pts = trace(s, [[tip[1] - s * arm_w / 2, tip[0]]], tip[0], tip[1], arm_w)
        pts = np.array(pts, np.float64)
        top_r = pts[0, 1]
        # 肩关节在肩膀顶下面大约半个胳膊粗的地方
        k = int(np.searchsorted(pts[:, 1], top_r + arm_w * 0.55))
        k = min(max(k, 1), len(pts) - 2)
        pts = pts[k:]
        line = np.stack([P(xw(x), yw(r)) for x, r in pts])
        info["arm_" + nm] = {"x": [float(xw(x)) for x, _ in pts], "y": [float(yw(r)) for _, r in pts], "w": float(arm_w / res), "sep": nm in arms}
        if np.isnan(line[:, 2]).any():   # 那一竖条里没碰到模型（比如手尖）：用这条胳膊别处的
            line[np.isnan(line[:, 2]), 2] = np.nanmedian(line[:, 2]) if (~np.isnan(line[:, 2])).any() else J["chest"][2]
        if len(line) > 4:   # z 抖得厉害（竖条有时穿过别的地方）：沿胳膊取中位数抹平
            line[:, 2] = ndimage.median_filter(line[:, 2], size=min(9, len(line) // 2 * 2 + 1), mode="nearest")
        seg = np.linalg.norm(np.diff(line[:, :2], axis=0), axis=1)   # 长度按正面看的（x, y）算
        cum = np.concatenate([[0], np.cumsum(seg)])
        at = lambda t: np.array([np.interp(t * cum[-1], cum, line[:, k]) for k in range(3)])
        J["shoulder_" + nm], J["elbow_" + nm], J["wrist_" + nm], J["handTip_" + nm] = line[0], at(0.37), at(0.73), line[-1]
    # 腿：裆部下面两段的中心；脚踝离地 0.22，膝盖在中间；脚尖在实心体最前面
    for s, nm in ((1, "L"), (-1, "R")):
        if legs:
            L = sorted(legs, key=lambda L: L[0][1][0])[1 if s > 0 else 0]
            ctr = {r: xw((q[0] + q[1]) / 2) for r, q in L}
            ks = sorted(ctr)
            leg_x = lambda y, ctr=ctr, ks=ks: ctr[min(ks, key=lambda r: abs(yw(r) - y))]
        else:
            q = width[crotch]
            hx = (xw(q[1]) - xw(q[0])) / 4
            leg_x = lambda y, hx=hx, s=s: mid(crotch) + s * hx
        yh = yc + 0.02 * H_TARGET
        yb_ = yw(rb)
        ya = yb_ + 0.22 * (yh - yb_)
        J["hip_" + nm] = P(leg_x(yc - 0.01), yh)
        J["ankle_" + nm] = P(leg_x(ya), ya)
        J["knee_" + nm] = P(leg_x((yh + ya) / 2), (yh + ya) / 2)
        ix, iy = _ijk(V, [J["ankle_" + nm][0], yb_ + 0.02, 0])[:2]
        zs = np.nonzero(S[max(ix - 2, 0): ix + 3, iy].any(0))[0]
        J["toe_" + nm] = np.array([J["ankle_" + nm][0], yb_ + 0.02, org[2] + (zs.max() + 0.5) * vs if len(zs) else J["ankle_" + nm][2] + 0.08])
    zc = J["chest"][2] if not np.isnan(J["chest"][2]) else 0.0
    for k in J:
        if np.isnan(J[k]).any():
            J[k] = np.where(np.isnan(J[k]), zc, J[k])
    lm = {"crotch": float(yc), "neck": float(yn), "top": float(yw(rt)), "bottom": float(yw(rb)), "armpit": None if ap is None else float(yw(ap))}
    return J, lm, warn, info


# ---------------------------------------------------------------- 蒙皮
BONES = {   # 关节 → 它带动的骨头段（从哪到哪）
    "hips": [("hips", "spine"), ("hips", "hip_L"), ("hips", "hip_R")],
    "spine": [("spine", "chest")],
    "chest": [("chest", "neck"), ("chest", "shoulder_L"), ("chest", "shoulder_R")],
    "neck": [("neck", "head")],
    "head": [("head", "headTop")],
    "shoulder_L": [("shoulder_L", "elbow_L")], "elbow_L": [("elbow_L", "wrist_L")], "wrist_L": [("wrist_L", "handTip_L")],
    "shoulder_R": [("shoulder_R", "elbow_R")], "elbow_R": [("elbow_R", "wrist_R")], "wrist_R": [("wrist_R", "handTip_R")],
    "hip_L": [("hip_L", "knee_L")], "knee_L": [("knee_L", "ankle_L")], "ankle_L": [("ankle_L", "toe_L")],
    "hip_R": [("hip_R", "knee_R")], "knee_R": [("knee_R", "ankle_R")], "ankle_R": [("ankle_R", "toe_R")],
}


def _graph(S, vs):
    ids = -np.ones(S.shape, np.int64)
    n = int(S.sum())
    ids[S] = np.arange(n)
    rows, cols, ws = [], [], []
    offs = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]
    X, Y, Z = S.shape
    for dx, dy, dz in offs:
        a = S[max(0, -dx): X - max(0, dx), max(0, -dy): Y - max(0, dy), max(0, -dz): Z - max(0, dz)]
        b = S[max(0, dx): X - max(0, -dx) or None, max(0, dy): Y - max(0, -dy) or None, max(0, dz): Z - max(0, -dz) or None]
        ia = ids[max(0, -dx): X - max(0, dx), max(0, -dy): Y - max(0, dy), max(0, -dz): Z - max(0, dz)]
        ib = ids[max(0, dx): X - max(0, -dx) or None, max(0, dy): Y - max(0, -dy) or None, max(0, dz): Z - max(0, -dz) or None]
        m = a & b
        rows.append(ia[m])
        cols.append(ib[m])
        ws.append(np.full(int(m.sum()), vs * np.sqrt(dx * dx + dy * dy + dz * dz)))
    G = coo_matrix((np.concatenate(ws), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsr()
    return G, ids


def skin_weights(mesh, V, J, power=6.0, smooth=2, info=None):
    # 贴图接缝处同一个位置有好几个顶点：先按位置合成一个算权重，最后再分回去（不然弯胳膊时接缝会裂开）
    key = np.round(mesh.pos / max(V["vs"] * 1e-3, 1e-7)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)

    class _M:   # 合并后的网格
        pos = mesh.pos[first]
        idx = inv[mesh.idx]
    top, tw, D = _skin_weights(_M, V, J, power, smooth, info)
    return top[inv], tw[inv], D[inv]


def _skin_weights(mesh, V, J, power, smooth, info=None):
    S, vs = V["solid"], V["vs"]
    G, ids = _graph(S, vs)
    edt_idx = ndimage.distance_transform_edt(~S, return_distances=False, return_indices=True)
    def node_of(pts):
        q = _ijk(V, pts)
        nx, ny, nz = edt_idx[0][q[:, 0], q[:, 1], q[:, 2]], edt_idx[1][q[:, 0], q[:, 1], q[:, 2]], edt_idx[2][q[:, 0], q[:, 1], q[:, 2]]
        return ids[nx, ny, nz], np.linalg.norm(_w(V, np.stack([nx, ny, nz], 1)) - pts, axis=1)
    names = [j for j, _ in JOINTS]
    vnode, vgap = node_of(mesh.pos)
    D = np.zeros((len(mesh.pos), len(names)))
    for bi, name in enumerate(names):
        pts = []
        for a, b in BONES[name]:
            pa, pb = J[a], J[b]
            k = max(2, int(np.linalg.norm(pb - pa) / (vs * 0.5)))
            pts.append(pa[None] + (pb - pa)[None] * np.linspace(0, 1, k)[:, None])
        seeds, _ = node_of(np.concatenate(pts))
        seeds = np.unique(seeds[seeds >= 0])
        d = dijkstra(G, directed=False, indices=seeds, min_only=True)
        dv = d[vnode] + vgap
        dv[~np.isfinite(dv)] = 1e3
        D[:, bi] = dv
    Wt = 1.0 / np.power(D + vs * 0.5, power)
    # 胳膊和身子在体积里常常是连着的（贴着，或者缝太窄）：在胳膊内侧那条线（中心线往里半个胳膊粗）切一刀，线里面的皮不跟胳膊动
    for s, nm in ((1, "L"), (-1, "R")):
        a = (info or {}).get("arm_" + nm)
        if not a:   # 分开的胳膊也切：剪影上隔着一两毫米，体素里常常还是连着的
            continue
        ys, xs = np.array(a["y"]), np.array(a["x"])
        o = np.argsort(ys)
        ys, xs = ys[o], xs[o]
        p = mesh.pos
        w = a["w"]
        band = p[:, 1] < ys[-1] - w * 0.3   # 肩膀往下（手尖往下也算：胯旁边的皮不跟着手走）
        inner = np.interp(p[:, 1], ys, xs) - s * w * 0.55
        cut = band & ((p[:, 0] - inner) * s < 0)
        for j in ("shoulder_", "elbow_", "wrist_"):
            Wt[cut, names.index(j + nm)] *= 1e-4
    Wt /= Wt.sum(1, keepdims=True)
    if smooth:   # 在皮上抹匀一点，关节弯的地方不起褶
        f = mesh.idx
        rows = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
        cols = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
        A = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(mesh.pos),) * 2).tocsr()
        A.data[:] = 1.0
        deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
        for _ in range(smooth):
            Wt = 0.5 * Wt + 0.5 * (A @ Wt) / deg[:, None]
    top = np.argsort(-Wt, axis=1)[:, :4]
    tw = np.take_along_axis(Wt, top, 1)
    tw[tw < 0.01] = 0
    tw /= np.maximum(tw.sum(1, keepdims=True), 1e-9)
    return top.astype(np.uint16), tw.astype(np.float32), D


def rig(mesh, ny=240):
    """mesh 已经摆正（normalize、朝向对了）。返回 {joints, jidx, w, landmarks, warn, extra}"""
    V = voxelize(mesh, ny)
    J, lm, warn, info = find_joints(mesh, V)
    jidx, w, _ = skin_weights(mesh, V, J, info=info)
    names = [j for j, _ in JOINTS]
    joints = [{"name": n, "parent": (names.index(p) if p else -1), "pos": [float(x) for x in J[n]]} for n, p in JOINTS]
    extra = {k: [float(x) for x in J[k]] for k in ("headTop", "handTip_L", "handTip_R", "toe_L", "toe_R")}
    return {"joints": joints, "jidx": jidx, "w": w, "landmarks": lm, "warn": warn, "extra": extra, "voxel": float(V["vs"])}
