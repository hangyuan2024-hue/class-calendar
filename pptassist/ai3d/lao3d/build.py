# 捞捞 · 3D 形象工坊 第 3 步（不用显卡）：生成的模型 → 摆正、绑骨骼、让脸会动 → 捞捞PPT助手能用的 avatar.glb
import io
import json
import os

import numpy as np
from PIL import Image

from . import face as facemod
from .glb import read_glb, read_extras, write_glb, encode_image
from .raster import load_textures
from .smooth import smooth_mesh
from .rig import normalize, facing, turn_around, rig, H_TARGET
from .util import say


def _save_png(arr, path):
    Image.fromarray(arr).save(path)


def _textures_to_materials(mesh, textures, changed):
    for mi, t in enumerate(textures):
        if t is None or not changed[mi]:
            continue
        mesh.materials[mi]["image"] = encode_image(Image.fromarray(t[..., :3]), "image/jpeg", 92)
        mesh.materials[mi]["mime"] = "image/jpeg"


def build(src, out_dir, hints=None, smooth=1.0):
    """src：生成出来的带贴图模型（.glb）。在 out_dir 里写：base.glb + base.npz（绑好骨骼、原贴图，改脸时用）、avatar.glb（最终的）、face_shot.png / face_marked.png"""
    os.makedirs(out_dir, exist_ok=True)
    say(stage="rig", p=0.03, msg="读模型、摆正")
    mesh = read_glb(src)
    if mesh.uv is None:
        raise ValueError("模型没有贴图坐标（UV），像是只生成了造型、没上色")
    textures = load_textures(mesh)
    norm = normalize(mesh)
    f, b = facing(mesh, textures)
    turned = b > f * 1.2 + 0.02
    if turned:
        turn_around(mesh)
    say(stage="rig", p=0.08, msg="磨皮：把表面的小台阶、褶皱磨平")
    r0, r1, n = smooth_mesh(mesh, smooth)
    say(stage="rig", p=0.1, msg=f"磨了 {n} 遍，表面不平度 {r0:.1f}° → {r1:.1f}°")
    say(stage="rig", p=0.12, msg="找关节（腿、裆部、胳膊、脖子）、算每块皮跟哪根骨头动")
    R = rig(mesh)
    for w in R["warn"]:
        say(stage="rig", p=0.6, msg="注意：" + w, warn=w)
    # 存一份「绑好骨骼、还没改脸」的，之后老师纠正眼睛和嘴的位置时从这里重新做脸
    base_meta = {"lao": {"v": 1, "height": H_TARGET, "joints": R["joints"], "extra": R["extra"], "landmarks": R["landmarks"], "warn": R["warn"], "turned": bool(turned), "norm": norm, "facing": [f, b]}}
    write_glb(os.path.join(out_dir, "base.glb"), mesh, skin=R, extras=base_meta)
    np.savez_compressed(os.path.join(out_dir, "base.npz"), jidx=R["jidx"], w=R["w"])
    return face(out_dir, hints)


def face(out_dir, hints=None):
    """从 base.glb 做脸（找眼睛和嘴、改贴图、抠图），写 avatar.glb"""
    say(stage="face", p=0.7, msg="找眼睛和嘴，让它们会眨、会说话")
    base = os.path.join(out_dir, "base.glb")
    mesh = read_glb(base)
    ex, _ = read_extras(base)
    lao = ex["lao"]
    z = np.load(os.path.join(out_dir, "base.npz"))
    textures = load_textures(mesh)
    J = {j["name"]: np.array(j["pos"]) for j in lao["joints"]}
    J.update({k: np.array(v) for k, v in lao["extra"].items()})
    meta, new_tex, shot, marked = facemod.build(mesh, textures, J, lao["landmarks"]["top"], hints=hints)
    _save_png(shot, os.path.join(out_dir, "face_shot.png"))
    _save_png(marked, os.path.join(out_dir, "face_marked.png"))
    changed = [nt is not t for nt, t in zip(new_tex, textures)]
    _textures_to_materials(mesh, new_tex, changed)
    for n in meta.get("notes", []):
        say(stage="face", p=0.9, msg=n)
    lao = dict(lao)
    lao["face"] = meta
    skin = {"joints": lao["joints"], "jidx": z["jidx"], "w": z["w"]}
    out = os.path.join(out_dir, "avatar.glb")
    write_glb(out, mesh, skin=skin, extras={"lao": lao})
    say(stage="face", p=1.0, msg="形象做好了", done=True, file=out, size=os.path.getsize(out), warn=lao.get("warn", []), notes=meta.get("notes", []))
    return out
