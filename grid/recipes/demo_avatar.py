"""示例 · 生成 + 人工审核：每个小任务画两版 Q版小人（这里用程序画，真的会换成 AI 画），交给大家比「哪个更可爱」。
大家投的票就是以后训练「审美打分模型」的数据。"""
import os
import random
import time

from PIL import Image, ImageDraw

import lg

t = lg.task()
inp = t["input"]
p = t["job"]["params"]
seed = int(inp.get("i", 0))
work = lg.work_dir()

HAIR = [(40, 30, 30), (90, 55, 35), (20, 20, 25), (150, 100, 60), (60, 40, 80)]
SHIRT = [(230, 90, 90), (90, 150, 230), (110, 190, 140), (240, 190, 80), (170, 120, 220)]


def draw(r, big_eyes):
    W = 384
    im = Image.new("RGB", (W, W), (246, 243, 236))
    d = ImageDraw.Draw(im)
    hair, shirt = r.choice(HAIR), r.choice(SHIRT)
    cx, cy, R = W // 2, 150, 100 + r.randint(-6, 8)
    d.ellipse((cx - 70, 240, cx + 70, 380), fill=shirt)                       # 身子
    d.ellipse((cx - R - 6, cy - R - 10, cx + R + 6, cy + R - 10), fill=hair)  # 后面的头发
    d.ellipse((cx - R, cy - R + 10, cx + R, cy + R + 10), fill=(255, 224, 205))  # 脸
    d.pieslice((cx - R - 6, cy - R - 12, cx + R + 6, cy + R - 30), 180, 360, fill=hair)  # 刘海
    e = 22 if big_eyes else 13
    for sx in (-1, 1):
        ex = cx + sx * 42
        d.ellipse((ex - e * 0.8, cy + 25 - e, ex + e * 0.8, cy + 25 + e), fill=(45, 35, 40))
        d.ellipse((ex - e * 0.3, cy + 25 - e * 0.7, ex + e * 0.15, cy + 25 - e * 0.2), fill="white")
        d.ellipse((ex - 22 + sx * 8, cy + 58, ex + 6 + sx * 8, cy + 72), fill=(255, 170, 170))  # 腮红
    d.arc((cx - 14, cy + 50, cx + 14, cy + 72), 20, 160, fill=(150, 60, 70), width=4)  # 嘴
    return im


r = random.Random(seed)
paths = []
first_big = r.random() < 0.5
for k, big in (("a", first_big), ("b", not first_big)):
    f =os.path.join(work, f"avatar-{seed}-{k}-{'big' if big else 'small'}.png")
    draw(random.Random(seed * 7 + (k == "b")), big).save(f)
    lg.image(f, f"第 {seed + 1} 个 · {k.upper()}")
    lg.output(f)
    paths.append(f)
    lg.progress(len(paths) / 2)
    if p.get("sleep"):
        time.sleep(float(p["sleep"]))

lg.review(kind="ab", a=paths[0], b=paths[1], question=p.get("question", "哪个更可爱？"), need=int(p.get("reviewNeed", 2)))
lg.done(n=2)
