# 捞捞 · 3D 形象工坊：命令行入口（捞捞PPT助手用整合包里的 Python 调它）
#   python -m lao3d.run check  [--hy 整合包]                         看环境：显卡、内存、装了哪些
#   python -m lao3d.run setup  [--hy 整合包]                         装缺的组件（国内自动用清华 pip 源、hf-mirror）
#   python -m lao3d.run stylize --photo 照片 [--style 参考图] --out 文件夹 [--n 3] [--quality best|fast] [--clothes photo|style]
#   python -m lao3d.run to3d   --image 立绘 --out raw.glb --hy 整合包 [--quality best|fast] [--seed 1234]
#   python -m lao3d.run build  --src raw.glb --out 文件夹 [--smooth 1]    磨皮 + 绑骨骼 + 做脸（不用显卡）
#   python -m lao3d.run face   --out 文件夹 --hints '{"e1":[x,y],"e2":[x,y],"mouth":[x,y]}'   重新做脸
#   python -m lao3d.run talk-check / talk-setup --hy 整合包                  真人数字人（口型同步）的组件
#   python -m lao3d.run talk   --hy 整合包 --template 模板.mp4 --audio 配音.wav --out 出来.mp4 [--quality best|fast]
import argparse
import json
import os
import platform
import subprocess
import sys
import traceback

from .util import say, log, gpu_info, ram_gb, reachable, use_mirror

NUNCHAKU_VER = "1.0.1"


def _has(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def check(hy):
    from .to3d import find_hy3dgen
    info = {"python": platform.python_version(), "exe": sys.executable, "platform": sys.platform, "ram": ram_gb(), "gpu": gpu_info(), "hy3dgen": find_hy3dgen(hy)}
    for m in ("numpy", "scipy", "cv2", "PIL", "torch", "diffusers", "transformers", "accelerate", "nunchaku", "bitsandbytes", "mmgp", "trimesh", "huggingface_hub"):
        info[m] = _has(m)
    try:
        import diffusers
        info["diffusers_ver"] = diffusers.__version__
        info["qwen_edit_plus"] = hasattr(diffusers, "QwenImageEditPlusPipeline")
    except Exception:
        info["qwen_edit_plus"] = False
    need = []
    if not all(info[m] for m in ("numpy", "scipy", "cv2", "PIL")):
        need.append("基础组件（numpy、scipy、opencv）")
    if not info["qwen_edit_plus"] or not info["nunchaku"]:
        need.append("画立绘的组件（diffusers 新版、nunchaku）")
    if not info["hy3dgen"]:
        need.append("Hunyuan3D-2 的代码（选对整合包文件夹）")
    if not info["mmgp"]:
        need.append("省显存组件 mmgp")
    info["need"] = need
    info["ok_build"] = all(info[m] for m in ("numpy", "scipy", "cv2", "PIL"))
    info["ok_stylize"] = info["gpu"].get("cuda") and info["qwen_edit_plus"] and info["nunchaku"]
    info["ok_to3d"] = bool(info["gpu"].get("cuda") and info["hy3dgen"] and info["torch"])
    say(stage="check", p=1.0, msg="环境检查完了", done=True, info=info)
    return info


def _pip(args, index):
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check"] + (["-i", index] if index else []) + args
    log(" ".join(cmd))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        raise RuntimeError("安装失败：" + " ".join(args))


def setup(hy):
    index = None if reachable("https://pypi.org/simple/") else "https://pypi.tuna.tsinghua.edu.cn/simple"
    use_mirror()
    steps = [("基础组件", ["numpy", "scipy", "opencv-python", "pillow"], lambda: all(_has(m) for m in ("numpy", "scipy", "cv2", "PIL"))),
             ("diffusers 新版（画立绘用）", ["diffusers>=0.36", "accelerate", "huggingface_hub", "transformers>=4.49"], lambda: _has("diffusers") and hasattr(__import__("diffusers"), "QwenImageEditPlusPipeline")),
             ("4bit 读图（内存小时用）", ["bitsandbytes"], lambda: _has("bitsandbytes")),
             ("省显存组件 mmgp", ["mmgp==3.2.7"], lambda: _has("mmgp"))]
    for i, (name, pkgs, ok) in enumerate(steps):
        say(stage="setup", p=round(i / (len(steps) + 1), 2), msg="检查" + name)
        if not ok():
            say(stage="setup", p=round(i / (len(steps) + 1), 2), msg="安装" + name)
            _pip(pkgs, index)
    if not _has("nunchaku"):
        say(stage="setup", p=0.85, msg="安装 nunchaku（4bit 画图引擎）")
        import torch
        tv = ".".join(torch.__version__.split("+")[0].split(".")[:2])
        py = f"cp{sys.version_info.major}{sys.version_info.minor}"
        plat = "win_amd64" if sys.platform == "win32" else "linux_x86_64"
        whl = f"nunchaku-{NUNCHAKU_VER}+torch{tv}-{py}-{py}-{plat}.whl"
        from huggingface_hub import hf_hub_download
        try:
            f = hf_hub_download("nunchaku-tech/nunchaku", whl)
        except Exception as e:
            raise RuntimeError(f"没下到 {whl}（你的 PyTorch {tv}、Python {py} 可能还没有对应的版本）：{e}")
        _pip([f], index)
    say(stage="setup", p=1.0, msg="组件都装好了", done=True)
    return check(hy)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lao3d")
    ap.add_argument("cmd", choices=["check", "setup", "stylize", "to3d", "build", "face", "talk-check", "talk-setup", "talk"])
    ap.add_argument("--hy")
    ap.add_argument("--photo")
    ap.add_argument("--extra", help="老师的侧面 / 背面（视频里挑出来的），逗号隔开，画立绘时一起参考发型")
    ap.add_argument("--template")
    ap.add_argument("--audio")
    ap.add_argument("--style")
    ap.add_argument("--image")
    ap.add_argument("--src")
    ap.add_argument("--out")
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--quality", default="best", choices=["best", "fast"])
    ap.add_argument("--clothes", default="photo", choices=["photo", "style"])
    ap.add_argument("--seed", type=int)
    ap.add_argument("--hints")
    ap.add_argument("--smooth", type=float, default=1.0, help="磨皮力度：1 = 默认，2 = 磨得更狠，0 = 不磨")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "check":
            check(a.hy)
        elif a.cmd == "setup":
            setup(a.hy)
        elif a.cmd == "stylize" and os.environ.get("LAO3D_TEST_CANDS"):   # 测试用：没有显卡时拿现成的图当画好的
            import glob
            import shutil
            os.makedirs(a.out, exist_ok=True)
            outs = []
            for i, f in enumerate(sorted(glob.glob(os.path.join(os.environ["LAO3D_TEST_CANDS"], "*.png")))[: a.n]):
                g = os.path.join(a.out, f"cand_{i + 1}.png")
                shutil.copy(f, g)
                outs.append({"file": g, "seed": i})
                say(stage="stylize", p=round((i + 1) / a.n, 2), msg=f"第 {i + 1} 张画好了（测试）", cand=g)
            say(stage="stylize", p=1.0, msg="立绘画好了，挑一张", done=True, cands=outs)
        elif a.cmd == "to3d" and os.environ.get("LAO3D_TEST_RAW"):   # 测试用：拿现成的模型当生成的
            import shutil
            shutil.copy(os.environ["LAO3D_TEST_RAW"], a.out)
            say(stage="to3d", p=1.0, msg="3D 模型做好了（测试）", done=True, file=a.out)
        elif a.cmd == "stylize":
            from .stylize import run
            extra = [f for f in (a.extra or "").split(",") if f and os.path.exists(f)]
            outs = run(a.photo, a.style, a.out, n=a.n, quality=a.quality, clothes=a.clothes, seed=a.seed, extra=extra)
            say(stage="stylize", p=1.0, msg="立绘画好了，挑一张", done=True, cands=outs)
        elif a.cmd == "to3d":
            from .to3d import run
            f = run(a.image, a.out, a.hy, quality=a.quality, seed=1234 if a.seed is None else a.seed)
            say(stage="to3d", p=1.0, msg="3D 模型做好了", done=True, file=f)
        elif a.cmd == "build":
            from .build import build
            build(a.src, a.out, json.loads(a.hints) if a.hints else None, smooth=a.smooth)
        elif a.cmd == "face":
            from .build import face
            face(a.out, json.loads(a.hints) if a.hints else None)
        elif a.cmd == "talk-check":
            from .talk import check as tcheck
            say(stage="talk-check", p=1.0, msg="检查完了", done=True, info=tcheck(a.hy))
        elif a.cmd == "talk-setup":
            from .talk import setup as tsetup
            tsetup(a.hy)
        elif a.cmd == "talk" and os.environ.get("LAO3D_TEST_TALK"):   # 测试用：没有显卡时把模板接到配音那么长当做好的
            from .talk import read_frames, read_wav, write_frames, pingpong, SR, FPS
            tf = read_frames(a.template)
            n = int(len(read_wav(a.audio)) / SR * FPS) + 1
            write_frames(a.out, [tf[k] for k in pingpong(len(tf), 0, n)])
            say(stage="talk", p=1.0, msg="真人讲解视频做好了（测试）", done=True, file=a.out)
        elif a.cmd == "talk":
            from .talk import run as trun
            trun(a.hy, a.template, a.audio, a.out, quality=a.quality)
        return 0
    except Exception as e:
        traceback.print_exc()
        msg = str(e) or e.__class__.__name__
        if "out of memory" in msg.lower():
            msg = "显存不够了（关掉别的占显卡的程序再试；或者选「快」）：" + msg
        say(stage=a.cmd, error=msg)
        return 1


if __name__ == "__main__":
    sys.exit(main())
