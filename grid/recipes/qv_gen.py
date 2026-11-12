"""捞捞 Q版 · 自动训练 · 画图（不定时间：谁的电脑开着谁画，活快领完了调度中心自动补）
每个小任务：
  1. 随机组合一位「虚拟老师」（男女、年龄、发型、眼镜、衣服、场景），画一张像手机拍的照片（不用真人照片，没有隐私问题）
  2. 用老师端一模一样的流程（Qwen-Image-Edit + 4 步加速插件，有发布的 Q版插件就接上）把照片变成 2 张 Q版形象（种子不同）
  3. 交给大家审核「哪张更好」（带着照片，看像不像、可不可爱、全身完整不完整）
  4. 每张图算一个 CLIP 特征（只有几 KB，跟着审核一起存），明天训练「Q版打分模型」用
要在装好 AI 引擎的电脑上跑（显卡 8G 以上）。
"""
# needs: comfy
# requires: transformers>=4.45,<5
import base64
import json
import os
import random
import time

import lg

t = lg.task()
p = t["job"]["params"]
i = int(t["input"].get("i", 0))
run_id = int(p.get("runId", 0))
work = lg.work_dir()
seed = run_id * 1000003 + i * 7919 + 17
rnd = random.Random(seed)
TAG = p.get("tag", "qv1")

# ---------------- 虚拟老师 ----------------
WOMAN_HAIR = ["long straight black hair", "shoulder-length black bob haircut", "black hair tied in a high ponytail", "short black pixie cut", "black hair in a neat low bun",
              "wavy dark brown shoulder-length hair", "curly permed black hair", "long black hair with air bangs", "chin-length dark hair tucked behind the ears", "medium-length hair dyed chestnut brown"]
MAN_HAIR = ["short black crew cut", "neat black side-part haircut", "black buzz cut", "slightly long messy black hair", "short black hair with a receding hairline", "short black hair with a bit of gray at the temples",
            "thick black hair combed back", "short curly black hair"]
OLD_HAIR = {"woman": ["short gray-streaked hair", "black hair with some gray, in a bob"], "man": ["short gray hair", "thinning salt-and-pepper hair"]}
GLASSES = ["", "", "", "", "", " and black rectangular glasses", " and thin round metal glasses", " and rimless glasses", " and tortoiseshell glasses"]
CLOTHES = ["a crisp white shirt", "a navy blue blazer over a white shirt", "a beige knit sweater", "a light blue button-up shirt", "a black turtleneck", "a gray hoodie",
           "a striped polo shirt", "a cream cardigan over a blouse", "a red sports jacket", "a dark green sweater vest over a shirt", "a denim shirt", "a simple pastel pink blouse"]
FACE = ["a round face", "an oval face", "a square jaw", "a slim face", "a soft chubby face", "high cheekbones"]
EXPR = ["a gentle smile", "a warm friendly smile", "a calm neutral expression", "a big cheerful smile", "a slight shy smile"]
PLACE = ["standing in a classroom with a blurred blackboard behind", "in front of a plain light gray wall", "in a school corridor, background softly blurred", "outdoors on a campus, background softly blurred", "in an office with bookshelves softly blurred"]
AGES = [("in their twenties", 3), ("in their thirties", 4), ("in their forties", 3), ("in their fifties", 2)]


def persona():
    g = rnd.choice(["woman", "man"])
    age = rnd.choices([a for a, _ in AGES], [w for _, w in AGES])[0]
    hair = rnd.choice(OLD_HAIR[g] if age == "in their fifties" and rnd.random() < 0.5 else (WOMAN_HAIR if g == "woman" else MAN_HAIR))
    beard = ""
    if g == "man":
        beard = rnd.choice(["", "", "", ", light stubble", ", a short mustache"])
    d = {"gender": g, "age": age, "hair": hair, "glasses": rnd.choice(GLASSES), "clothes": rnd.choice(CLOTHES), "face": rnd.choice(FACE) + beard, "expr": rnd.choice(EXPR), "place": rnd.choice(PLACE)}
    d["prompt"] = (f"A realistic upper-body photo of a Chinese {g} teacher {age}, with {hair}, {d['face']}{d['glasses']}, wearing {d['clothes']}, {d['expr']}, "
                   f"looking at the camera, {d['place']}. Natural daylight, sharp focus, natural skin texture, ordinary smartphone photo, not a model, not retouched.")
    return d


NEG_PHOTO = "cartoon, anime, 3d render, illustration, painting, deformed face, extra fingers, bad anatomy, text, watermark, logo, blurry, low quality"

# ---------------- 和老师端一样的 Q版提示词（pptassist/core/workflows.js）----------------
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
NEG_IMG = ("realistic photo, photorealistic skin, wrinkles, skin pores, uncanny, creepy, scary, deformed face, asymmetrical eyes, extra fingers, extra limbs, bad anatomy, cropped, "
           "cut off feet, cut off head, text, watermark, logo, frame, busy background, dark lighting, blurry, low quality")


def qprompt(style):
    return f"Turn the person in image 1 into {STYLES[style]}. {KEEP_ID} {BODY} {FRAME}"


# ---------------- 节点图（和 workflows.js 的 portrait 一样）----------------
def model_nodes(g, m, loras):
    g["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": m["qwenEdit"], "weight_dtype": "default"}}
    g["2"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": m["qwenClip"], "type": "qwen_image", "device": "default"}}
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": m["qwenVae"]}}
    g["4"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.1}}
    g["5"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["4", 0], "lora_name": m["qwenFast"], "strength_model": 1}}
    cur = ["5", 0]
    for k, (name, strength) in enumerate(loras):
        nid = "7%d" % k
        g[nid] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": cur, "lora_name": name, "strength_model": strength}}
        cur = [nid, 0]
    g["6"] = {"class_type": "CFGNorm", "inputs": {"model": cur, "strength": 1}}
    return ["6", 0]


def sample(g, model, image, prompt, neg, latent, sd, prefix):
    pos = {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt}
    ngt = {"clip": ["2", 0], "vae": ["3", 0], "prompt": neg}
    if image:
        pos["image1"] = image
        ngt["image1"] = image
    g["20"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": pos}
    g["21"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": ngt}
    g["22"] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["20", 0], "reference_latents_method": "index_timestep_zero"}}
    g["23"] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["21", 0], "reference_latents_method": "index_timestep_zero"}}
    g["30"] = {"class_type": "KSampler", "inputs": {"model": model, "seed": sd, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple",
                                                     "positive": ["22", 0], "negative": ["23", 0], "latent_image": latent, "denoise": 1}}
    g["31"] = {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}}
    g["40"] = {"class_type": "SaveImage", "inputs": {"images": ["31", 0], "filename_prefix": prefix}}


def run(g, kind):
    r = lg.comfy("run", graph=g, kind=kind)
    files = [f for f in r.get("files", []) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    if not files:
        raise RuntimeError("AI 引擎没交图片")
    return files[0]


def photo_graph(m, d, sd):
    g = {}
    model = model_nodes(g, m, [])
    g["12"] = {"class_type": "EmptySD3LatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}}
    sample(g, model, None, d["prompt"], NEG_PHOTO, ["12", 0], sd, "laolao-grid/photo")
    return g


def canvas_graph(m, d, sd, canvas_name):
    # 后备：有的 ComfyUI 版本不让没有图的编辑节点出图 → 在一张灰色画布上「换成一张照片」
    g = {}
    model = model_nodes(g, m, [])
    g["10"] = {"class_type": "LoadImage", "inputs": {"image": canvas_name}}
    g["11"] = {"class_type": "FluxKontextImageScale", "inputs": {"image": ["10", 0]}}
    g["12"] = {"class_type": "EmptySD3LatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}}
    sample(g, model, ["11", 0], "Replace the whole image 1 with this: " + d["prompt"], NEG_PHOTO, ["12", 0], sd, "laolao-grid/photo")
    return g


def qv_graph(m, photo_name, style, sd, loras):
    g = {}
    model = model_nodes(g, m, loras)
    g["10"] = {"class_type": "LoadImage", "inputs": {"image": photo_name}}
    g["11"] = {"class_type": "FluxKontextImageScale", "inputs": {"image": ["10", 0]}}
    g["12"] = {"class_type": "EmptySD3LatentImage", "inputs": {"width": 768, "height": 1344, "batch_size": 1}}
    sample(g, model, ["11", 0], qprompt(style), NEG_IMG, ["12", 0], sd, "laolao-grid/qv")
    return g


# ---------------- CLIP 特征（给 Q版打分模型用；CPU 上算，不和 AI 引擎抢显存）----------------
CLIP_FILES = ["config.json", "preprocessor_config.json", "model.safetensors"]
CLIP_BASES = p.get("clipBases") or [
    "https://laolao-1518432293.cos.ap-guangzhou.myqcloud.com/ai/grid/clip-vit-large-patch14/",
    "https://hf-mirror.com/openai/clip-vit-large-patch14/resolve/main/",
    "https://huggingface.co/openai/clip-vit-large-patch14/resolve/main/",
]


def clip_dir():
    d = os.path.abspath(os.path.join(work, "..", "..", "cache", "clip-vit-large-patch14"))
    for f in CLIP_FILES:
        lg.download([b + f for b in CLIP_BASES], os.path.join(d, f), note="下载 CLIP（第一次，约 1.7G）")
    return d


def to_square(im, size=224):
    from PIL import Image
    im = im.convert("RGB")
    w, h = im.size
    s = max(w, h)
    bg = Image.new("RGB", (s, s), (255, 255, 255))
    bg.paste(im, ((s - w) // 2, (s - h) // 2))
    return bg.resize((size, size), Image.BICUBIC)


def embed(paths):
    import numpy as np
    import torch
    from PIL import Image
    from transformers import CLIPVisionModelWithProjection
    m = CLIPVisionModelWithProjection.from_pretrained(clip_dir(), torch_dtype=torch.float32).eval()
    mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
    xs = [((np.asarray(to_square(Image.open(f)), dtype=np.float32) / 255 - mean) / std).transpose(2, 0, 1) for f in paths]
    with torch.no_grad():
        e = m(pixel_values=torch.tensor(np.stack(xs))).image_embeds
    e = e / e.norm(dim=-1, keepdim=True)
    return [base64.b64encode(v.numpy().astype(np.float16).tobytes()).decode() for v in e]


def small(src, dst, w=512):
    from PIL import Image
    im = Image.open(src).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(dst, quality=88)
    return dst


def sheet(paths, dst, h=448):
    from PIL import Image
    ims = [Image.open(f).convert("RGB") for f in paths]
    ims = [im.resize((round(im.width * h / im.height), h), Image.LANCZOS) for im in ims]
    out = Image.new("RGB", (sum(im.width for im in ims) + 8 * (len(ims) - 1), h), (255, 255, 255))
    x = 0
    for im in ims:
        out.paste(im, (x, 0))
        x += im.width + 8
    out.save(dst, quality=85)
    return dst


# ---------------- 开始 ----------------
t0 = time.time()
d = persona()
info = lg.comfy("info")
m = info["models"]
lg.log("AI 引擎：显存 %sG，模型 %s" % (info.get("vram"), m["qwenEdit"]))

# 有发布的 Q版插件就接上（和老师端一样）
loras = []
ws = (t.get("files") or {}).get("warmStart")
if ws:
    import hashlib
    with open(ws, "rb") as fh:
        hx = hashlib.sha256(fh.read()).hexdigest()[:12]   # 名字带内容的指纹：换了新版 ComfyUI 不会用旧的缓存
    loras.append((lg.comfy("lora", path=ws, name="qversion-%s.safetensors" % hx)["name"], float(p.get("loraStrength", 1))))
    lg.log("接上现在发布的 Q版插件")

lg.progress(0.05, "画一张虚拟老师的照片")
try:
    photo = run(photo_graph(m, d, seed % (2 ** 31)), "照片")
except Exception as e:
    lg.log("直接出图不行（%s），换成在画布上画" % e)
    from PIL import Image
    cv = os.path.join(work, "canvas.png")
    Image.new("RGB", (832, 1216), (200, 200, 200)).save(cv)
    photo = run(canvas_graph(m, d, seed % (2 ** 31), lg.comfy("upload", path=cv)["name"]), "照片")
lg.image(photo, "虚拟老师")
pname = lg.comfy("upload", path=photo, **{"as": "lg-photo-%d-%d.png" % (run_id, i)})["name"]

styles = p.get("styles") or ["toy", "toy", "film", "anime"]
style = styles[i % len(styles)]
n = int(p.get("cands", 2))
cands = []
for k in range(n):
    lg.progress(0.15 + 0.7 * k / n, "画第 %d/%d 张 Q版（%s）" % (k + 1, n, style))
    f = run(qv_graph(m, pname, style, (seed * 31 + k * 101) % (2 ** 31), loras), "Q版")
    cands.append(f)
    lg.image(f, "Q版 %d" % (k + 1))

lg.progress(0.9, "算特征、交审核")
ph_s = small(photo, os.path.join(work, "photo.jpg"))
cs = [small(f, os.path.join(work, "qv%d.jpg" % k)) for k, f in enumerate(cands)]
embs = embed([photo] + cands)
lg.output(sheet([ph_s] + cs, os.path.join(work, "sheet-%d-%d.jpg" % (run_id, i))))
meta = {"persona": {k: v for k, v in d.items() if k != "prompt"}, "style": style, "seed": seed, "lora": bool(loras), "ep": embs[0]}
for a in range(0, n - 1, 2):
    lg.review(kind="ab", tag=TAG, a=cs[a], b=cs[a + 1], ref=ph_s,
              question="左边是照片，哪张 Q版更好？（像不像这个人、可不可爱、从头到脚完整、没有画坏）",
              need=int(p.get("reviewNeed", 1)), meta={**meta, "ea": embs[1 + a], "eb": embs[2 + a]})
lg.metric(i, secs=time.time() - t0)
lg.done(style=style, secs=round(time.time() - t0, 1))
