# 捞捞 · 3D 形象工坊 第 2 步：公仔立绘 → 带贴图的 3D 模型（要显卡）
#   模型：腾讯开源的 Hunyuan3D-2（先长出造型，再按图上色）。
#   用 Hunyuan3D-2GP / Hunyuan3D-2 WinPortable 整合包里的 hy3dgen（带 mmgp 省显存：12G 显存造型、上色都能跑）。
#   「最好」：完整的 dit-v2-0、50 步、八叉树 384（细节多）、保留 6 万个面；「快」：turbo 版、5 步、256。
import os
import sys

from .util import say, log, use_mirror, gpu_info, ram_gb, free_gpu


def _patch_device(instance, name, getter):
    """mmgp 把模型放内存里时，告诉流水线「算的地方还是 cuda」（和 Hunyuan3D-2GP 的 gradio_app 一样的做法）"""
    cls = type(instance)
    prop = getattr(cls, name)
    custom = type("Custom" + cls.__name__, (cls,), {})
    setattr(custom, name, property(getter, prop.fset))
    instance.__class__ = custom


def find_hy3dgen(root):
    """在整合包文件夹里找 hy3dgen 所在的那层（Hunyuan3D-2GP、WinPortable 的几种摆法都认）"""
    if not root:
        return None
    cands = [root] + [os.path.join(root, d) for d in ("Hunyuan3D-2", "Hunyuan3D-2GP", "Hunyuan3D2", "hunyuan3d-2")]
    try:
        cands += [os.path.join(root, d) for d in sorted(os.listdir(root))]
    except OSError:
        pass
    for c in cands:
        if os.path.isfile(os.path.join(c, "hy3dgen", "shapegen", "__init__.py")):
            return c
    return None


def run(image, out_glb, hy_root, quality="best", seed=1234, profile=None, cands=1):
    """cands > 1：用不同的随机种子做几个，每个都自己查一遍硬伤（lao3d/qc.py：断成几块、破洞、左右歪、比例），留最好的那个"""
    use_mirror()
    root = find_hy3dgen(hy_root)
    if not root:
        raise RuntimeError("没找到 Hunyuan3D-2 的代码（hy3dgen 文件夹）。请选 Hunyuan3D-2GP 或 Hunyuan3D-2 WinPortable 整合包解压出来的文件夹")
    sys.path.insert(0, root)
    os.environ.setdefault("HY3DGEN_MODELS", os.path.join(os.path.expanduser("~"), ".cache", "hy3dgen"))
    import torch
    from PIL import Image
    g, ram = gpu_info(), ram_gb()
    if not g.get("cuda"):
        raise RuntimeError("没找到 NVIDIA 显卡（或者装的 PyTorch 不带 CUDA），这一步要显卡")
    log("显卡", g, "内存", ram, "G")
    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FaceReducer, FloaterRemover, DegenerateFaceRemover
    from hy3dgen.shapegen.pipelines import export_to_trimesh
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    best = quality != "fast"
    say(stage="to3d", p=0.02, msg="去掉背景")
    img = Image.open(image)
    if img.mode != "RGBA" or img.getextrema()[3][0] == 255:
        img = BackgroundRemover()(img.convert("RGB"))
    img.save(os.path.join(os.path.dirname(out_glb) or ".", "input_rgba.png"))

    say(stage="to3d", p=0.05, msg="准备造型模型（第一次要下载约 5G）")
    sub = "hunyuan3d-dit-v2-0" if best else "hunyuan3d-dit-v2-0-turbo"
    shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2", subfolder=sub, use_safetensors=True, device="cuda")
    if not best:
        shape.enable_flashvdm(mc_algo="mc")
    say(stage="to3d", p=0.1, msg="准备上色模型（第一次要下载约 7G）")
    tex = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
    try:
        from mmgp import offload
        _patch_device(shape, "_execution_device", lambda self: "cuda")
        pipe = offload.extract_models("i23d_worker", shape)
        pipe.update(offload.extract_models("texgen_worker", tex))
        tex.models["multiview_model"].pipeline.vae.use_slicing = True
        prof = profile or (3 if ram >= 32 else 4)   # 3：内存够；4：内存小（16G）
        kw = {}
        if prof < 5:
            kw["pinnedMemory"] = "i23d_worker/model"
        if prof not in (1, 3):
            kw["budgets"] = {"*": 2200}
        offload.profile(pipe, profile_no=prof, verboseLevel=1, **kw)
        log("mmgp 省显存：profile", prof)
    except ImportError:
        log("没装 mmgp：用原版（上色要 16G 以上显存，12G 可能不够）")
        if hasattr(tex, "enable_model_cpu_offload"):
            tex.enable_model_cpu_offload()

    cands = max(1, min(4, int(cands or 1)))
    outs = []
    for c in range(cands):
        one = out_glb if cands == 1 else out_glb[:-4] + "-c%d.glb" % c
        lo, hi = c / float(cands), (c + 1) / float(cands)
        P = lambda x: round(lo + (hi - lo) * x, 3)
        _one(shape, tex, img, one, int(seed) + c * 7919, best, P, torch, export_to_trimesh, FloaterRemover, DegenerateFaceRemover, FaceReducer, free_gpu, "（第 %d/%d 个）" % (c + 1, cands) if cands > 1 else "")
        outs.append(one)
    if cands == 1:
        say(stage="to3d", p=1.0, msg="3D 模型做好了")
        return out_glb
    from .qc import rank
    ranked = rank(outs)
    for k, (f, r) in enumerate(ranked):
        log("候选", k + 1, os.path.basename(f), "分数", r["score"], "；".join(r["problems"]) or "没有硬伤")
    import shutil
    shutil.copy(ranked[0][0], out_glb)
    good = sum(1 for _, r in ranked if r["ok"])
    say(stage="to3d", p=1.0, msg="做了 %d 个，%d 个没有硬伤，留了最好的那个" % (cands, good), qc=[{"file": os.path.basename(f), **r} for f, r in ranked])
    return out_glb


def _one(shape, tex, img, out_glb, seed, best, P, torch, export_to_trimesh, FloaterRemover, DegenerateFaceRemover, FaceReducer, free_gpu, tag=""):
    """用一个随机种子做一个：长出造型 → 整理网格 → 上色"""
    say(stage="to3d", p=P(0.15), msg="长出造型" + tag + ("（50 步，细节最多）" if best else ""))
    steps = 50 if best else 5
    gen = torch.Generator().manual_seed(int(seed))

    def cb(*a, **k):
        try:
            step = int(a[0]) if a else 0   # hy3dgen 调的是 callback(第几步, t, outputs)
            say(stage="to3d", p=P(round(0.15 + 0.35 * (step + 1) / steps, 3)), msg=f"长出造型{tag}：{step + 1}/{steps} 步")
        except Exception:
            pass
    kw = dict(image=img, num_inference_steps=steps, guidance_scale=7.5 if best else 5.0, generator=gen, octree_resolution=384 if best else 256, num_chunks=100000, output_type="mesh")
    try:
        out = shape(callback=cb, callback_steps=1, **kw)
    except TypeError:
        out = shape(**kw)
    mesh = export_to_trimesh(out)[0]
    say(stage="to3d", p=P(0.52), msg="整理网格（去掉碎片、减面）" + tag)
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=60000 if best else 40000)
    mesh.export(os.path.join(os.path.dirname(out_glb) or ".", "shape.glb"))
    free_gpu()
    say(stage="to3d", p=P(0.58), msg="上色：从几个角度画贴图（要几分钟）" + tag)
    textured = tex(mesh, image=img)
    textured.export(out_glb)
    return out_glb
