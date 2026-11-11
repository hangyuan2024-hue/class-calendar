# 捞捞 · 3D 形象工坊：纯 numpy 的正交光栅化（不用显卡）
#   从正面 / 背面看模型，每个像素记下：落在哪个三角形上、重心坐标、深度。
#   有了它就能：拍一张模型的正面照（贴图采样）、从像素反查贴图上的位置（改贴图用）、量剪影（找关节用）
import numpy as np


def screen(pos, view="front"):
    """模型空间 → 屏幕：front 从 +z 往 -z 看（x 向右、y 向上、z 越大越近）；back 从背后看"""
    p = np.asarray(pos, np.float64)
    if view == "front":
        return p[:, 0], p[:, 1], p[:, 2]
    if view == "back":
        return -p[:, 0], p[:, 1], -p[:, 2]
    if view == "left":    # 从模型的左边（+x）看过去
        return -p[:, 2], p[:, 1], p[:, 0]
    if view == "right":
        return p[:, 2], p[:, 1], -p[:, 0]
    raise ValueError(view)


def raster(pos, idx, box, res, view="front", faces=None):
    """box=(x0, x1, y0, y1)：屏幕坐标里要画的范围；res：每单位多少像素。
    返回 dict：fid (H,W) 三角形编号（-1 = 空）、bary (H,W,3)、depth (H,W)、以及换算参数"""
    sx, sy, sz = screen(pos, view)
    x0, x1, y0, y1 = box
    W, H = max(1, int(np.ceil((x1 - x0) * res))), max(1, int(np.ceil((y1 - y0) * res)))
    px, py = (sx - x0) * res - 0.5, (y1 - sy) * res - 0.5
    tri = np.asarray(idx, np.int64) if faces is None else np.asarray(idx, np.int64)[faces]
    tid = np.arange(len(idx)) if faces is None else np.asarray(faces)
    X, Y, Z = px[tri], py[tri], sz[tri]   # (T,3)
    xmin = np.clip(np.floor(X.min(1)), 0, W - 1).astype(np.int64)
    xmax = np.clip(np.ceil(X.max(1)), 0, W - 1).astype(np.int64)
    ymin = np.clip(np.floor(Y.min(1)), 0, H - 1).astype(np.int64)
    ymax = np.clip(np.ceil(Y.max(1)), 0, H - 1).astype(np.int64)
    area = (X[:, 1] - X[:, 0]) * (Y[:, 2] - Y[:, 0]) - (X[:, 2] - X[:, 0]) * (Y[:, 1] - Y[:, 0])
    vis = (X.max(1) >= 0) & (X.min(1) <= W - 1) & (Y.max(1) >= 0) & (Y.min(1) <= H - 1) & (np.abs(area) > 1e-12)
    zbuf = np.full(H * W, -np.inf)
    fbuf = np.full(H * W, -1, np.int64)
    bbuf = np.zeros((H * W, 3), np.float32)
    eps = 1e-6

    def bary(Xc, Yc, k, gx, gy):
        a = area[k][:, None]
        w0 = ((X[k, 1][:, None] - gx) * (Y[k, 2][:, None] - gy) - (X[k, 2][:, None] - gx) * (Y[k, 1][:, None] - gy)) / a
        w1 = ((X[k, 2][:, None] - gx) * (Y[k, 0][:, None] - gy) - (X[k, 0][:, None] - gx) * (Y[k, 2][:, None] - gy)) / a
        return w0, w1, 1.0 - w0 - w1

    # 小三角形一大批一起算（大多数都是），每个最多看 K×K 个像素
    K = 8
    bw, bh = xmax - xmin + 1, ymax - ymin + 1
    small = np.nonzero(vis & (bw <= K) & (bh <= K))[0]
    ox, oy = np.meshgrid(np.arange(K), np.arange(K))
    ox, oy = ox.reshape(-1), oy.reshape(-1)
    for c in range(0, len(small), 20000):
        k = small[c: c + 20000]
        gx = xmin[k][:, None] + ox[None, :]
        gy = ymin[k][:, None] + oy[None, :]
        ok = (gx <= xmax[k][:, None]) & (gy <= ymax[k][:, None])
        w0, w1, w2 = bary(X, Y, k, gx, gy)
        ins = ok & (w0 >= -eps) & (w1 >= -eps) & (w2 >= -eps)
        z = w0 * Z[k, 0][:, None] + w1 * Z[k, 1][:, None] + w2 * Z[k, 2][:, None]
        ti, ci = np.nonzero(ins)
        lin = gy[ti, ci] * W + gx[ti, ci]
        zz = z[ti, ci]
        np.maximum.at(zbuf, lin, zz)
        win = zz >= zbuf[lin]
        fbuf[lin[win]] = tid[k[ti[win]]]
        bbuf[lin[win]] = np.stack([w0[ti, ci][win], w1[ti, ci][win], w2[ti, ci][win]], 1)
    # 大三角形一个一个画
    for k in np.nonzero(vis & ~((bw <= K) & (bh <= K)))[0]:
        gx, gy = np.meshgrid(np.arange(xmin[k], xmax[k] + 1), np.arange(ymin[k], ymax[k] + 1))
        gx, gy = gx.reshape(1, -1), gy.reshape(1, -1)
        w0, w1, w2 = bary(X, Y, np.array([k]), gx, gy)
        ins = (w0 >= -eps) & (w1 >= -eps) & (w2 >= -eps)
        z = w0 * Z[k, 0] + w1 * Z[k, 1] + w2 * Z[k, 2]
        lin = (gy * W + gx)[ins]
        zz = z[ins]
        better = zz > zbuf[lin]
        lin, zz = lin[better], zz[better]
        zbuf[lin] = zz
        fbuf[lin] = tid[k]
        bbuf[lin] = np.stack([w0[ins][better], w1[ins][better], w2[ins][better]], 1)
    return {"fid": fbuf.reshape(H, W), "bary": bbuf.reshape(H, W, 3), "depth": zbuf.reshape(H, W), "box": box, "res": res, "view": view, "W": W, "H": H}


def to_pixel(R, pts):
    """模型空间的点 → 这张图上的像素坐标（x 向右、y 向下）"""
    sx, sy, _ = screen(np.atleast_2d(pts), R["view"])
    x0, x1, y0, y1 = R["box"]
    return np.stack([(sx - x0) * R["res"] - 0.5, (y1 - sy) * R["res"] - 0.5], 1)


def to_model(R, px, py):
    """像素 → 屏幕平面上的坐标（front 时就是模型的 x、y）"""
    x0, x1, y0, y1 = R["box"]
    return x0 + (np.asarray(px) + 0.5) / R["res"], y1 - (np.asarray(py) + 0.5) / R["res"]


def sample(img, uv):
    """在贴图上按 uv 取色（双线性；glTF 的 uv 原点在左上角）。img: (h,w,c) uint8 → float (n,c)"""
    h, w = img.shape[:2]
    u = np.clip(np.asarray(uv)[:, 0], 0, 1) * (w - 1)
    v = np.clip(np.asarray(uv)[:, 1], 0, 1) * (h - 1)
    x0, y0 = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = (u - x0)[:, None], (v - y0)[:, None]
    im = img.astype(np.float64)
    return (im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy) + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy)


def shade(mesh, R, textures, bg=255, light=False):
    """给光栅化的结果上色：贴图 × 材质颜色（light=True 时加一点简单的朝向明暗，看着更像照片）→ (H,W,3) uint8、mask、每像素的 uv"""
    fid, bary = R["fid"], R["bary"]
    H, W = fid.shape
    out = np.full((H, W, 3), bg, np.float64)
    m = fid >= 0
    uvmap = np.full((H, W, 2), -1.0)
    if not m.any():
        return out.astype(np.uint8), m, uvmap
    f = fid[m]
    b = bary[m].astype(np.float64)
    tri = mesh.idx[f]
    col = np.zeros((len(f), 3))
    if mesh.uv is not None:
        uv = (mesh.uv[tri] * b[:, :, None]).sum(1)
        uvmap[m] = uv
    for mi, mat in enumerate(mesh.materials):
        sel = mesh.fmat[f] == mi
        if not sel.any():
            continue
        base = np.array(mat.get("color", [1, 1, 1, 1])[:3], np.float64)
        base = np.where(base <= 0.0031308, base * 12.92, 1.055 * np.power(np.clip(base, 0, 1), 1 / 2.4) - 0.055) * 255   # 线性 → sRGB
        tex = textures[mi] if textures is not None and mi < len(textures) else None
        if tex is not None and mesh.uv is not None:
            col[sel] = sample(tex, uvmap[m][sel])[:, :3] * (base / 255.0)
        else:
            col[sel] = base
    if light:
        n = mesh.face_normals()[f]
        sx = {"front": n[:, 2], "back": -n[:, 2], "left": n[:, 0], "right": -n[:, 0]}[R["view"]]
        col *= (0.55 + 0.45 * np.clip(sx, 0, 1))[:, None]
    out[m] = col
    return np.clip(out, 0, 255).astype(np.uint8), m, uvmap


def load_textures(mesh):
    """材质里的贴图 bytes → numpy 图（RGBA uint8），没有贴图的是 None"""
    from PIL import Image
    import io
    out = []
    for mat in mesh.materials:
        if mat.get("image"):
            out.append(np.asarray(Image.open(io.BytesIO(mat["image"])).convert("RGBA")))
        else:
            out.append(None)
    return out
