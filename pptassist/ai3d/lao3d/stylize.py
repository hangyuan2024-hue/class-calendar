# 捞捞 · 3D 形象工坊 第 1 步：老师照片 + 参考图 → 公仔立绘（要显卡）
#   模型：阿里开源的 Qwen-Image-Edit-2509（Apache-2.0，能同时看好几张图：「图1的人，做成图2的样子」）
#   12G 显存放不下它的原版（200 亿参数），用 MIT 韩松组 nunchaku 的 4bit 版本（SVDQuant），按层放到显卡上算；
#   内存只有 16G 时，读图写字的那部分（Qwen2.5-VL 7B）也用 4bit，先算完、放掉，再画图。
#   一次出好几张（不同的随机种子），让老师挑一张最像的。
import os

from .util import say, log, use_mirror, gpu_info, ram_gb, free_gpu

PIPE_REPO = "Qwen/Qwen-Image-Edit-2509"
NUNCHAKU_REPO = "nunchaku-tech/nunchaku-qwen-image-edit-2509"
SIZE = (832, 1216)   # 竖的全身图（宽、高），约 100 万像素，16 的倍数

# Q版（老师要求的）：2～2.5 头身的大头小身子。参考图不是 Q版也按这个比例做
QBAN = ("Q版（chibi）比例：大约 2～2.5 头身，头特别大、圆圆的，约占身高的四成；身子短小、肉乎乎的，胳膊腿短短的、圆圆的，小手小脚；"
        "大眼睛、小鼻子、小嘴，脸蛋圆润，表情可爱。表面光滑干净，像软胶或哑光树脂做的手办，没有褶皱和颗粒。")
SMOOTH = "整体造型简洁圆润，大块面，衣服少褶皱，头发是成束的大块造型、表面光滑。"
POSE = ("全身，从头到脚都在画面里，正对镜头站直，两条胳膊自然下垂、稍微离开身体，手不碰到身体、手里不拿东西，两脚稍微分开。"
        "纯白色背景，没有底座、没有文字、没有别的东西。")
LIKE = "脸一定要像图1的老师：脸型、发型、发色、刘海、眉毛、眼睛、鼻子、嘴的样子和比例、眼镜（如果有），都照着图1，在 Q版的可爱化里保留这些特点。"
PROMPT_STYLE = (
    "图1是一位老师的照片，图2是一个3D公仔手办。把图1里的这位老师做成图2那种风格的3D Q版公仔手办："
    "和图2一样的材质和做工、一样柔和的摄影棚灯光。" + QBAN + SMOOTH + LIKE + "{clothes}" + POSE
)
PROMPT_PHOTO_ONLY = (
    "把图1里的这位老师做成一个3D Q版公仔手办：精致的手办做工，柔和的摄影棚灯光。" + QBAN + SMOOTH + LIKE +
    "衣服照着图1里老师穿的。" + POSE
)
CLOTHES = {"photo": "衣服照着图1里老师穿的。", "style": "衣服、鞋子、配饰照着图2的公仔。"}
NEGATIVE = "写实比例，大长腿，八头身，小头，瘦长身材，衣服褶皱多，表面粗糙，颗粒感，多个人，文字，水印，底座，侧身，背影，手放在胸前，手拿东西，手贴着身体，画面被裁切，只有半身，模糊，变形，多余的手指"


# 视频里挑出来的侧面 / 背面拼成一张，放在最后一张图：发型后面的样子（马尾、发髻、多长）照着它
EXTRA = "图{k}是同一位老师的侧面和背面（从视频里截的），发型的长短、扎法（马尾、丸子头、披着）、后脑勺的样子都照着图{k}。"


def prompt_for(has_style, clothes="photo", extra=False):
    p = PROMPT_STYLE.format(clothes=CLOTHES.get(clothes, CLOTHES["photo"])) if has_style else PROMPT_PHOTO_ONLY
    return p + (EXTRA.format(k=3 if has_style else 2) if extra else "")


def panel(files, h=640):
    """几张侧面 / 背面拼成一张横的图（一样高）"""
    from PIL import Image
    ims = []
    for f in files:
        im = Image.open(f).convert("RGB")
        ims.append(im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS))
    out = Image.new("RGB", (sum(i.width for i in ims) + 16 * (len(ims) - 1), h), "white")
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + 16
    return out


def _fit(img, max_side=1280):
    from PIL import Image
    img = img.convert("RGB")
    w, h = img.size
    k = min(1.0, max_side / max(w, h))
    if k < 1:
        img = img.resize((int(w * k), int(h * k)), Image.LANCZOS)
    return img


def run(photo, style, out_dir, n=3, quality="best", clothes="photo", seed=None, rank=None, extra=None):
    import random
    import torch
    from PIL import Image
    from diffusers import QwenImageEditPlusPipeline
    use_mirror()
    os.makedirs(out_dir, exist_ok=True)
    g, ram = gpu_info(), ram_gb()
    if not g.get("cuda"):
        raise RuntimeError("没找到 NVIDIA 显卡（或者装的 PyTorch 不带 CUDA），这一步要显卡")
    log("显卡", g, "内存", ram, "G")
    imgs = [_fit(Image.open(photo))] + ([_fit(Image.open(style))] if style else []) + ([_fit(panel(extra))] if extra else [])
    prompt = prompt_for(bool(style), clothes, bool(extra))
    fast = quality == "fast"
    steps = 8 if fast else 40
    rank = rank or (128 if ram >= 24 else 32)
    from nunchaku.utils import get_precision
    prec = get_precision()   # 30 系显卡是 int4
    tname = (f"lightning-251115/svdq-{prec}_r{rank}-qwen-image-edit-2509-lightning-8steps-251115.safetensors" if fast
             else f"svdq-{prec}_r{rank}-qwen-image-edit-2509.safetensors")

    # ---- 1) 先把文字和参考图读懂（Qwen2.5-VL 7B），算完就放掉，给画图腾地方
    say(stage="stylize", p=0.02, msg="读照片和要求（第一次要下载约 17G 模型，比较慢）")
    te = None
    if ram < 32:
        try:
            from transformers import BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration
            te = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                PIPE_REPO, subfolder="text_encoder", torch_dtype=torch.bfloat16, device_map={"": 0},
                quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16))
        except Exception as e:
            log("4bit 读图模型没装上，用原版（内存不够时会用虚拟内存，很慢）：", e)
            te = None
    kw = {"transformer": None, "torch_dtype": torch.bfloat16}
    if te is not None:
        kw["text_encoder"] = te
    pipe = QwenImageEditPlusPipeline.from_pretrained(PIPE_REPO, **kw)
    if te is None:
        pipe.enable_model_cpu_offload()
    try:
        from diffusers.pipelines.qwenimage.pipeline_qwenimage_edit_plus import calculate_dimensions, CONDITION_IMAGE_SIZE
    except Exception:
        import math
        CONDITION_IMAGE_SIZE = 384 * 384

        def calculate_dimensions(area, ratio):
            w = math.sqrt(area * ratio)
            return round(w / 32) * 32, round(w / ratio / 32) * 32
    cond = []
    for im in imgs:
        w, h = calculate_dimensions(CONDITION_IMAGE_SIZE, im.size[0] / im.size[1])
        cond.append(pipe.image_processor.resize(im, h, w))
    dev = "cuda"
    with torch.no_grad():
        pe, pm = pipe.encode_prompt(image=cond, prompt=prompt, device=dev)
        ne, nm = pipe.encode_prompt(image=cond, prompt=NEGATIVE, device=dev)
    pe, ne = pe.to("cpu"), ne.to("cpu")
    pm = pm.to("cpu") if pm is not None else None
    nm = nm.to("cpu") if nm is not None else None
    pipe.text_encoder = None
    del te
    free_gpu()

    # ---- 2) 画图：4bit 的 Qwen-Image-Edit，按层放显卡
    say(stage="stylize", p=0.1, msg="准备画图的模型（第一次要下载约 12G）")
    from nunchaku import NunchakuQwenImageTransformer2DModel
    tr = NunchakuQwenImageTransformer2DModel.from_pretrained(f"{NUNCHAKU_REPO}/{tname}")
    pipe.register_modules(transformer=tr)
    vram = g.get("vram", 8)
    blocks = 30 if vram >= 11 else (12 if vram >= 8 else 1)
    tr.set_offload(True, use_pin_memory=False, num_blocks_on_gpu=blocks)
    pipe._exclude_from_cpu_offload.append("transformer")
    if hasattr(pipe, "remove_all_hooks"):   # 读图时可能挂过整块搬的钩子，先摘掉
        pipe.remove_all_hooks()
    pipe.enable_sequential_cpu_offload()
    if fast:
        try:   # lightning 版要配它自己的调度器设置
            from diffusers import FlowMatchEulerDiscreteScheduler
            import math
            pipe.scheduler = FlowMatchEulerDiscreteScheduler.from_config({
                "base_image_seq_len": 256, "base_shift": math.log(3), "invert_sigmas": False, "max_image_seq_len": 8192, "max_shift": math.log(3),
                "num_train_timesteps": 1000, "shift": 1.0, "shift_terminal": None, "stochastic_sampling": False, "time_shift_type": "exponential",
                "use_beta_sigmas": False, "use_dynamic_shifting": True, "use_exponential_sigmas": False, "use_karras_sigmas": False})
        except Exception as e:
            log("lightning 调度器没设上：", e)
    seeds = [seed + i for i in range(n)] if seed is not None else [random.randint(0, 2 ** 31 - 1) for _ in range(n)]
    outs = []
    for i, sd in enumerate(seeds):
        base = 0.12 + 0.86 * i / n

        def cb(p_, step, t, kw_, base=base):
            say(stage="stylize", p=round(base + 0.86 / n * (step + 1) / steps, 3), msg=f"画第 {i + 1}/{n} 张：{step + 1}/{steps} 步")
            return kw_
        img = pipe(image=imgs, prompt_embeds=pe.to(dev), prompt_embeds_mask=None if pm is None else pm.to(dev),
                   negative_prompt_embeds=ne.to(dev), negative_prompt_embeds_mask=None if nm is None else nm.to(dev),
                   true_cfg_scale=1.0 if fast else 4.0, num_inference_steps=steps, width=SIZE[0], height=SIZE[1],
                   generator=torch.Generator("cpu").manual_seed(sd), callback_on_step_end=cb).images[0]
        f = os.path.join(out_dir, f"cand_{i + 1}.png")
        img.save(f)
        outs.append({"file": f, "seed": sd})
        say(stage="stylize", p=round(base + 0.86 / n, 3), msg=f"第 {i + 1} 张画好了", cand=f)
    return outs
