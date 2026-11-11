# 测试用的「假装是生成出来的」公仔：几个球和圆柱拼起来（大头、身子、两条分开的胳膊和腿），
# 一张贴图：头上画了头发、两只眼睛、嘴，其余是纯色。只用 numpy / PIL，不要显卡。
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from lao3d.glb import Mesh, write_glb, encode_image  # noqa: E402

TEX = 512
HEAD_C, HEAD_R = np.array([0.0, 0.95, 0.0]), 0.2
EYE_PHI, EYE_TH, MOUTH_TH = 0.38, 1.62, 1.95
PATCH = {"top": (0, 0), "pants": (1, 0), "skin": (2, 0), "shoe": (3, 0)}   # 下半张图上的纯色块（8×2 格）
COLORS = {"top": (232, 236, 245), "pants": (60, 74, 120), "skin": (246, 205, 180), "shoe": (40, 40, 48)}


def _patch_uv(name):
    i, j = PATCH[name]
    return np.array([(i + 0.5) / 8, 0.5 + (j + 0.5) / 4 * 0.5])


def uv_sphere(c, r, nu=48, nv=32, head=False, patch="skin", sy=1.0):
    th = np.linspace(0, np.pi, nv + 1)
    ph = np.linspace(-np.pi, np.pi, nu + 1)
    T, Ph = np.meshgrid(th, ph, indexing="ij")
    pos = np.stack([r * np.sin(T) * np.sin(Ph), r * np.cos(T) * sy, r * np.sin(T) * np.cos(Ph)], -1).reshape(-1, 3) + c
    if head:   # 头：经纬度展开到贴图左上角四分之一
        uv = np.stack([(Ph / (2 * np.pi) + 0.5) * 0.5, T / np.pi * 0.5], -1).reshape(-1, 2)
    else:
        uv = np.tile(_patch_uv(patch), (len(pos), 1))
    idx = []
    W = nu + 1
    for i in range(nv):
        for j in range(nu):
            a, b, c2, d = i * W + j, i * W + j + 1, (i + 1) * W + j, (i + 1) * W + j + 1
            idx += [[a, c2, b], [b, c2, d]]
    return pos, uv, np.array(idx)


def cylinder(a, b, r, patch, n=32):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ax = b - a
    L = np.linalg.norm(ax)
    ax /= L
    t = np.cross(ax, [0, 0, 1.0]) if abs(ax[2]) < 0.9 else np.cross(ax, [1.0, 0, 0])
    t /= np.linalg.norm(t)
    u = np.cross(ax, t)
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ring = np.cos(ang)[:, None] * t + np.sin(ang)[:, None] * u
    pos = np.concatenate([a + r * ring, b + r * ring, [a, b]])
    idx = []
    for k in range(n):
        k2 = (k + 1) % n
        idx += [[k, k2, n + k], [k2, n + k2, n + k], [2 * n, k2, k], [2 * n + 1, n + k, n + k2]]
    idx = np.array(idx)
    # 让面朝外：看第一个侧面三角形的法线是不是背着轴
    p0, p1, p2 = pos[idx[0]]
    if np.dot(np.cross(p1 - p0, p2 - p0), (p0 + p1 + p2) / 3 - (a + b) / 2 - ax * np.dot((p0 + p1 + p2) / 3 - (a + b) / 2, ax)) < 0:
        idx = idx[:, ::-1]
    return pos, np.tile(_patch_uv(patch), (len(pos), 1)), idx


def texture():
    im = Image.new("RGB", (TEX, TEX), COLORS["skin"])
    d = ImageDraw.Draw(im)
    for name, (i, j) in PATCH.items():
        x0, y0 = i * TEX // 8, TEX // 2 + j * TEX // 8
        d.rectangle([x0, y0, x0 + TEX // 8, y0 + TEX // 8], fill=COLORS[name])
    H = TEX // 2   # 头的那一块：u ∈ [0, .5]，v ∈ [0, .5]
    U = lambda ph: (ph / (2 * np.pi) + 0.5) * H
    V = lambda th: th / np.pi * H
    hair = (35, 28, 30)
    d.rectangle([0, 0, H, V(0.95)], fill=hair)                            # 头顶
    d.rectangle([0, 0, U(-2.0), H], fill=hair)                            # 后脑勺
    d.rectangle([U(2.0), 0, H, H], fill=hair)
    for s in (-1, 1):   # 眼睛：深色的椭圆，中间一点高光；眉毛
        cx, cy = U(s * EYE_PHI), V(EYE_TH)
        d.ellipse([cx - 7, cy - 9, cx + 7, cy + 9], fill=(30, 22, 20))
        d.ellipse([cx - 3, cy - 6, cx + 1, cy - 2], fill=(255, 255, 255))
        d.line([cx - 9, V(1.38), cx + 9, V(1.38)], fill=(40, 30, 28), width=3)
    cx, cy = U(0), V(MOUTH_TH)
    d.ellipse([cx - 9, cy - 3, cx + 9, cy + 4], fill=(150, 50, 60))      # 嘴
    return im


def make(path=None, turned=False, scale=2.0, offset=(0.1, -0.3, 0.05), legs_together=False):
    parts = [uv_sphere(HEAD_C, HEAD_R, head=True),
             cylinder([0, 0.42, 0], [0, 0.76, 0], 0.15, "top"),
             uv_sphere([0, 0.42, 0], 0.15, patch="top", sy=0.5),
             uv_sphere([0, 0.76, 0], 0.15, patch="top", sy=0.4),
             cylinder([0, 0.74, 0], [0, 0.82, 0], 0.05, "skin")]
    lx = 0.045 if legs_together else 0.07   # 并在一起的腿（裤腿、鞋都贴着）
    for s in (-1, 1):
        parts += [cylinder([s * 0.16, 0.73, 0], [s * 0.30, 0.44, 0], 0.045, "top"),
                  uv_sphere([s * 0.31, 0.41, 0], 0.05, patch="skin"),
                  cylinder([s * lx, 0.48, 0], [s * lx, 0.06, 0], 0.055, "pants"),
                  uv_sphere([s * lx, 0.045, 0.03], 0.06, patch="shoe", sy=0.7)]
    P, U, I, n = [], [], [], 0
    for p, u, i in parts:
        P.append(p); U.append(u); I.append(i + n); n += len(p)
    pos = np.concatenate(P)
    if turned:
        pos = pos * np.array([-1, 1, -1])
    pos = pos * scale + np.array(offset)
    mesh = Mesh(pos, np.concatenate(I), uv=np.concatenate(U), materials=[{"color": [1, 1, 1, 1], "image": encode_image(texture(), "image/png"), "mime": "image/png"}])
    return write_glb(path, mesh) if path else mesh


# 期望的关节（没摆正之前的坐标；摆正后乘 1.25 / 身高）
EXPECT = {"neck_y": 0.80, "shoulder": (0.16, 0.73), "wrist_y": 0.50, "eye": (np.sin(EYE_PHI) * np.sin(EYE_TH) * HEAD_R, HEAD_C[1] + np.cos(EYE_TH) * HEAD_R), "mouth_y": HEAD_C[1] + np.cos(MOUTH_TH) * HEAD_R, "height": 1.15}
