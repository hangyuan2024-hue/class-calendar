// AI 形象工坊的「工作流」：交给本机的 ComfyUI 跑的 API 格式节点图（纯数据，不联网、不碰文件）。
//   portrait  老师的照片 → Q版形象（全身、白底、竖图），一次画好几张让老师挑
//   variant   挑好的形象 → 同一张图只改嘴 / 只改眼睛（Q版动画用的口型和眨眼图层）
//   talk      形象 + 一段配音 → 会说话、有表情和手势的视频（InfiniteTalk，音频驱动）
// 节点名和参数都在真的 ComfyUI 0.45 + ComfyUI-WanVideoWrapper + VideoHelperSuite 上核对过（test/workflows-check.js）。
"use strict";

// 用到的模型文件：dir = ComfyUI/models 下的文件夹；repo + path 是 Hugging Face 上的位置（国内走 hf-mirror.com）。
// pick：同一个仓库里有好几种量化版本时，按显存挑一个（从前往后找第一个存在的），文件名到老师电脑上再按仓库列表确定。
const MODELS = {
  qwenEdit: { dir: "diffusion_models", name: "qwen_image_edit_2511_fp8mixed.safetensors", repo: "Comfy-Org/Qwen-Image-Edit_ComfyUI", path: "split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors", size: 20.4e9, license: "Apache-2.0" },
  qwenClip: { dir: "text_encoders", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", repo: "Comfy-Org/HunyuanVideo_1.5_repackaged", path: "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors", size: 9.4e9, license: "Apache-2.0" },
  qwenVae: { dir: "vae", name: "qwen_image_vae.safetensors", repo: "Comfy-Org/Qwen-Image_ComfyUI", path: "split_files/vae/qwen_image_vae.safetensors", size: 0.25e9, license: "Apache-2.0" },
  qwenFast: { dir: "loras", name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", repo: "lightx2v/Qwen-Image-Edit-2511-Lightning", path: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", size: 0.85e9, license: "Apache-2.0" },
  wanI2V: { dir: "diffusion_models", repo: "city96/Wan2.1-I2V-14B-480P-gguf", folder: "", pick: { 24: ["Q8_0", "Q6_K", "Q5_K_M"], 16: ["Q5_K_M", "Q4_K_M"], 0: ["Q4_K_M", "Q4_K_S", "Q3_K_M"] }, ext: ".gguf", name: "wan2.1-i2v-14b-480p-Q4_K_M.gguf", size: 11.3e9, license: "Apache-2.0" },
  talkModel: { dir: "diffusion_models", repo: "Kijai/WanVideo_comfy_GGUF", folder: "InfiniteTalk", pick: { 0: ["Single_Q8", "Single_Q6", "Single_Q4"] }, ext: ".gguf", name: "Wan2_1-InfiniteTalk_Single_Q8.gguf", size: 2.65e9, license: "Apache-2.0" },
  wanVae: { dir: "vae", name: "Wan2_1_VAE_bf16.safetensors", repo: "Kijai/WanVideo_comfy", path: "Wan2_1_VAE_bf16.safetensors", size: 0.25e9, license: "Apache-2.0" },
  umt5: { dir: "text_encoders", name: "umt5-xxl-enc-fp8_e4m3fn.safetensors", repo: "Kijai/WanVideo_comfy", path: "umt5-xxl-enc-fp8_e4m3fn.safetensors", size: 6.7e9, license: "Apache-2.0" },
  fastVideo: { dir: "loras", name: "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", repo: "Kijai/WanVideo_comfy", path: "Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", size: 0.74e9, license: "Apache-2.0" },
  clipVision: { dir: "clip_vision", name: "clip_vision_h.safetensors", repo: "Comfy-Org/Wan_2.1_ComfyUI_repackaged", path: "split_files/clip_vision/clip_vision_h.safetensors", size: 1.26e9, license: "MIT" },
  wav2vec: { dir: "wav2vec2", name: "wav2vec2-chinese-base_fp16.safetensors", repo: "Kijai/wav2vec2_safetensors", path: "wav2vec2-chinese-base_fp16.safetensors", size: 0.19e9, license: "Apache-2.0" },
};
// 每个功能要哪些模型
const NEEDS = {
  portrait: ["qwenEdit", "qwenClip", "qwenVae", "qwenFast"],
  talk: ["wanI2V", "talkModel", "wanVae", "umt5", "fastVideo", "clipVision", "wav2vec"],
};
// 要装进 ComfyUI/custom_nodes 的插件（固定版本，换版本前要重新跑 test/workflows-check.js）
const NODE_PACKS = [
  { dir: "ComfyUI-WanVideoWrapper", repo: "kijai/ComfyUI-WanVideoWrapper", commit: "088128b224242e110d3906c6750e9a3a348a659b", license: "Apache-2.0", for: "talk", check: ["WanVideoImageToVideoMultiTalk", "MultiTalkWav2VecEmbeds"] },
  { dir: "ComfyUI-VideoHelperSuite", repo: "Kosinkadink/ComfyUI-VideoHelperSuite", commit: "4d907bee61e92c2e65af3bd6383a4e4d356126d1", license: "GPL-3.0", for: "talk", check: ["VHS_VideoCombine"] },
];
// ComfyUI 本体至少要有这些（Qwen-Image-Edit-2511 要 2025 年 12 月以后的版本）
const CORE_NODES = ["TextEncodeQwenImageEditPlus", "FluxKontextMultiReferenceLatentMethod", "CFGNorm", "ModelSamplingAuraFlow", "EmptySD3LatentImage"];

// ---- 画风：都是「像本人 + 可爱」，区别在质感 ----
const STYLES = {
  toy: { name: "盲盒手办", text: "an adorable chibi 3D collectible figure in premium designer blind-box toy style: smooth matte vinyl material, soft rounded shapes, soft studio lighting with a subtle rim light, polished and clean" },
  film: { name: "3D 动画电影", text: "an adorable chibi character in high-end 3D animated feature film style: soft subsurface skin shading, expressive appealing face, warm cinematic soft lighting, polished render" },
  anime: { name: "日系动漫", text: "an adorable chibi character in clean Japanese anime illustration style: crisp line art, soft cel shading, bright clear colors, kawaii" },
};
const KEEP_ID =
  "Keep this person clearly recognizable: the same face shape, the same hairstyle, hair length, parting and hair color, the same eyebrows, the same eye shape, the same facial hair if any, the same glasses if any, the same skin tone, and the same clothing style and colors.";
const BODY =
  "Chibi proportions: big head about one third of the total height, small cute body, short arms and legs. Big bright eyes with soft highlights, small nose, a gentle friendly smile with the mouth closed, a light natural blush.";
const FRAME =
  "Full body, standing upright and facing the camera, arms relaxed at the sides, both hands visible, feet together. The whole figure is visible from the top of the head to the shoes, centered, with clear space above the head and below the feet. Plain pure white background, no shadow on the background, no text, no logo, no props, no frame.";
const NEG_IMG = "realistic photo, photorealistic skin, wrinkles, skin pores, uncanny, creepy, scary, deformed face, asymmetrical eyes, extra fingers, extra limbs, bad anatomy, cropped, cut off feet, cut off head, text, watermark, logo, frame, busy background, dark lighting, blurry, low quality";

function portraitPrompt(style, extra) {
  const s = STYLES[style] || STYLES.toy;
  const add = String(extra || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `Turn the person in image 1 into ${s.text}. ${KEEP_ID} ${BODY} ${FRAME}${add ? " Also: " + add + "." : ""}`;
}
// 只改一个部位：其他像素尽量不动，后面只取变了的那一块贴回原图
const VARIANTS = {
  mouthHalf: "Keep everything in image 1 exactly the same: the same character, pose, size, position, lighting, colors and background. Only change the mouth: slightly open while talking, as if saying \"eh\", showing a little of the upper teeth. Do not move the head and do not change the eyes.",
  mouthOpen: "Keep everything in image 1 exactly the same: the same character, pose, size, position, lighting, colors and background. Only change the mouth: open wide while talking, as if saying \"ah\". Do not move the head and do not change the eyes.",
  eyesClosed: "Keep everything in image 1 exactly the same: the same character, pose, size, position, lighting, colors and background. Only change the eyes: both eyes gently closed in a relaxed blink, with soft curved eyelid lines. Do not move the head and do not change the mouth.",
};

// ---- 说话视频的文字描述：动作写在这里（音频管嘴，文字管动作） ----
const TALK_BASE = "A cute chibi cartoon character stands facing the camera and talks warmly like a friendly teacher explaining a lesson, natural lip movement synced to the speech, gentle head movements, lively friendly expression, plain white background, static camera, full body in frame.";
const TALK_ACT = {
  auto: "occasional small natural hand gestures while talking.",
  wave: "At the beginning the character happily waves one hand to greet the audience, then keeps talking with small gestures.",
  point: "The character turns slightly and points to the side with one hand, as if pointing at a slide next to them, while talking.",
  gesture: "The character talks with lively expressive hand gestures, like explaining something interesting.",
  nod: "The character nods gently while talking, agreeing kindly.",
  think: "The character first touches the chin with one hand and looks up thoughtfully, then answers with a small smile.",
};
const NEG_VIDEO = "bright tones, overexposed, static, blurred details, subtitles, text, watermark, worst quality, low quality, JPEG artifacts, ugly, deformed, extra fingers, poorly drawn hands, poorly drawn face, fused fingers, messy background, three legs, walking backwards, camera movement, zoom";

// 显存 → 怎么省显存：WanVideoWrapper 一共 40 块，换出去越多越省显存、越慢
function plan(vramGB) {
  const v = +vramGB || 0;
  if (v >= 24) return { swap: 10, w: 576, h: 1024, offloadClip: false };
  if (v >= 16) return { swap: 25, w: 480, h: 832, offloadClip: false };
  return { swap: 40, w: 480, h: 832, offloadClip: true };
}

// ---- 节点图 ----
// file(name) 是老师电脑上确定下来的文件名（不同量化版本名字不同）
function qwenModel(g, file, fast) {
  g["1"] = { class_type: "UNETLoader", inputs: { unet_name: file("qwenEdit"), weight_dtype: "default" } };
  g["2"] = { class_type: "CLIPLoader", inputs: { clip_name: file("qwenClip"), type: "qwen_image", device: "default" } };
  g["3"] = { class_type: "VAELoader", inputs: { vae_name: file("qwenVae") } };
  g["4"] = { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3.1 } };
  let m = ["4", 0];
  if (fast) { g["5"] = { class_type: "LoraLoaderModelOnly", inputs: { model: m, lora_name: file("qwenFast"), strength_model: 1 } }; m = ["5", 0]; }
  g["6"] = { class_type: "CFGNorm", inputs: { model: m, strength: 1 } };
  return ["6", 0];
}
function qwenEdit(g, model, image, prompt, neg, latent, seed, fast) {
  g["20"] = { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["2", 0], vae: ["3", 0], image1: image, prompt } };
  g["21"] = { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["2", 0], vae: ["3", 0], image1: image, prompt: neg } };
  g["22"] = { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["20", 0], reference_latents_method: "index_timestep_zero" } };
  g["23"] = { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["21", 0], reference_latents_method: "index_timestep_zero" } };
  g["30"] = {
    class_type: "KSampler",
    inputs: { model, seed, steps: fast ? 4 : 40, cfg: fast ? 1 : 4, sampler_name: "euler", scheduler: "simple", positive: ["22", 0], negative: ["23", 0], latent_image: latent, denoise: 1 },
  };
  g["31"] = { class_type: "VAEDecode", inputs: { samples: ["30", 0], vae: ["3", 0] } };
}

// 照片 → Q版形象（竖图 768×1344；batch 张一起画，种子不同）
function portrait({ photo, style = "toy", extra = "", seed = 1, batch = 4, fast = true, width = 768, height = 1344, prefix = "laolao/portrait" }, file) {
  const g = {};
  const model = qwenModel(g, file, fast);
  g["10"] = { class_type: "LoadImage", inputs: { image: photo } };
  g["11"] = { class_type: "FluxKontextImageScale", inputs: { image: ["10", 0] } };
  g["12"] = { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: Math.max(1, Math.min(4, batch | 0)) } };
  qwenEdit(g, model, ["11", 0], portraitPrompt(style, extra), NEG_IMG, ["12", 0], seed >>> 0, fast);
  g["40"] = { class_type: "SaveImage", inputs: { images: ["31", 0], filename_prefix: prefix } };
  return g;
}

// 挑好的形象 → 只改嘴或眼睛（latent 用原图编码：输出和原图一样大、位置对得上）
function variant({ image, kind, seed = 7, fast = true, prefix = "laolao/variant" }, file) {
  if (!VARIANTS[kind]) throw new Error("没有这种图层：" + kind);
  const g = {};
  const model = qwenModel(g, file, fast);
  g["10"] = { class_type: "LoadImage", inputs: { image } };
  g["12"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["3", 0] } };
  qwenEdit(g, model, ["10", 0], VARIANTS[kind], NEG_IMG, ["12", 0], seed >>> 0, fast);
  g["40"] = { class_type: "SaveImage", inputs: { images: ["31", 0], filename_prefix: prefix + "-" + kind } };
  return g;
}

// 形象 + 配音 → 说话视频（只出画面；配音、「AI生成」标识和元数据由我们自己用 ffmpeg 合上）
function talk({ image, audio, seconds, act = "auto", vramGB = 12, seed = 2, prefix = "laolao/talk" }, file) {
  const p = plan(vramGB);
  const frames = Math.max(25, Math.ceil((+seconds || 1) * 25) + 1);
  const g = {};
  g["1"] = { class_type: "WanVideoBlockSwap", inputs: { blocks_to_swap: p.swap, offload_img_emb: p.offloadClip, offload_txt_emb: p.offloadClip, use_non_blocking: false, vace_blocks_to_swap: 0, prefetch_blocks: 1, block_swap_debug: false } };
  g["2"] = { class_type: "WanVideoLoraSelect", inputs: { lora: file("fastVideo"), strength: 1, low_mem_load: false, merge_loras: false } };
  g["3"] = { class_type: "MultiTalkModelLoader", inputs: { model: file("talkModel") } };
  g["4"] = {
    class_type: "WanVideoModelLoader",
    inputs: { model: file("wanI2V"), base_precision: "fp16", quantization: "disabled", load_device: "offload_device", attention_mode: "sdpa", block_swap_args: ["1", 0], lora: ["2", 0], multitalk_model: ["3", 0] },
  };
  g["5"] = { class_type: "WanVideoVAELoader", inputs: { model_name: file("wanVae"), precision: "bf16" } };
  g["6"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: file("clipVision") } };
  g["7"] = {
    class_type: "WanVideoTextEncodeCached",
    inputs: { model_name: file("umt5"), precision: "bf16", positive_prompt: TALK_BASE + " " + (TALK_ACT[act] || TALK_ACT.auto), negative_prompt: NEG_VIDEO, quantization: "fp8_e4m3fn", use_disk_cache: true, device: "gpu" },
  };
  g["8"] = { class_type: "Wav2VecModelLoader", inputs: { model: file("wav2vec"), base_precision: "fp16", load_device: "main_device" } };
  g["10"] = { class_type: "LoadImage", inputs: { image } };
  g["11"] = { class_type: "ImageScale", inputs: { image: ["10", 0], upscale_method: "lanczos", width: p.w, height: p.h, crop: "center" } };
  g["12"] = { class_type: "LoadAudio", inputs: { audio } };
  g["13"] = { class_type: "MultiTalkWav2VecEmbeds", inputs: { wav2vec_model: ["8", 0], audio_1: ["12", 0], normalize_loudness: true, num_frames: frames, fps: 25, audio_scale: 1, audio_cfg_scale: 1, multi_audio_type: "para" } };
  g["14"] = { class_type: "WanVideoClipVisionEncode", inputs: { clip_vision: ["6", 0], image_1: ["11", 0], strength_1: 1, strength_2: 1, crop: "center", combine_embeds: "average", force_offload: true, tiles: 0, ratio: 0.5 } };
  g["15"] = {
    class_type: "WanVideoImageToVideoMultiTalk",
    inputs: { vae: ["5", 0], width: p.w, height: p.h, frame_window_size: 81, motion_frame: 9, force_offload: false, colormatch: "mkl", start_image: ["11", 0], tiled_vae: p.offloadClip, clip_embeds: ["14", 0], mode: "infinitetalk", output_path: "" },
  };
  g["16"] = {
    class_type: "WanVideoSampler",
    inputs: { model: ["4", 0], image_embeds: ["15", 0], text_embeds: ["7", 0], multitalk_embeds: ["13", 0], steps: 6, cfg: 1, shift: 11, seed: seed >>> 0, force_offload: true, scheduler: "dpm++_sde", riflex_freq_index: 0, denoise_strength: 1, batched_cfg: false, rope_function: "comfy", start_step: 0, end_step: -1, add_noise_to_samples: false },
  };
  g["17"] = { class_type: "WanVideoPassImagesFromSamples", inputs: { samples: ["16", 0] } };
  g["18"] = {
    class_type: "VHS_VideoCombine",
    inputs: { images: ["17", 0], frame_rate: 25, loop_count: 0, filename_prefix: prefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 17, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true },
  };
  return g;
}

// 节点图里用到哪些节点（检查 ComfyUI 装没装全）
const classesOf = (g) => [...new Set(Object.values(g).map((n) => n.class_type))];

module.exports = { MODELS, NEEDS, NODE_PACKS, CORE_NODES, STYLES, VARIANTS, TALK_ACT, portrait, variant, talk, plan, portraitPrompt, classesOf };
