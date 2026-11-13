"""捞捞 Q版 · 训练 Q版插件（LoRA）——要 24G 以上显存：租一台 Linux 显卡，用命令行版接进来（tools/worker.js）
  1. 从大家的审核里挑「赢了的那张」：照片（参考图）→ 赢的 Q版（目标图）+ 当时的提示词
  2. 用 musubi-tuner（kohya-ss，Apache-2.0）在 Qwen-Image-Edit-2511 上训练 LoRA
     第一次要下：musubi-tuner、底子（bf16，约 41G）、文字编码器（约 17G）、VAE（0.3G）——租的机器网快，十几分钟
  3. 交上去发布成「qversion-lora-test」（试用）：同事画图时一张用现在的、一张用新的，大家审核比一比，
     新的赢得多再用 `node tools/grid.js promote` 转正（老师端才换上）
显存 ≥ 40G（A100 / A800 / L40）：fp8；24G（4090）：fp8 + 把一部分层放到内存（要 64G 内存）。
第一次在租的卡上跑，参数可能要调：出错了把日志发出来，改配方重新上传就行（客户端不用动）。
"""
# requires: huggingface_hub toml
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import lg

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()
CACHE = os.path.abspath(p.get("cache") or os.path.join(work, "..", "..", "cache"))
t0 = time.time()

STYLES = {
    "toy": "an adorable chibi 3D collectible figure in premium designer blind-box toy style: smooth matte vinyl material, soft rounded shapes, soft studio lighting with a subtle rim light, polished and clean",
    "film": "an adorable chibi character in high-end 3D animated feature film style: soft subsurface skin shading, expressive appealing face, warm cinematic soft lighting, polished render",
    "anime": "an adorable chibi character in clean Japanese anime illustration style: crisp line art, soft cel shading, bright clear colors, kawaii",
}
KEEP_ID = ("Keep this person clearly recognizable: the same face shape, the same hairstyle, hair length, parting and hair color, the same eyebrows, the same eye shape, the same facial hair if any, "
           "the same glasses if any, the same skin tone, and the same clothing style and colors.")
BODY = ("Chibi proportions: big head about one third of the total height, small cute body, short arms and legs. Big bright eyes with soft highlights, small nose, "
        "a gentle friendly smile with the mouth closed, a light natural blush.")
FRAME = ("Full body, standing upright and facing the camera, arms relaxed at the sides, both hands visible, feet together. The whole figure is visible from the top of the head to the shoes, "
         "centered, with clear space above the head and below the feet. Plain pure white background, no shadow on the background, no text, no logo, no props, no frame.")


def qprompt(style):
    return f"Turn the person in image 1 into {STYLES.get(style, STYLES['toy'])}. {KEEP_ID} {BODY} {FRAME}"


def sh(args, cwd=None, label=""):
    """跑一个命令，输出实时写进日志；出错把最后几行带出来。"""
    lg.log("运行：" + " ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(args))[:300])
    pr = subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1"))
    tail = []
    last = 0.0
    for line in pr.stdout:
        line = line.rstrip()
        tail = (tail + [line])[-40:]
        if label and ("steps:" in line or "it/s" in line or "s/it" in line):
            if time.time() - last > 20:
                last = time.time()
                lg.log("%s：%s" % (label, line[-160:]))
        elif line and not line.startswith(" "):
            print(line, flush=True)
    if pr.wait() != 0:
        raise RuntimeError("%s失败：\n%s" % (label or "命令", "\n".join(tail[-12:])))


def get(url, dest):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laolao-grid"}), timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


# ---------------- 1. 训练集：审核里赢的那张 ----------------
items = lg.dataset()
win, seen = [], set()
for it in items:
    pl, r = it.get("payload") or {}, it.get("result") or {}
    c = r.get("choice")
    if c not in ("a", "b") or not pl.get("refUrl") or not pl.get(c + "Url") or pl.get("ref") in seen:
        continue
    if ((pl.get("meta") or {}).get("sides") or {}).get(c) == "test":
        continue   # 新插件自己画的不拿来训练自己（避免越训越偏）
    seen.add(pl.get("ref"))
    win.append((it["id"], pl["refUrl"], pl[c + "Url"], (pl.get("meta") or {}).get("style", "toy")))
lg.log("审核 %d 条，能用的 %d 组" % (len(items), len(win)))
if len(win) < int(p.get("minPairs", 200)):
    lg.done(skip="能用的还不够（%d 组，要 %d 组）" % (len(win), int(p.get("minPairs", 200))), pairs=len(win))
    raise SystemExit(0)
ds = os.path.join(work, "set")
for sub in ("control", "target", "cache"):
    os.makedirs(os.path.join(ds, sub), exist_ok=True)
n_ok = 0
for k, (rid, ref, tgt, style) in enumerate(win):
    n = "%06d" % rid
    try:
        get(ref, os.path.join(ds, "control", n + ".jpg"))   # 参考图和目标图同名（musubi-tuner 按文件名配对）
        get(tgt, os.path.join(ds, "target", n + ".jpg"))
    except Exception as e:
        lg.log("第 %d 组下载失败，跳过：%s" % (k + 1, e))
        continue
    with open(os.path.join(ds, "target", n + ".txt"), "w", encoding="utf-8") as f:
        f.write(qprompt(style))
    n_ok += 1
    if k % 20 == 0:
        lg.progress(0.05 * (k + 1) / len(win), "下载训练集 %d/%d" % (k + 1, len(win)))
lg.log("训练集：%d 组" % n_ok)

if p.get("dryRun"):   # 测试用：没有大显卡的电脑上只检查训练集
    out = os.path.join(work, "qversion-lora.safetensors")
    open(out, "wb").write(b"dry")
    lg.done(lora=out, pairs=n_ok, dry=True)
    raise SystemExit(0)

# ---------------- 2. musubi-tuner + 模型 ----------------
import torch  # noqa: E402

vram = torch.cuda.get_device_properties(0).total_memory / 2 ** 30 if torch.cuda.is_available() else 0
lg.log("显卡：%s，%.0fG 显存" % (torch.cuda.get_device_name(0) if vram else "没有", vram))
if vram < 22:
    raise RuntimeError("显存不够（要 24G 以上）")
mt = os.path.join(CACHE, "musubi-tuner")
if not os.path.exists(os.path.join(mt, "src", "musubi_tuner")):
    lg.progress(0.06, "下载 musubi-tuner")
    for u in ["https://github.com/kohya-ss/musubi-tuner.git", "https://ghfast.top/https://github.com/kohya-ss/musubi-tuner.git", "https://gh-proxy.com/https://github.com/kohya-ss/musubi-tuner.git"]:
        shutil.rmtree(mt, ignore_errors=True)
        if subprocess.run(["git", "clone", "--depth", "1", u, mt]).returncode == 0:
            break
    if p.get("musubiRef"):
        subprocess.run(["git", "-C", mt, "fetch", "--depth", "1", "origin", p["musubiRef"]])
        subprocess.run(["git", "-C", mt, "checkout", "FETCH_HEAD"])
    sh([sys.executable, "-m", "pip", "install", "-q", "-e", mt, "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"], label="装 musubi-tuner")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
from huggingface_hub import hf_hub_download  # noqa: E402

MD = os.path.join(CACHE, "qwen-image-models")


def model(repo, path):
    lg.log("下载 %s（下过的跳过）" % os.path.basename(path))
    return hf_hub_download(repo, path, local_dir=MD)


lg.progress(0.08, "下载模型（第一次约 58G）")
dit = model("Comfy-Org/Qwen-Image-Edit_ComfyUI", p.get("dit", "split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors"))
te = model("Comfy-Org/Qwen-Image_ComfyUI", "split_files/text_encoders/qwen_2.5_vl_7b.safetensors")
vae = model("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors")
MV = p.get("modelVersion", "edit-2511")

# ---------------- 3. 缓存 + 训练 ----------------
W, H = p.get("resolution", [768, 1344])
toml = os.path.join(work, "dataset.toml")
with open(toml, "w", encoding="utf-8") as f:
    f.write('[general]\nresolution = [%d, %d]\ncaption_extension = ".txt"\nbatch_size = 1\nenable_bucket = true\nbucket_no_upscale = false\n\n'
            '[[datasets]]\nimage_directory = "%s"\ncontrol_directory = "%s"\ncache_directory = "%s"\nnum_repeats = 1\n'
            % (W, H, os.path.join(ds, "target").replace("\\", "/"), os.path.join(ds, "control").replace("\\", "/"), os.path.join(ds, "cache").replace("\\", "/")))
S = os.path.join(mt, "src", "musubi_tuner")
lg.progress(0.15, "准备：把图片编码好（一次）")
sh([sys.executable, os.path.join(S, "qwen_image_cache_latents.py"), "--dataset_config", toml, "--vae", vae, "--model_version", MV], cwd=mt, label="编码图片")
lg.progress(0.2, "准备：把提示词编码好（一次）")
sh([sys.executable, os.path.join(S, "qwen_image_cache_text_encoder_outputs.py"), "--dataset_config", toml, "--text_encoder", te, "--batch_size", "1", "--model_version", MV]
   + (["--fp8_vl"] if vram < 40 else []), cwd=mt, label="编码提示词")

steps = int(p.get("steps", 2500))
epochs = max(1, -(-steps // max(n_ok, 1)))
out_dir = os.path.join(work, "out")
args = ["accelerate", "launch", "--num_cpu_threads_per_process", "1", "--mixed_precision", "bf16", os.path.join(S, "qwen_image_train_network.py"),
        "--dit", dit, "--vae", vae, "--text_encoder", te, "--dataset_config", toml, "--model_version", MV,
        "--sdpa", "--mixed_precision", "bf16", "--timestep_sampling", p.get("timestepSampling", "shift"), "--weighting_scheme", "none", "--discrete_flow_shift", str(p.get("flowShift", 2.2)),
        "--optimizer_type", "adamw8bit", "--learning_rate", str(p.get("lr", 1e-4)), "--gradient_checkpointing",
        "--max_data_loader_n_workers", "2", "--persistent_data_loader_workers",
        "--network_module", "networks.lora_qwen_image", "--network_dim", str(p.get("rank", 32)), "--network_alpha", str(p.get("alpha", 16)),
        "--max_train_epochs", str(epochs), "--save_every_n_epochs", str(epochs), "--seed", "42", "--output_dir", out_dir, "--output_name", "qversion-lora",
        "--fp8_base", "--fp8_scaled"]
if vram < 40:
    args += ["--blocks_to_swap", str(p.get("blocksToSwap", 16))]
args += p.get("extraArgs", [])
lg.progress(0.25, "训练：约 %d 步（%d 组 × %d 轮）" % (epochs * n_ok, n_ok, epochs))
sh(args, cwd=mt, label="训练")
lora = sorted(glob.glob(os.path.join(out_dir, "qversion-lora*.safetensors")), key=os.path.getmtime)[-1]

# ---------------- 4. 转成 ComfyUI 能直接用的格式 ----------------
out = os.path.join(work, "qversion-lora.safetensors")
conv = os.path.join(S, "convert_lora.py")
try:
    if not os.path.exists(conv):
        raise FileNotFoundError(conv)
    sh([sys.executable, conv, "--input", lora, "--output", out, "--target", "other"], cwd=mt, label="转格式")
except Exception as e:
    lg.log("转格式没成功（%s），先交原始格式（ComfyUI 多半也能读）" % str(e)[:200])
    shutil.copyfile(lora, out)
lg.done(lora=out, pairs=n_ok, steps=epochs * n_ok, vram=round(vram), hours=round((time.time() - t0) / 3600, 2))
