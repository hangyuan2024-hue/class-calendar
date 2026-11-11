# 捞捞 · 3D 形象工坊：让生成出来的公仔会眨眼、会说话（不用显卡）
#   生成的模型，眼睛和嘴是「画」在贴图上的，不会动。这里：
#   1. 给头拍一张正面照（正交、按贴图上色）
#   2. 在照片里找脸（皮肤色那一大块）和脸上的眼睛、嘴（皮肤里面颜色深的、红的小块）
#      ——找得不准，可以让老师在这张照片上点三下（两只眼睛、嘴）纠正
#   3. 把眼睛和嘴原样抠下来，存成小图（带透明边）；贴图上原来的地方用周围的皮肤色补上
#   4. 播放时在脸上贴一层透明的「画布」，把抠下来的眼睛、嘴画回原位：平时和生成的一模一样，
#      眨眼时把眼睛压扁、说话时把嘴换成张开的样子
import base64
import io

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

from .raster import raster, shade, to_pixel, to_model


def head_shot(mesh, textures, joints, top, px=900):
    """头部正面照。joints: {名字: 位置}；返回 R（光栅化结果）、rgb、mask"""
    y0 = joints["neck"][1] - 0.02
    sel = np.nonzero(mesh.pos[mesh.idx].max(1)[:, 1] > y0)[0]
    up = mesh.pos[:, 1] > y0
    hx = float(np.abs(mesh.pos[up, 0]).max()) if up.any() else 0.3
    R = raster(mesh.pos, mesh.idx, (-hx, hx, y0, top), px / max(top - y0, 1e-6), "front", faces=sel)
    rgb, m, _ = shade(mesh, R, textures)
    return R, rgb, m


def _lab(rgb):
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float64)


def detect(rgb, mask, hints=None):
    """在头部正面照里找脸、两只眼睛、嘴。hints：老师点的三个点 {"e1": [x,y], "e2": [x,y], "mouth": [x,y]}（像素）。
    返回 dict（像素坐标）：face 框、eyes [框, 框]、mouth 框、各自的 mask、颜色、提示"""
    H, W = mask.shape
    rgb = cv2.medianBlur(np.ascontiguousarray(rgb), 5)   # 贴图上的细碎噪点先抹掉
    lab = _lab(rgb)
    c = rgb.astype(np.float64) / 255
    mx, mn = c.max(2), c.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    warm = (c[..., 0] >= c[..., 1]) & (c[..., 1] >= c[..., 2] * 0.85) & (c[..., 0] - c[..., 2] > 0.04)
    cand = mask & warm & (mx > 0.5) & (sat > 0.05) & (sat < 0.7)
    yy, xx = np.mgrid[0:H, 0:W]
    win = cand & (yy > H * 0.3) & (np.abs(xx - W / 2) < W * 0.3)
    if win.sum() < 50:
        win = cand
    if win.sum() < 20:
        raise ValueError("头上没找到皮肤色（可能模型是背对着的，或者贴图没生成好）")
    skin_lab = np.median(lab[win], axis=0)
    d = lab - skin_lab
    dE = np.sqrt((0.5 * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)
    skin = mask & (dE < 20)
    skin = ndimage.binary_opening(skin, iterations=1)
    lab_s, n = ndimage.label(skin)
    if n == 0:
        raise ValueError("没找到脸")
    sizes = ndimage.sum(skin, lab_s, range(1, n + 1))
    # 脸：最大的那块皮肤（如果脖子也连着，它在下面，不影响眼睛、嘴的判断）
    face = lab_s == (1 + int(np.argmax(sizes)))
    k = max(3, int(W * 0.06))
    closed = ndimage.binary_closing(face, structure=np.ones((k, k)), iterations=1) | face
    filled = ndimage.binary_fill_holes(closed) & mask
    ys, xs = np.nonzero(filled)
    fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
    fw, fh = fx1 - fx0 + 1, fy1 - fy0 + 1
    fcx = (fx0 + fx1) / 2
    L = lab[..., 0]
    dark = L < skin_lab[0] - 32
    reddish = (d[..., 1] > 14) & (L < skin_lab[0] - 10)
    feat = filled & ~skin & (dark | reddish)
    feat = ndimage.binary_closing(feat, iterations=2)
    lab_f, nf = ndimage.label(feat)
    comps = []
    for i in range(1, nf + 1):
        m = lab_f == i
        a = int(m.sum())
        if a < fw * fh * 0.0006:
            continue
        cy, cx = ndimage.center_of_mass(m)
        y_, x_ = np.nonzero(m)
        comps.append({"i": i, "a": a, "cx": cx, "cy": cy, "box": [int(x_.min()), int(y_.min()), int(x_.max()), int(y_.max())], "m": m, "red": float(np.mean(d[..., 1][m])),
                      "dark": float(np.mean(dark[m])), "L": float(np.mean(L[m]))})
    notes = []

    def near(pt, kind):
        if not comps:
            return None
        best = min(comps, key=lambda q: (q["cx"] - pt[0]) ** 2 + (q["cy"] - pt[1]) ** 2)
        b = best["box"]
        r = max(b[2] - b[0], b[3] - b[1]) / 2 + fw * 0.05
        return best if (best["cx"] - pt[0]) ** 2 + (best["cy"] - pt[1]) ** 2 <= r * r else None

    def box_of(q, pt=None, kind="eye"):
        if q is not None:
            x0, y0, x1, y1 = q["box"]
            px_, py_ = (x1 - x0) * 0.22 + 2, (y1 - y0) * 0.3 + 2
            return [int(max(0, x0 - px_)), int(max(0, y0 - py_)), int(min(W - 1, x1 + px_)), int(min(H - 1, y1 + py_))], q["m"]
        bw, bh = (fw * 0.2, fh * 0.13) if kind == "eye" else (fw * 0.18, fh * 0.08)
        b = [int(pt[0] - bw / 2), int(pt[1] - bh / 2), int(pt[0] + bw / 2), int(pt[1] + bh / 2)]
        return b, None

    eyes, mouth = None, None
    if hints and all(k in hints for k in ("e1", "e2", "mouth")):
        e = sorted([hints["e1"], hints["e2"]], key=lambda p: p[0])
        eyes = [box_of(near(p, "eye"), p, "eye") for p in e]
        mouth = box_of(near(hints["mouth"], "mouth"), hints["mouth"], "mouth")
        notes.append("用的是老师点的位置")
    else:
        # 两只眼睛：深色的、左右对称、差不多一样大、在脸的中间偏上；腮红（不深、偏红）不算；
        # 深色的有两对（眉毛 + 眼睛）就要靠下的那对
        pairs = []
        for a in comps:
            for b in comps:
                if a["cx"] >= fcx or b["cx"] <= fcx:
                    continue
                if a["dark"] < 0.3 or b["dark"] < 0.3:
                    continue
                if abs(a["cy"] - b["cy"]) > fh * 0.08 or not (0.4 < a["a"] / b["a"] < 2.5):
                    continue
                sep = (b["cx"] - a["cx"]) / fw
                if not (0.18 < sep < 0.8):
                    continue
                cy = (a["cy"] + b["cy"]) / 2
                if not (fy0 + fh * 0.15 < cy < fy0 + fh * 0.75):
                    continue
                sym = abs((a["cx"] + b["cx"]) / 2 - fcx) / fw
                if sym > 0.12:
                    continue
                pairs.append((cy, sym, a, b))
        if pairs:
            pairs.sort(key=lambda t: -t[0])
            low = pairs[0]
            # 最靠下那对如果又细又小、上面还有一对更大的，那下面这对多半是别的（比如双眼皮线、睫毛），要大的
            _, _, a, b = low
            for cy, sym, a2, b2 in pairs[1:]:
                if abs(cy - low[0]) < fh * 0.12 and a2["a"] + b2["a"] > 1.6 * (a["a"] + b["a"]):
                    a, b = a2, b2
                    break
            eyes = [box_of(a), box_of(b)]
            ey = (a["cy"] + b["cy"]) / 2
            ms = [q for q in comps if ey + fh * 0.07 < q["cy"] < ey + fh * 0.5 and abs(q["cx"] - fcx) < fw * 0.16 and q not in (a, b) and (q["dark"] > 0.2 or q["red"] > 12)]
            if ms:
                q = max(ms, key=lambda q: q["a"] * (1 + max(0, q["red"]) / 20) / (1 + abs(q["cy"] - (ey + fh * 0.25)) / fh * 4))
                mouth = box_of(q, kind="mouth")
            else:
                notes.append("没找到嘴，按比例放的")
                mouth = box_of(None, [fcx, ey + fh * 0.28], "mouth")
        else:
            notes.append("没找到眼睛，按比例放的（可以在照片上点一下纠正）")
            ey = fy0 + fh * 0.52
            eyes = [box_of(None, [fcx - fw * 0.2, ey], "eye"), box_of(None, [fcx + fw * 0.2, ey], "eye")]
            mouth = box_of(None, [fcx, ey + fh * 0.28], "mouth")
    return {"face": [int(fx0), int(fy0), int(fx1), int(fy1)], "eyes": eyes, "mouth": mouth, "skin_lab": skin_lab, "skin_mask": skin, "filled": filled, "notes": notes, "size": [W, H]}


def _rgb_hex(c):
    c = np.clip(np.asarray(c, np.float64), 0, 255).astype(int)
    return "#%02x%02x%02x" % tuple(c[:3])


def _sprite(rgb, box, m, feather):
    """抠一块：框里的颜色 + 透明边（有 mask 就按形状，没有就是椭圆）"""
    x0, y0, x1, y1 = box
    crop = rgb[y0: y1 + 1, x0: x1 + 1].astype(np.uint8)
    h, w = crop.shape[:2]
    if m is not None:
        a = m[y0: y1 + 1, x0: x1 + 1].astype(np.float64)
        a = ndimage.binary_fill_holes(a > 0).astype(np.float64)
        a = ndimage.binary_dilation(a > 0, iterations=max(1, int(feather))).astype(np.float64)
    else:
        yy, xx = np.mgrid[0:h, 0:w]
        a = ((((xx - (w - 1) / 2) / (w / 2)) ** 2 + ((yy - (h - 1) / 2) / (h / 2)) ** 2) < 0.85).astype(np.float64)
    a = ndimage.gaussian_filter(a, max(0.6, feather * 0.6))
    rgba = np.dstack([crop, (np.clip(a, 0, 1) * 255).astype(np.uint8)])
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"), crop, a


def uv_raster(mesh, tw, th, faces):
    """在贴图空间里光栅化（tw×th 的贴图）：每个贴图像素落在哪个三角形、重心坐标"""
    uvpos = np.stack([mesh.uv[:, 0] * tw, -mesh.uv[:, 1] * th, np.zeros(len(mesh.uv))], 1)
    return raster(uvpos, mesh.idx, (0.0, float(tw), -float(th), 0.0), 1.0, "front", faces=faces)


def build(mesh, textures, joints, top, hints=None, px=900):
    """找眼睛和嘴、改贴图、做抠图。返回 (meta, 新贴图列表, 头部正面照（画了框，给老师看）)"""
    R, rgb, m = head_shot(mesh, textures, joints, top, px)
    D = detect(rgb, m, hints)
    H, W = m.shape
    fx0, fy0, fx1, fy1 = D["face"]
    fw = fx1 - fx0 + 1
    feather = max(1.0, fw * 0.006)
    meta = {"eyes": [], "notes": D["notes"]}
    paint = np.zeros((H, W), bool)   # 要从贴图上抹掉的地方（正面照里的像素）

    def to_model_box(b):
        X0, Y1 = to_model(R, b[0] - 0.5, b[1] - 0.5)
        X1, Y0 = to_model(R, b[2] + 0.5, b[3] + 0.5)
        return [float(X0), float(Y0), float(X1), float(Y1)]

    for b, mk in D["eyes"]:
        uri, crop, a = _sprite(rgb, b, mk, feather)
        x0, y0, x1, y1 = b
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if mk is not None:
            ys, xs = np.nonzero(mk[y0: y1 + 1, x0: x1 + 1])
            closed = (ys.max() - ys.min() + 1) / max(xs.max() - xs.min() + 1, 1) < 0.34 if len(ys) else False
            lum = crop[..., :3].mean(2)
            sel = (a > 0.5) & (lum <= np.percentile(lum[a > 0.5], 15)) if (a > 0.5).any() else np.ones(lum.shape, bool)
            dark = crop[sel].mean(0) if sel.any() else crop.reshape(-1, 3).min(0)
        else:
            closed, dark = False, crop.reshape(-1, 3).min(0)
        region = np.zeros((H, W), bool)
        region[y0: y1 + 1, x0: x1 + 1] = (a > 0.08)
        paint |= region
        meta["eyes"].append({"box": to_model_box(b), "px": [int(v) for v in b], "closed": bool(closed), "color": _rgb_hex(dark), "sprite": uri})
    b, mk = D["mouth"]
    uri, crop, a = _sprite(rgb, b, mk, feather)
    region = np.zeros((H, W), bool)
    region[b[1]: b[3] + 1, b[0]: b[2] + 1] = (a > 0.08)
    paint |= region
    sel = a > 0.5
    lip = crop[sel].mean(0) if sel.any() else np.array([150, 60, 60])
    meta["mouth"] = {"box": to_model_box(b), "px": [int(v) for v in b], "color": _rgb_hex(lip), "sprite": uri}
    skin_rgb = cv2.cvtColor(np.uint8([[np.clip(D["skin_lab"], 0, 255)]]), cv2.COLOR_LAB2RGB)[0, 0]
    meta["skin"] = _rgb_hex(skin_rgb)
    meta["face"] = to_model_box([fx0, fy0, fx1, fy1])
    # 脸的正面最靠前的 z（画布贴在这层皮上）
    inface = (R["fid"] >= 0) & D["filled"]
    meta["frontZ"] = float(R["depth"][inface].max()) if inface.any() else 0.2
    # 改贴图：先在正面照上把眼睛和嘴补成皮肤（clean），贴图上每个像素算出它在 3D 里的位置、落在正面照的哪儿，
    # 落在要抹掉的地方就换成 clean 上那个点的颜色（边上软一点，和原来的过渡）
    paint = ndimage.binary_dilation(paint, iterations=max(2, int(fw * 0.012)))
    pm = paint.astype(np.uint8) * 255
    clean = cv2.inpaint(np.ascontiguousarray(rgb), pm, max(3, int(fw * 0.02)), cv2.INPAINT_TELEA)
    sm = cv2.GaussianBlur(clean, (0, 0), max(1.5, fw * 0.01))
    clean = np.where(paint[..., None], sm, clean)
    soft = cv2.GaussianBlur(paint.astype(np.float32), (0, 0), max(1.0, fw * 0.006))
    soft = np.clip(soft * 1.6, 0, 1)
    paint = soft > 0.02
    new_tex = list(textures)
    vis = np.unique(R["fid"][R["fid"] >= 0])
    if mesh.uv is not None:
        fn = mesh.face_normals()
        front = vis[fn[vis, 2] > 0.05]
        for mi, tex in enumerate(textures):
            if tex is None:
                continue
            fs = front[mesh.fmat[front] == mi]
            if len(fs) == 0:
                continue
            th, tw = tex.shape[:2]
            U = uv_raster(mesh, tw, th, fs)
            fid, bary = U["fid"][:th, :tw], U["bary"][:th, :tw]
            ok = fid >= 0
            if not ok.any():
                continue
            tri = mesh.idx[fid[ok]]
            p3 = (mesh.pos[tri] * bary[ok][:, :, None]).sum(1)
            pp = np.rint(to_pixel(R, p3)).astype(int)
            inside = (pp[:, 0] >= 0) & (pp[:, 0] < W) & (pp[:, 1] >= 0) & (pp[:, 1] < H)
            hit = np.zeros(len(pp), bool)
            hit[inside] = paint[pp[inside, 1], pp[inside, 0]]
            # 只改正面看得见的那层皮（深度和正面照里的一致）
            dep = np.full(len(pp), -np.inf)
            dep[inside] = R["depth"][pp[inside, 1], pp[inside, 0]]
            hit &= p3[:, 2] > dep - 0.01
            ty, tx = np.nonzero(ok)
            # 补的颜色从「补好的正面照」上取（正面照里空间是连着的，补出来是一片匀匀的皮肤；直接在贴图上补会把别处的颜色拉过来）
            src = pp[hit]
            col = clean[np.clip(src[:, 1], 0, H - 1), np.clip(src[:, 0], 0, W - 1)].astype(np.float32)
            wgt = soft[np.clip(src[:, 1], 0, H - 1), np.clip(src[:, 0], 0, W - 1)]
            nt = tex.copy()
            old = nt[ty[hit], tx[hit], :3].astype(np.float32)
            nt[ty[hit], tx[hit], :3] = np.clip(old * (1 - wgt[:, None]) + col * wgt[:, None], 0, 255).astype(np.uint8)
            # 三角形之间的缝（不属于任何三角形的贴图像素）也跟着改，不然放大缩小采样时会把原来的眼睛「渗」出来一圈
            allf = np.nonzero(mesh.fmat == mi)[0]
            cover = uv_raster(mesh, tw, th, allf)["fid"][:th, :tw] >= 0
            ch = np.zeros((th, tw), bool)
            ch[ty[hit], tx[hit]] = True
            ring = ndimage.binary_dilation(ch, iterations=3) & ~cover
            if ring.any():
                _, (iy, ix) = ndimage.distance_transform_edt(~ch, return_indices=True)
                ry, rx = np.nonzero(ring)
                nt[ry, rx, :3] = nt[iy[ry, rx], ix[ry, rx], :3]
            new_tex[mi] = nt
    # 给老师看的图：画上找到的框
    prev = rgb.copy()
    for b, _ in D["eyes"]:
        cv2.rectangle(prev, (b[0], b[1]), (b[2], b[3]), (34, 211, 238), max(1, W // 300))
    b = D["mouth"][0]
    cv2.rectangle(prev, (b[0], b[1]), (b[2], b[3]), (244, 63, 94), max(1, W // 300))
    meta["shot"] = {"size": [W, H], "box": [float(v) for v in R["box"]], "res": float(R["res"])}
    return meta, new_tex, rgb, prev
