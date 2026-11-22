"""捞小智 · 看图反推工厂（练底座的「眼力」：画出来，再让它猜回去；标签是程序画图时就知道的，百分之百准，不要人）
三样（params.kinds）：
  · slide：程序随机写一页 PPT 的数据（版式、标题、要点、卡片、表格、代码……）→ 画成图 → 故意弄脏（拍歪、反光、模糊、压缩、截一半）
           → 训练「看图 → 写出这一页的数据」。练出来：拍一张别人的课件 / 投影，直接还原成能编辑的一页；改 PPT 时看得懂版面
  · doll：程序随机抽一组公仔特征（发型、刘海、发色、眼镜、上衣颜色……）→ 画成正面的卡通小人 → 训练「看图 → 写出特征」
  · photo（要 AI 画图引擎 ComfyUI）：按一组特征画一张「虚拟老师」的照片（虚构的人，不是任何真人）→ 训练「照片 → 公仔特征」
用 CPU 就能做（slide、doll 不要显卡、不要大模型）。看图的说法和捞捞PPT助手（pptassist/core/eyes.js）一字不差（测试里核对）。
每个小任务交一个数据包（zip：rows.jsonl + 图片）；每一轮的第一个小任务另外交一份固定的考卷（种子固定，每次都一样，rows 里标 exam）。
"""
import io
import json
import math
import os
import random
import time
import zipfile

import lg

# ==== 看图的说法（和 pptassist/core/eyes.js 一字不差，测试里核对）====
SLIDE_SYS = "你看一张 PPT 页面的图片（可能是截图，也可能是手机拍的屏幕或投影，会有点歪、反光、模糊），把这一页还原成能编辑的一页。\n只输出一个 JSON，不要别的字。字段：\n· layout：版式，bullets / cards / steps / compare / table / summary / section / statement / code / formula 之一（一条一条的要点 bullets；几个并列的小块 cards；从左到右的几步 steps；左右两栏 compare；表格 table；深色底的几条结论 summary；一部分的开头 section；一句话放大 statement；代码 code；大公式 formula）\n· title：标题，照着图上的字抄\n· 按版式写内容：bullets、summary 写 lines（每条要点一个字符串）；cards、steps 写 items（每项 {\"head\":小标题,\"body\":说明}）；compare 写 left、right（{\"head\":栏标题,\"lines\":[...]}）；table 写 table（每行一个数组，第一行是表头）；section、statement 写 sub；code 写 code 和 lang；formula 写 formula（LaTeX）\n图上的字一个不改地抄下来；看不清的字按最可能的写。"
SLIDE_ASK = "把这一页还原成 JSON。"
DOLL_SYS = "你看一张人物图片（照片或卡通形象），说出把这个人做成 Q版公仔要的几样特征。只看外表，不猜这个人是谁。\n只输出一个 JSON，不要别的字。字段和能填的值：\n· hairStyle：发型，short 短发 / bob 齐耳短发 / long 长发 / flare 外翻 / ponytail 马尾 / bun 丸子头 / curly 卷发\n· bangs：刘海，full 齐刘海 / side 斜刘海 / middle 中分 / none 没有刘海\n· hair：发色，黑 / 深棕 / 棕 / 栗 / 金 / 灰 / 白 / 米 / 红 / 橙 / 黄 / 绿 / 青 / 蓝 / 藏青 / 紫 / 粉 之一\n· glasses：戴不戴眼镜，true / false\n· top：上衣颜色，同上面的颜色名\n· bottom：pants 裤子 / skirt 裙子（看不到下半身就写 pants）\n· faceShape：脸型，round 圆脸 / oval 鹅蛋脸 / long 长脸 / square 方脸\n· eyeStyle：open 睁着眼 / smile 笑眯眯\n· earrings：戴不戴耳环，true / false"
DOLL_ASK = "这个人做成公仔是什么样？输出 JSON。"
PALETTE = {"黑": "1F1A17", "深棕": "3B2418", "棕": "6B4226", "栗": "8B4A2B", "金": "C9A15B", "灰": "8A8A8A", "白": "F2F2F2", "米": "E8DCC4", "红": "C0392B", "橙": "E67E22", "黄": "F1C40F", "绿": "27AE60", "青": "16A085", "蓝": "2E6FD8", "藏青": "1F2F5A", "紫": "8E44AD", "粉": "F28CB1"}
SLIDE_LAYOUTS = ["bullets", "cards", "steps", "compare", "table", "summary", "section", "statement", "code", "formula"]
DOLL = {"hairStyle": ["short", "bob", "long", "flare", "ponytail", "bun", "curly"], "bangs": ["full", "side", "middle", "none"], "faceShape": ["round", "oval", "long", "square"], "eyeStyle": ["open", "smile"], "bottom": ["pants", "skirt"]}
# ==== 看图的说法 结束 ====

# ---------------- 字体（Windows 上用系统自带的中文字体）----------------
FONT_CANDS = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc", "C:/Windows/Fonts/Deng.ttf",
              "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
              "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "/System/Library/Fonts/PingFang.ttc"]
MONO_CANDS = ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]


def fonts_found():
    return [f for f in FONT_CANDS if os.path.exists(f)], [f for f in MONO_CANDS if os.path.exists(f)]


# ---------------- 课本上的公开知识点（编页面用）----------------
TOPICS = [
    ("一元二次方程", ["判别式", "求根公式", "配方法", "因式分解", "韦达定理"]), ("勾股定理", ["直角三角形", "斜边", "勾股数", "逆定理", "面积法"]),
    ("二次函数", ["顶点", "对称轴", "开口方向", "最值", "图像平移"]), ("等差数列", ["公差", "通项公式", "前n项和", "等差中项", "递推"]),
    ("牛顿第二定律", ["加速度", "合力", "质量", "受力分析", "单位换算"]), ("欧姆定律", ["电流", "电压", "电阻", "串联电路", "并联电路"]),
    ("光合作用", ["叶绿体", "光反应", "暗反应", "二氧化碳", "影响因素"]), ("化学反应速率", ["浓度", "温度", "催化剂", "接触面积", "平均速率"]),
    ("议论文写作", ["论点", "论据", "论证方法", "开头结尾", "素材积累"]), ("古诗词鉴赏", ["意象", "意境", "修辞手法", "表达技巧", "思想感情"]),
    ("定语从句", ["关系代词", "关系副词", "先行词", "限制性", "非限制性"]), ("辛亥革命", ["武昌起义", "中华民国", "三民主义", "历史意义", "局限性"]),
    ("大气环流", ["三圈环流", "气压带", "风带", "季风", "气候影响"]), ("冒泡排序", ["相邻比较", "交换", "趟数", "时间复杂度", "优化"]),
    ("细胞分裂", ["有丝分裂", "减数分裂", "染色体", "纺锤体", "细胞周期"]), ("概率初步", ["随机事件", "古典概型", "频率", "互斥事件", "树状图"]),
]
LINE_T = ["{t}的概念要先记清楚", "用{t}解决实际问题", "{t}常见的错误要注意", "先画图，再找{t}", "{t}和课本例题对照着看", "做完题回头检查{t}", "{t}是这一节的重点", "考试常考{t}的变形", "{t}要多练几道题"]
BODY_T = ["一句话说清{t}是什么", "{t}的关键是找准条件", "从例题里总结{t}的规律", "{t}容易和相近的概念混"]
CODES = ["for (i = 0; i < n - 1; i++)\n  for (j = 0; j < n - 1 - i; j++)\n    if (a[j] > a[j + 1]) swap(&a[j], &a[j + 1]);",
         "while (lo <= hi) {\n  mid = (lo + hi) / 2;\n  if (a[mid] == x) return mid;\n  if (a[mid] < x) lo = mid + 1;\n  else hi = mid - 1;\n}",
         "def gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a"]
SLIDE_GEN = ["bullets", "bullets", "cards", "steps", "compare", "table", "summary", "section", "statement", "code"]


def slide_spec(R):
    topic, terms = R.choice(TOPICS)
    t = R.choice(terms)
    L = R.choice(SLIDE_GEN)
    fill = lambda s, x: s.replace("{t}", x)
    if L in ("bullets", "summary"):
        return {"layout": L, "title": "课堂小结" if L == "summary" and R.random() < 0.5 else R.choice(["%s是什么" % t, "理解%s" % t, "%s的要点" % t, "%s：%s" % (topic, t)]),
                "lines": [fill(s, R.choice(terms)) for s in R.sample(LINE_T, R.randint(3, 5))]}
    if L == "cards":
        return {"layout": L, "title": "%s的几个概念" % topic, "items": [{"head": x, "body": fill(R.choice(BODY_T), x)} for x in R.sample(terms, R.randint(3, 4))]}
    if L == "steps":
        hs = ["读题找条件", "写出" + t, "代入计算", "检查答案"][: R.randint(3, 4)]
        return {"layout": L, "title": "怎么用" + t, "items": [{"head": "第%s步" % "一二三四"[j], "body": h} for j, h in enumerate(hs)]}
    if L == "compare":
        a, b = R.sample(terms, 2)
        return {"layout": L, "title": "%s和%s" % (a, b), "left": {"head": a, "lines": [fill(R.choice(BODY_T), a), a + "的例子"]}, "right": {"head": b, "lines": [fill(R.choice(BODY_T), b), b + "的例子"]}}
    if L == "table":
        return {"layout": L, "title": topic + "知识表", "table": [["知识点", "要点"]] + [[x, fill(R.choice(BODY_T), x)] for x in R.sample(terms, R.randint(2, 4))]}
    if L == "section":
        return {"layout": L, "title": "第%s部分 %s" % ("一二三"[R.randint(0, 2)], t), "sub": topic}
    if L == "statement":
        return {"layout": L, "title": "记住" + t, "sub": fill(R.choice(BODY_T), t)}
    return {"layout": "code", "title": topic + "的代码", "code": R.choice(CODES), "lang": R.choice(["C", "Python"])}


# ---------------- 画一页 PPT ----------------
THEMES = [((255, 255, 255), (27, 36, 55), (47, 111, 237), (238, 243, 251)), ((252, 253, 251), (30, 43, 35), (46, 139, 87), (234, 243, 236)),
          ((255, 253, 249), (51, 36, 28), (200, 85, 61), (247, 237, 226)), ((255, 252, 253), (42, 31, 45), (162, 59, 114), (246, 235, 242)),
          ((16, 20, 28), (233, 237, 245), (91, 155, 255), (27, 34, 48)), ((31, 59, 51), (244, 241, 232), (246, 213, 92), (42, 74, 64))]


def draw_slide(spec, R, font_files, mono_files):
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1280, 720
    bg, ink, acc, soft = R.choice(THEMES)
    dark = spec["layout"] in ("summary", "section", "statement")
    if dark:
        bg, ink, soft = (min(60, acc[0] // 3), min(60, acc[1] // 3), min(70, acc[2] // 3 + 10)), (245, 245, 245), (70, 80, 100)
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    ff = R.choice(font_files)
    F = lambda s: ImageFont.truetype(ff, s)
    M = lambda s: ImageFont.truetype(R.choice(mono_files), s) if mono_files else F(s)

    def wrap(text, font, width):
        out, cur = [], ""
        for ch in text:
            if d.textlength(cur + ch, font=font) > width and cur:
                out.append(cur)
                cur = ch
            else:
                cur += ch
        if cur:
            out.append(cur)
        return out

    def para(x, y, text, size, width, color=ink, gap=1.35):
        f = F(size)
        for line in wrap(text, f, width):
            d.text((x, y), line, font=f, fill=color)
            y += int(size * gap)
        return y

    L = spec["layout"]
    if L in ("section", "statement"):
        f = F(R.choice([54, 60, 64]))
        tw = d.textlength(spec["title"], font=f)
        d.text(((W - tw) / 2, H * 0.36), spec["title"], font=f, fill=ink)
        f2 = F(30)
        sw = d.textlength(spec.get("sub", ""), font=f2)
        d.text(((W - sw) / 2, H * 0.36 + 100), spec.get("sub", ""), font=f2, fill=acc)
        d.rectangle([W / 2 - 60, H * 0.36 - 30, W / 2 + 60, H * 0.36 - 24], fill=acc)
        return im
    x0, y = 80, 60
    d.rectangle([x0 - 30, y + 6, x0 - 22, y + 50], fill=acc)
    y = para(x0, y, spec["title"], R.choice([40, 44, 48]), W - 2 * x0) + 30
    if L in ("bullets", "summary"):
        s = R.choice([28, 30, 32])
        for ln in spec["lines"]:
            d.ellipse([x0, y + s * 0.35, x0 + 12, y + s * 0.35 + 12], fill=acc)
            y = para(x0 + 30, y, ln, s, W - 2 * x0 - 30) + int(s * 0.5)
    elif L in ("cards", "steps"):
        n = len(spec["items"])
        gw = (W - 2 * x0 - (n - 1) * 24) / n
        for j, it in enumerate(spec["items"]):
            bx = x0 + j * (gw + 24)
            d.rounded_rectangle([bx, y, bx + gw, y + 300], radius=18, fill=soft)
            if L == "steps":
                d.ellipse([bx + 20, y + 20, bx + 64, y + 64], fill=acc)
                d.text((bx + 34, y + 26), str(j + 1), font=F(26), fill=(255, 255, 255))
                hy = y + 80
            else:
                d.rectangle([bx, y, bx + gw, y + 8], fill=acc)
                hy = y + 30
            yy = para(bx + 20, hy, it["head"], 28, gw - 40, acc)
            para(bx + 20, yy + 10, it["body"], 22, gw - 40)
    elif L == "compare":
        gw = (W - 2 * x0 - 40) / 2
        for j, side in enumerate(("left", "right")):
            bx = x0 + j * (gw + 40)
            d.rounded_rectangle([bx, y, bx + gw, y + 340], radius=16, fill=soft)
            yy = para(bx + 24, y + 20, spec[side]["head"], 30, gw - 48, acc) + 12
            for ln in spec[side]["lines"]:
                yy = para(bx + 24, yy, "· " + ln, 24, gw - 48) + 8
    elif L == "table":
        rows = spec["table"]
        cw = [(W - 2 * x0) * 0.32, (W - 2 * x0) * 0.68]
        rh = 64
        for r_i, row in enumerate(rows):
            cx = x0
            for c_i, cell in enumerate(row):
                d.rectangle([cx, y, cx + cw[c_i], y + rh], fill=acc if r_i == 0 else (soft if r_i % 2 else bg), outline=(200, 200, 200))
                d.text((cx + 16, y + 16), cell, font=F(24), fill=(255, 255, 255) if r_i == 0 else ink)
                cx += cw[c_i]
            y += rh
    elif L == "code":
        d.rounded_rectangle([x0, y, W - x0, H - 60], radius=14, fill=(30, 34, 44))
        yy = y + 24
        for ln in spec["code"].split("\n"):
            d.text((x0 + 28, yy), ln, font=M(26), fill=(220, 230, 240))
            yy += 38
        d.text((W - x0 - 120, y + 10), spec.get("lang", ""), font=F(22), fill=(150, 160, 180))
    if R.random() < 0.6:   # 页码、页脚
        d.text((W - 70, H - 40), str(R.randint(2, 30)), font=F(20), fill=(150, 150, 150))
    return im


# ---------------- 弄脏：像手机拍的屏幕、投影、截图 ----------------
def dirty(im, R, out_w):
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    W, H = im.size
    if R.random() < 0.55:   # 拍屏幕 / 投影：放在暗一点的背景上、透视歪一点
        bgc = tuple(R.randint(10, 90) for _ in range(3))
        k = R.uniform(0.72, 0.95)
        canvas = Image.new("RGB", (W, H), bgc)
        sw, sh = int(W * k), int(H * k)
        ox, oy = R.randint(0, W - sw), R.randint(0, H - sh)
        canvas.paste(im.resize((sw, sh)), (ox, oy))
        j = lambda: R.uniform(-0.05, 0.05)
        quad = [(W * j(), H * j()), (W * j(), H * (1 + j())), (W * (1 + j()), H * (1 + j())), (W * (1 + j()), H * j())]
        im = canvas.transform((W, H), Image.QUAD, [c for p in quad for c in p], resample=Image.BILINEAR, fillcolor=bgc)
    if R.random() < 0.3:   # 反光
        g = Image.new("L", (W, H), 0)
        gd = ImageDraw.Draw(g)
        cx, cy, r = R.randint(0, W), R.randint(0, H), R.randint(150, 500)
        for s in range(10, 0, -1):
            gd.ellipse([cx - r * s / 10, cy - r * s / 10, cx + r * s / 10, cy + r * s / 10], fill=int(110 * (1 - s / 10.5)))
        im = Image.composite(Image.new("RGB", (W, H), (255, 255, 255)), im, g)
    if R.random() < 0.15:   # 截了一半（下面少一块）
        im = im.crop((0, 0, W, int(H * R.uniform(0.8, 0.95))))
    im = ImageEnhance.Brightness(im).enhance(R.uniform(0.75, 1.2))
    im = ImageEnhance.Contrast(im).enhance(R.uniform(0.75, 1.2))
    if R.random() < 0.4:
        im = im.filter(ImageFilter.GaussianBlur(R.uniform(0.3, 1.4)))
    w = out_w
    im = im.resize((w, int(im.size[1] * w / im.size[0])))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=R.randint(40, 90))
    return buf.getvalue()


# ---------------- 画一个卡通小人（正面）----------------
SKINS = [(246, 214, 190), (240, 200, 170), (226, 180, 145), (200, 150, 115), (170, 120, 90)]


def doll_params(R, allow_bottom=True):
    hs = R.choice(DOLL["hairStyle"])
    return {"hairStyle": hs, "bangs": R.choice(DOLL["bangs"]), "hair": R.choice(["黑", "黑", "深棕", "棕", "栗", "金", "灰", "白", "红", "蓝", "紫", "粉"]),
            "glasses": R.random() < 0.35, "top": R.choice(list(PALETTE)), "bottom": R.choice(DOLL["bottom"]) if allow_bottom else "pants",
            "faceShape": R.choice(DOLL["faceShape"]), "eyeStyle": R.choice(DOLL["eyeStyle"]), "earrings": R.random() < 0.25}


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def draw_doll(P, R):
    from PIL import Image, ImageDraw
    W, H = 512, 640
    bgs = [(R.randint(200, 255), R.randint(200, 255), R.randint(200, 255)), (R.randint(20, 80),) * 3, tuple(R.randint(0, 255) for _ in range(3))]
    im = Image.new("RGB", (W, H), R.choice(bgs))
    d = ImageDraw.Draw(im)
    s = R.uniform(0.85, 1.1)
    cx, cy = W / 2 + R.uniform(-30, 30), 210 + R.uniform(-20, 20)
    hw, hh = {"round": (110, 110), "oval": (98, 118), "long": (90, 128), "square": (110, 108)}[P["faceShape"]]
    hw, hh = hw * s, hh * s
    hair, top, skin = hexrgb(PALETTE[P["hair"]]), hexrgb(PALETTE[P["top"]]), R.choice(SKINS)
    line = (40, 30, 30) if R.random() < 0.6 else None
    lw = R.randint(2, 4)
    # 身子、腿
    by = cy + hh * 0.95
    d.rounded_rectangle([cx - 80 * s, by, cx + 80 * s, by + 150 * s], radius=int(30 * s), fill=top, outline=line, width=lw)
    low = tuple(R.randint(30, 200) for _ in range(3))
    if P["bottom"] == "skirt":
        d.polygon([(cx - 75 * s, by + 145 * s), (cx + 75 * s, by + 145 * s), (cx + 105 * s, by + 215 * s), (cx - 105 * s, by + 215 * s)], fill=low, outline=line)
        for k in (-1, 1):
            d.rectangle([cx + k * 40 * s - 14 * s, by + 215 * s, cx + k * 40 * s + 14 * s, by + 260 * s], fill=skin, outline=line)
    else:
        for k in (-1, 1):
            d.rectangle([cx + k * 38 * s - 30 * s, by + 145 * s, cx + k * 38 * s + 30 * s, by + 260 * s], fill=low, outline=line, width=lw)
    # 后面的头发（长发、外翻、齐耳、马尾、丸子）
    hs = P["hairStyle"]
    if hs == "long":
        d.rounded_rectangle([cx - hw * 1.12, cy - hh * 0.4, cx + hw * 1.12, cy + hh * 1.9], radius=int(40 * s), fill=hair)
    elif hs == "flare":
        d.polygon([(cx - hw * 1.1, cy - hh * 0.2), (cx + hw * 1.1, cy - hh * 0.2), (cx + hw * 1.45, cy + hh * 1.35), (cx - hw * 1.45, cy + hh * 1.35)], fill=hair)
    elif hs == "bob":
        d.rounded_rectangle([cx - hw * 1.12, cy - hh * 0.5, cx + hw * 1.12, cy + hh * 0.95], radius=int(30 * s), fill=hair)
    elif hs == "ponytail":
        side = R.choice([-1, 1])
        d.ellipse([cx + side * hw * 0.9 - 30 * s, cy - hh * 0.6, cx + side * hw * 0.9 + 30 * s, cy + hh * 1.3], fill=hair)
        d.ellipse([cx + side * hw * 0.75 - 12 * s, cy - hh * 0.75, cx + side * hw * 0.75 + 12 * s, cy - hh * 0.5], fill=(220, 40, 60))
    elif hs == "bun":
        d.ellipse([cx - 45 * s, cy - hh * 1.55, cx + 45 * s, cy - hh * 0.75], fill=hair, outline=line)
    # 脸
    if P["faceShape"] == "square":
        d.rounded_rectangle([cx - hw, cy - hh, cx + hw, cy + hh], radius=int(35 * s), fill=skin, outline=line, width=lw)
    else:
        d.ellipse([cx - hw, cy - hh, cx + hw, cy + hh], fill=skin, outline=line, width=lw)
    # 头顶的头发 + 刘海
    d.chord([cx - hw * 1.08, cy - hh * 1.12, cx + hw * 1.08, cy - hh * 0.05], 180, 360, fill=hair)   # 头顶：到发际线为止（没有刘海就露出额头）
    if hs == "curly":
        for k in range(11):
            a = math.pi + k * math.pi / 10
            r = 26 * s
            px, py = cx + math.cos(a) * hw * 1.02, cy + math.sin(a) * hh * 1.0
            d.ellipse([px - r, py - r, px + r, py + r], fill=hair)
    b = P["bangs"]
    fy = cy - hh * 0.32
    if b == "full":
        d.rectangle([cx - hw * 0.88, cy - hh * 0.8, cx + hw * 0.88, fy], fill=hair)
    elif b == "side":
        d.polygon([(cx - hw * 0.9, cy - hh * 0.75), (cx + hw * 0.9, cy - hh * 0.75), (cx + hw * 0.9, cy - hh * 0.55), (cx - hw * 0.6, fy + 12 * s)], fill=hair)
    elif b == "middle":
        d.polygon([(cx - 4 * s, cy - hh * 0.95), (cx - hw * 0.95, cy - hh * 0.1), (cx - hw * 0.95, cy - hh * 0.75)], fill=hair)
        d.polygon([(cx + 4 * s, cy - hh * 0.95), (cx + hw * 0.95, cy - hh * 0.1), (cx + hw * 0.95, cy - hh * 0.75)], fill=hair)
    # 眼睛、眉毛、嘴、腮红
    ey, ex = cy + hh * 0.05, hw * 0.42
    for k in (-1, 1):
        x = cx + k * ex
        if P["eyeStyle"] == "smile":
            d.arc([x - 16 * s, ey - 10 * s, x + 16 * s, ey + 14 * s], 200, 340, fill=(40, 30, 30), width=max(3, lw + 1))
        else:
            d.ellipse([x - 13 * s, ey - 15 * s, x + 13 * s, ey + 15 * s], fill=(40, 30, 30))
            d.ellipse([x - 4 * s, ey - 10 * s, x + 4 * s, ey - 2 * s], fill=(255, 255, 255))
        d.line([x - 16 * s, ey - 30 * s, x + 16 * s, ey - 32 * s], fill=(60, 40, 35), width=max(3, lw))
        if R.random() < 0.8:
            d.ellipse([x - 18 * s, ey + 18 * s, x + 18 * s, ey + 30 * s], fill=(245, 160, 160))
        if P["glasses"]:
            d.ellipse([x - 28 * s, ey - 26 * s, x + 28 * s, ey + 26 * s], outline=(30, 30, 40), width=max(3, lw))
        if P["earrings"]:
            d.ellipse([cx + k * hw * 0.98 - 7 * s, cy + hh * 0.45, cx + k * hw * 0.98 + 7 * s, cy + hh * 0.45 + 14 * s], fill=(240, 200, 60))
    if P["glasses"]:
        d.line([cx - ex + 28 * s, ey, cx + ex - 28 * s, ey], fill=(30, 30, 40), width=max(3, lw))
    d.arc([cx - 18 * s, ey + 30 * s, cx + 18 * s, ey + 52 * s], 20, 160, fill=(170, 60, 60), width=max(3, lw))
    return im


def doll_dirty(im, R, out_w):
    from PIL import ImageEnhance, ImageFilter
    if R.random() < 0.4:
        im = im.rotate(R.uniform(-8, 8), fillcolor=im.getpixel((2, 2)))
    im = ImageEnhance.Brightness(im).enhance(R.uniform(0.8, 1.15))
    if R.random() < 0.3:
        im = im.filter(ImageFilter.GaussianBlur(R.uniform(0.3, 1.2)))
    im = im.resize((out_w, int(im.size[1] * out_w / im.size[0])))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=R.randint(50, 92))
    return buf.getvalue()


def compact(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))


def row(img_name, kind, target, exam=False):
    sys_, ask = (SLIDE_SYS, SLIDE_ASK) if kind == "slide" else (DOLL_SYS, DOLL_ASK)
    r = {"messages": [{"role": "system", "content": sys_}, {"role": "user", "content": [{"type": "image", "image": img_name}, {"type": "text", "text": ask}]},
                      {"role": "assistant", "content": compact(target)}], "kind": kind, "target": target}
    if exam:
        r["exam"] = True
    return r


def make(kind, seed, font_files, mono_files):
    R = random.Random(seed)
    if kind == "slide":
        spec = slide_spec(R)
        return spec, dirty(draw_slide(spec, R, font_files, mono_files), R, R.choice([640, 768, 896]))
    P = doll_params(R)
    return P, doll_dirty(draw_doll(P, R), R, R.choice([320, 384, 448]))


# ---------------- 按特征写一张「虚拟老师」照片的提示词（photo）----------------
EN_COLOR = {"黑": "black", "深棕": "dark brown", "棕": "brown", "栗": "chestnut", "金": "golden blonde", "灰": "gray", "白": "white", "米": "beige", "红": "red", "橙": "orange",
            "黄": "yellow", "绿": "green", "青": "teal", "蓝": "blue", "藏青": "navy blue", "紫": "purple", "粉": "pink"}
EN_HAIR = {"short": "short", "bob": "chin-length bob", "long": "long straight", "flare": "shoulder-length outward-flipped", "ponytail": "tied in a high ponytail with", "bun": "tied in a neat bun with", "curly": "curly"}
EN_BANGS = {"full": "straight-cut full bangs", "side": "side-swept bangs", "middle": "a middle part", "none": "no bangs, forehead visible"}
EN_FACE = {"round": "a round face", "oval": "an oval face", "long": "a long face", "square": "a square jaw"}


def photo_prompt(P, R):
    man = P["hairStyle"] in ("short", "curly") and P["bangs"] in ("none", "side") and not P["earrings"] and R.random() < 0.6
    hair = "%s %s hair" % (EN_HAIR[P["hairStyle"]], EN_COLOR[P["hair"]]) if P["hairStyle"] not in ("ponytail", "bun") else "%s hair %s %s" % (EN_COLOR[P["hair"]], EN_HAIR[P["hairStyle"]], EN_BANGS[P["bangs"]])
    if P["hairStyle"] not in ("ponytail", "bun"):
        hair += " with " + EN_BANGS[P["bangs"]]
    return ("A realistic upper-body photo of a fictional Chinese %s teacher in their %s, with %s, %s%s%s, wearing a %s %s, %s, looking at the camera, "
            "in front of a plain light wall. Natural daylight, sharp focus, ordinary smartphone photo." % (
                "man" if man else "woman", R.choice(["twenties", "thirties", "forties"]), hair, EN_FACE[P["faceShape"]],
                ", wearing glasses" if P["glasses"] else ", no glasses", ", small earrings" if P["earrings"] else "", EN_COLOR[P["top"]], R.choice(["shirt", "sweater", "blouse", "jacket", "hoodie"]),
                "a big smile with eyes squinting" if P["eyeStyle"] == "smile" else "a calm expression with eyes open"))


NEG_PHOTO = "cartoon, anime, 3d render, illustration, painting, deformed face, extra fingers, bad anatomy, text, watermark, logo, blurry, low quality"


def comfy_photo(prompt, sd, name):
    """和 qv_gen.py 的虚拟老师照片一样的节点图（Qwen-Image-Edit 4 步）"""
    m = lg.comfy("info")["models"]
    g = {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": m["qwenEdit"], "weight_dtype": "default"}},
         "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": m["qwenClip"], "type": "qwen_image", "device": "default"}},
         "3": {"class_type": "VAELoader", "inputs": {"vae_name": m["qwenVae"]}},
         "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.1}},
         "5": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["4", 0], "lora_name": m["qwenFast"], "strength_model": 1}},
         "6": {"class_type": "CFGNorm", "inputs": {"model": ["5", 0], "strength": 1}},
         "12": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}},
         "20": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt}},
         "21": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": NEG_PHOTO}},
         "22": {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["20", 0], "reference_latents_method": "index_timestep_zero"}},
         "23": {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["21", 0], "reference_latents_method": "index_timestep_zero"}},
         "30": {"class_type": "KSampler", "inputs": {"model": ["6", 0], "seed": sd, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple",
                                                      "positive": ["22", 0], "negative": ["23", 0], "latent_image": ["12", 0], "denoise": 1}},
         "31": {"class_type": "VAEDecode", "inputs": {"samples": ["30", 0], "vae": ["3", 0]}},
         "40": {"class_type": "SaveImage", "inputs": {"images": ["31", 0], "filename_prefix": "laolao-grid/" + name}}}
    r = lg.comfy("run", graph=g, kind="虚拟老师照片")
    files = [f for f in r.get("files", []) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    if not files:
        raise RuntimeError("AI 引擎没交图片")
    return files[0]


# ---------------- 开始 ----------------
def main():
    t = lg.task()
    p = t["job"]["params"]
    i = int(t["input"].get("i", 0))
    work = lg.work_dir()
    run_id = int(p.get("runId", 0))
    kinds = [k for k in (p.get("kinds") or ["slide", "doll"]) if k in ("slide", "doll", "photo")]
    PER = int(p.get("per", 64))
    t0 = time.time()
    ff, mf = fonts_found()
    if any(k in ("slide",) for k in kinds) and not ff:
        why = "这台电脑上没找到中文字体（微软雅黑 / 黑体），画不了 PPT 页面"
        getattr(lg, "unfit", lambda w: None)(why)
        raise RuntimeError(why)

    def pack(name, rows, imgs):
        f = os.path.join(work, name)
        with zipfile.ZipFile(f, "w", zipfile.ZIP_STORED) as z:
            z.writestr("rows.jsonl", "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
            for n, b in imgs:
                z.writestr(n, b)
        return f

    rows, imgs, n_kind = [], [], {}
    for k in range(PER):
        kind = kinds[k % len(kinds)]
        seed = run_id * 1000003 + i * 10007 + k
        if kind == "photo":
            R = random.Random(seed)
            P = doll_params(R, allow_bottom=False)
            try:
                f = comfy_photo(photo_prompt(P, R), seed % (2 ** 31), "visphoto")
            except Exception as e:
                lg.log("照片没画出来：%s" % str(e)[:160])
                continue
            from PIL import Image
            im = Image.open(f).convert("RGB")
            im = im.resize((448, int(im.size[1] * 448 / im.size[0])))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=88)
            name, target, b = "img/p%d.jpg" % seed, P, buf.getvalue()
            rows.append(row(name, "doll", target))
            rows[-1]["kind"] = "photo"
        else:
            target, b = make(kind, seed, ff, mf)
            name = "img/%s%d.jpg" % (kind[0], seed)
            rows.append(row(name, kind, target))
        imgs.append((name, b))
        n_kind[rows[-1]["kind"]] = n_kind.get(rows[-1]["kind"], 0) + 1
        if k % 8 == 0:
            lg.progress(k / float(PER), "画了 %d/%d 张" % (k, PER))
    if rows:
        lg.output(pack("vis-%d-%d.zip" % (run_id, i), rows, imgs))
    # 每一轮的第一个小任务：另外交一份固定的考卷（种子固定：每次都一模一样，新旧两版逐题比才公平）
    exam_n = 0
    if i == 0 and p.get("exam", True) and ff:
        er, ei = [], []
        for kind in ("slide", "doll"):
            for k in range(int(p.get("examN", 100))):
                seed = (7 if kind == "slide" else 11) * 10 ** 9 + k
                target, b = make(kind, seed, ff, mf)
                name = "exam/%s%d.jpg" % (kind[0], k)
                er.append(row(name, kind, target, exam=True))
                ei.append((name, b))
        lg.output(pack("vis-exam.zip", er, ei))
        exam_n = len(er)
    lg.log("画了 %d 张（%s）%s" % (len(rows), "、".join("%s %d" % kv for kv in sorted(n_kind.items())), "；另外交了 %d 道固定的考题" % exam_n if exam_n else ""))
    lg.metric(i, rows=len(rows), secs=time.time() - t0)
    lg.done(rows=len(rows), kinds=n_kind, exam=exam_n, secs=round(time.time() - t0, 1))


if os.environ.get("LG_TASK") or __name__ == "__main__":
    main()
