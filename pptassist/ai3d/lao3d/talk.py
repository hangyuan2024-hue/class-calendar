# 捞捞 · 真人数字人：老师自己录的一小段视频（模板）+ 一段配音 → 老师的嘴跟着配音动的视频。
#   用 LatentSync 1.5（字节跳动，代码 Apache-2.0，权重 CreativeML Open RAIL++-M，3060 12G 够用），推理代码在 ai3d/third_party/latentsync（原样没改）。
#   我们在运行时换掉两处：
#     人脸检测：原来用 InsightFace（它的预训练模型只许非商业研究用）→ 换成 OpenCV 自带的 YuNet（MIT，模型随软件分发）；
#     读声音：原来用 decord（新 Python 上装不上）→ 换成 soundfile。
#   模板短、配音长时，模板来回放（正着放完倒着放，接得上不跳）；配音太长时按停顿切成十几秒一段分别做再接起来（省内存）。
#   这些依赖装在整合包旁边的 lao3d_talk/libs 里，只在这个进程里优先用，不影响画立绘和 3D 那几步的环境。
import math
import os
import shutil
import subprocess
import sys
import types

import numpy as np

from .util import say, log, use_mirror, reachable, free_gpu

HERE = os.path.dirname(os.path.abspath(__file__))
THIRD = os.path.normpath(os.path.join(HERE, "..", "third_party"))
LS_DIR = os.path.join(THIRD, "latentsync")
YUNET = os.path.join(THIRD, "yunet", "face_detection_yunet_2023mar.onnx")
FPS = 25
SR = 16000
# 装到 libs 里的（都用 --no-deps，免得 pip 顺手把整合包的 torch / numpy 换掉）
PKGS = ["diffusers==0.32.2", "huggingface_hub==0.26.5", "omegaconf==2.3.0", "antlr4-python3-runtime==4.9.3", "einops==0.7.0",
        "kornia==0.8.0", "kornia_rs==0.1.8", "DeepCache==0.1.1", "ffmpeg-python==0.2.0", "future", "soundfile==0.12.1", "cffi", "pycparser",
        "imageio==2.31.1", "imageio-ffmpeg==0.5.1"]
WEIGHTS = ("ByteDance/LatentSync-1.5", ["latentsync_unet.pt", "whisper/tiny.pt"])
VAE = "stabilityai/sd-vae-ft-mse"


def home(hy):
    if not hy:
        raise RuntimeError("先选整合包的文件夹")
    return os.path.join(os.path.abspath(hy), "lao3d_talk")


# ---------- 不用模型、可以单独测的几块 ----------
def pingpong(n, start, count):
    """模板有 n 帧，来回放：从第 start 帧（来回放的总帧号）起取 count 帧，返回每一帧对应模板的第几帧"""
    if n <= 1:
        return [0] * count
    period = 2 * n - 2
    out = []
    for i in range(start, start + count):
        k = i % period
        out.append(k if k < n else period - k)
    return out


def split_audio(x, rate=SR, max_sec=16.0, look=3.0):
    """配音按停顿切段：每段不超过 max_sec 秒，切在前后 look 秒里最安静的地方。返回 [(开始样本, 结束样本)]"""
    n = len(x)
    if n <= max_sec * rate:
        return [(0, n)]
    hop = int(rate * 0.02)
    e = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(hop) / hop, mode="same"))
    out, s = [], 0
    while n - s > max_sec * rate:
        hi = s + int(max_sec * rate)
        lo = max(s + int((max_sec - look) * rate), s + rate)
        cut = lo + int(np.argmin(e[lo:hi]))
        out.append((s, cut))
        s = cut
    out.append((s, n))
    return out


class YuNetFace:
    """LatentSync 要的人脸检测（替换 InsightFace）：返回人脸框和一个 106 点的数组——只填 LatentSync 用到的那几个点：
    两道眉毛的中心（43,48,49,50,51 / 101~105）和鼻子中间（74,77,83,86）。
    YuNet 给的是两只眼睛和鼻尖：LatentSync 的模板就是 StyleSync 的「两眼 + 鼻子」模板整体往上挪了 10 个单位、两边各放宽 2 个单位，
    所以眉毛中心 = 眼睛往上 0.27 个眼距、往外放宽 41/37 倍，鼻子中间 = 两眼连线往下 0.27 个眼距。
    哪一帧没找到脸（低头、手挡住）就用上一帧的。"""

    def __init__(self, device="cuda", model=YUNET):
        import cv2
        self.cv2 = cv2
        self.det = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.6, 0.3, 5000)
        self.last = None
        self.size = None

    def raw(self, frame):
        h, w = frame.shape[:2]
        if self.size != (w, h):
            self.det.setInputSize((w, h))
            self.size = (w, h)
        img = np.ascontiguousarray(frame[:, :, ::-1])   # LatentSync 给的是 RGB，YuNet 要 BGR
        _, faces = self.det.detect(img)
        if faces is None or len(faces) == 0:
            return None
        f = max(faces, key=lambda r: r[2] * r[3] * r[-1])
        return f

    def __call__(self, frame, threshold=0.5):
        f = self.raw(np.asarray(frame))
        if f is None or f[-1] < threshold:
            return self.last if self.last is not None else (None, None)
        x, y, w, h = f[:4]
        el, er = np.array(f[4:6]), np.array(f[6:8])   # 照片里左边那只、右边那只
        if el[0] > er[0]:
            el, er = er, el
        m, d = (el + er) / 2, np.linalg.norm(er - el)
        ex = (er - el) / max(d, 1e-6)
        up = np.array([ex[1], -ex[0]])   # 垂直于两眼连线、朝头顶
        if up[1] > 0:
            up = -up
        bl = m + (el - m) * (41 / 37) + up * 0.27 * d
        br = m + (er - m) * (41 / 37) + up * 0.27 * d
        nose = m - up * 0.27 * d
        lmk = np.zeros((106, 2), np.float32)
        lmk[[43, 48, 49, 50, 51]] = bl
        lmk[101:106] = br
        lmk[[74, 77, 83, 86]] = nose
        lmk[[73]] = nose
        box = np.array([x, y, x + w, y + h], np.float32)
        self.last = (box.astype(np.int_).tolist(), lmk)
        return self.last


def read_frames(path):
    import cv2
    cap = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        out.append(f[:, :, ::-1].copy())
    cap.release()
    if not out:
        raise RuntimeError("模板视频读不出来：" + path)
    return out


def write_frames(path, frames, fps=FPS):
    import cv2
    h, w = frames[0].shape[:2]
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for f in frames:
        vw.write(np.ascontiguousarray(f[:, :, ::-1]))
    vw.release()


def read_wav(path):
    import soundfile as sf
    x, r = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if r != SR:   # 一般 PPT 助手已经转好 16k 了；不是的话简单重采样
        t = np.arange(int(len(x) * SR / r)) * (r / SR)
        x = np.interp(t, np.arange(len(x)), x).astype(np.float32)
    return x


def ffmpeg_bin():
    f = os.environ.get("LAO_FFMPEG")
    return f if f and os.path.exists(f) else "ffmpeg"


def concat(parts, out):
    lst = out + ".txt"
    with open(lst, "w", encoding="utf-8") as fh:
        for p in parts:
            fh.write("file '" + os.path.abspath(p).replace("\\", "/").replace("'", "'\\''") + "'\n")
    r = subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-an", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out], capture_output=True, text=True)
    os.remove(lst)
    if r.returncode != 0:
        raise RuntimeError("视频接不起来：" + r.stderr[-500:])


# ---------- 环境 ----------
def _stubs():
    """LatentSync 的 util.py 一开头就 import decord、matplotlib：这两样我们用不到，没装就放个空的"""
    try:
        import decord  # noqa: F401
    except Exception:
        m = types.ModuleType("decord")

        class _No:
            def __init__(self, *a, **k):
                raise RuntimeError("decord 没装（捞捞用 soundfile / OpenCV 读音视频）")
        m.AudioReader = m.VideoReader = _No
        sys.modules["decord"] = m
    try:
        import matplotlib.pyplot  # noqa: F401
    except Exception:
        mp = types.ModuleType("matplotlib")
        mp.pyplot = types.ModuleType("matplotlib.pyplot")
        mp.use = lambda *a, **k: None
        sys.modules["matplotlib"] = mp
        sys.modules["matplotlib.pyplot"] = mp.pyplot
    fd = types.ModuleType("latentsync.utils.face_detector")
    fd.FaceDetector = YuNetFace
    sys.modules["latentsync.utils.face_detector"] = fd


def activate(hy):
    h = home(hy)
    libs = os.path.join(h, "libs")
    if os.path.isdir(libs) and libs not in sys.path:
        sys.path.insert(0, libs)
    if LS_DIR not in sys.path:
        sys.path.insert(1 if libs in sys.path else 0, LS_DIR)
    f = ffmpeg_bin()
    if os.path.isabs(f):   # LatentSync 自己也会叫 ffmpeg（不带路径）
        os.environ["PATH"] = os.path.dirname(f) + os.pathsep + os.environ.get("PATH", "")
    _stubs()
    return h


def _has(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def check(hy):
    h = activate(hy)
    ck = os.path.join(h, "checkpoints")
    info = {"home": h, "weights": all(os.path.exists(os.path.join(ck, f)) for f in WEIGHTS[1]),
            "yunet": os.path.exists(YUNET), "code": os.path.exists(os.path.join(LS_DIR, "configs", "unet", "stage2.yaml"))}
    for m in ("torch", "cv2", "diffusers", "omegaconf", "einops", "kornia", "soundfile", "imageio", "ffmpeg", "DeepCache"):
        info[m] = _has(m)
    try:
        import diffusers
        info["diffusers_ver"] = diffusers.__version__
    except Exception:
        pass
    info["ok"] = all(info[k] for k in ("weights", "yunet", "code", "torch", "cv2", "diffusers", "omegaconf", "einops", "kornia", "soundfile", "imageio", "ffmpeg"))
    return info


def setup(hy):
    h = home(hy)
    os.makedirs(os.path.join(h, "libs"), exist_ok=True)
    index = None if reachable("https://pypi.org/simple/") else "https://pypi.tuna.tsinghua.edu.cn/simple"
    use_mirror()
    say(stage="talk-setup", p=0.05, msg="安装口型同步要用的组件（装在整合包旁边单独的文件夹里，不影响别的）")
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--upgrade", "--target", os.path.join(h, "libs")] + (["-i", index] if index else []) + PKGS
    log(" ".join(cmd))
    if subprocess.run(cmd).returncode != 0:
        raise RuntimeError("组件没装上（看日志里 pip 的报错）")
    say(stage="talk-setup", p=0.4, msg="下载口型同步模型 LatentSync 1.5（约 5GB，第一次要一会儿）")
    from huggingface_hub import hf_hub_download, snapshot_download
    ck = os.path.join(h, "checkpoints")
    for f in WEIGHTS[1]:
        if not os.path.exists(os.path.join(ck, f)):
            hf_hub_download(WEIGHTS[0], f, local_dir=ck)
    say(stage="talk-setup", p=0.85, msg="下载画面解码器（sd-vae-ft-mse）")
    snapshot_download(VAE, local_dir=os.path.join(ck, "sd-vae-ft-mse"), allow_patterns=["config.json", "diffusion_pytorch_model.safetensors"])
    activate(hy)
    info = check(hy)
    if not info["ok"]:
        miss = [k for k in ("weights", "torch", "cv2", "diffusers", "omegaconf", "einops", "kornia", "soundfile", "imageio", "ffmpeg") if not info.get(k)]
        raise RuntimeError("还缺：" + "、".join(miss))
    say(stage="talk-setup", p=1.0, msg="真人数字人的组件都装好了", done=True, info=info)
    return info


# ---------- 对口型 ----------
def _pipeline(h, device, dtype, deepcache):
    import torch
    from omegaconf import OmegaConf
    from diffusers import AutoencoderKL, DDIMScheduler
    from latentsync.models.unet import UNet3DConditionModel
    from latentsync.pipelines import lipsync_pipeline as LP
    from latentsync.whisper.audio2feature import Audio2Feature

    LP.read_audio = lambda p, audio_sample_rate=SR: torch.from_numpy(read_wav(p))   # 换掉 decord
    ck = os.path.join(h, "checkpoints")
    config = OmegaConf.load(os.path.join(LS_DIR, "configs", "unet", "stage2.yaml"))
    sched = DDIMScheduler.from_pretrained(os.path.join(LS_DIR, "configs"))
    audio = Audio2Feature(model_path=os.path.join(ck, "whisper", "tiny.pt"), device=device, num_frames=config.data.num_frames, audio_feat_length=config.data.audio_feat_length)
    vae_dir = os.path.join(ck, "sd-vae-ft-mse")
    vae = AutoencoderKL.from_pretrained(vae_dir if os.path.isdir(vae_dir) else VAE, torch_dtype=dtype)
    vae.config.scaling_factor = 0.18215
    vae.config.shift_factor = 0
    unet, _ = UNet3DConditionModel.from_pretrained(OmegaConf.to_container(config.model), os.path.join(ck, "latentsync_unet.pt"), device="cpu")
    unet = unet.to(dtype=dtype)
    pipe = LP.LipsyncPipeline(vae=vae, audio_encoder=audio, unet=unet, scheduler=sched).to(device)
    if deepcache:
        try:
            from DeepCache import DeepCacheSDHelper
            hp = DeepCacheSDHelper(pipe=pipe)
            hp.set_params(cache_interval=3, cache_branch_id=0)
            hp.enable()
        except Exception as e:
            log("DeepCache 没用上：", e)
    return pipe, config


def run(hy, template, audio_path, out, quality="best"):
    import torch
    h = activate(hy)
    info = check(hy)
    if not info["ok"]:
        raise RuntimeError("真人数字人的组件还没装好（点「安装真人数字人组件」）")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        raise RuntimeError("没找到 NVIDIA 显卡，做不了真人数字人")
    dtype = torch.float16 if torch.cuda.get_device_capability()[0] > 7 else torch.float32
    steps, guidance, deepcache = (30, 1.5, False) if quality == "best" else (20, 1.5, True)
    work = os.path.join(h, "work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    say(stage="talk", p=0.02, msg="读模板视频和配音")
    tf = read_frames(template)
    x = read_wav(audio_path)
    parts = split_audio(x)
    say(stage="talk", p=0.05, msg=f"加载口型同步模型（{len(parts)} 段）")
    pipe, config = _pipeline(h, device, dtype, deepcache)
    import soundfile as sf
    outs, frame0 = [], 0
    cwd = os.getcwd()
    os.chdir(work)   # LatentSync 在当前目录建 temp/、用相对路径叫 ffmpeg（路径里有空格也不怕）
    try:
        for i, (a, b) in enumerate(parts):
            nfr = int(math.ceil((b - a) / SR * FPS)) + 2
            idx = pingpong(len(tf), frame0, nfr)
            write_frames(f"v_{i}.mp4", [tf[k] for k in idx])
            sf.write(f"a_{i}.wav", x[a:b], SR)
            say(stage="talk", p=round(0.08 + 0.85 * i / len(parts), 3), msg=f"对口型：第 {i + 1}/{len(parts)} 段")
            pipe(video_path=f"v_{i}.mp4", audio_path=f"a_{i}.wav", video_out_path=f"o_{i}.mp4", num_frames=config.data.num_frames,
                 num_inference_steps=steps, guidance_scale=guidance, weight_dtype=dtype, width=config.data.resolution, height=config.data.resolution,
                 mask_image_path=os.path.join(LS_DIR, "latentsync", "utils", "mask.png"), temp_dir="temp")
            if not os.path.exists(f"o_{i}.mp4"):
                raise RuntimeError(f"第 {i + 1} 段没做出来")
            outs.append(os.path.join(work, f"o_{i}.mp4"))
            frame0 += int(round((b - a) / SR * FPS))
            free_gpu()
    finally:
        os.chdir(cwd)
    say(stage="talk", p=0.95, msg="接起来")
    concat(outs, out)
    say(stage="talk", p=1.0, msg="真人讲解视频做好了", done=True, file=out)
    return out
