"""捞捞 Q版 · 整理 Q版插件的训练集（任何一台电脑都能跑，几分钟）
从大家到现在为止的审核里挑出「赢了的那张」：照片（参考图）+ 赢的 Q版（目标图）+ 当时用的提示词，打成一个压缩包。
  · 只要审核里明确选了 1 或 2 的；选「都不行」「差不多」的不要
  · 同一张照片只留一张
训 Q版插件（要 24G 以上显存，租卡）的时候直接用这个包。
"""
import json
import os
import shutil
import urllib.request
import zipfile

import lg

t = lg.task()
p = t["job"]["params"]
work = lg.work_dir()

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


def get(url, dest):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laolao-grid"}), timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


items = lg.dataset()
win, seen = [], set()
for it in items:
    pl, r = it.get("payload") or {}, it.get("result") or {}
    c = r.get("choice")
    if c not in ("a", "b") or not pl.get("refUrl") or not pl.get(c + "Url"):
        continue
    if pl.get("ref") in seen:
        continue
    seen.add(pl.get("ref"))
    win.append((it["id"], pl["refUrl"], pl[c + "Url"], (pl.get("meta") or {}).get("style", "toy")))
lg.log("审核 %d 条，能用的（明确选了一张）%d 组" % (len(items), len(win)))
if len(win) < int(p.get("minPairs", 50)):
    lg.done(skip="能用的还不够（%d 组，要 %d 组）" % (len(win), int(p.get("minPairs", 50))), pairs=len(win))
    raise SystemExit(0)

d = os.path.join(work, "set")
for sub in ("control", "target"):
    os.makedirs(os.path.join(d, sub), exist_ok=True)
meta = []
for k, (rid, ref, tgt, style) in enumerate(win):
    n = "%05d" % rid
    try:
        get(ref, os.path.join(d, "control", n + ".jpg"))
        get(tgt, os.path.join(d, "target", n + ".jpg"))
    except Exception as e:
        lg.log("第 %d 组下载失败，跳过：%s" % (k + 1, e))
        continue
    cap = qprompt(style if style in STYLES else "toy")
    with open(os.path.join(d, "target", n + ".txt"), "w", encoding="utf-8") as f:
        f.write(cap)
    meta.append({"id": rid, "style": style, "caption": cap})
    lg.progress((k + 1) / len(win), "下载第 %d/%d 组" % (k + 1, len(win)))
with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
zf = os.path.join(work, "qversion-train-set.zip")
with zipfile.ZipFile(zf, "w", zipfile.ZIP_STORED) as z:
    for root, _, fs in os.walk(d):
        for x in fs:
            z.write(os.path.join(root, x), os.path.relpath(os.path.join(root, x), d))
lg.log("训练集：%d 组（照片 → 赢的 Q版），打包好了" % len(meta))
lg.done(trainset=zf, pairs=len(meta))
