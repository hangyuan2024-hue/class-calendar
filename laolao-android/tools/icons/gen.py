"""Lucide SVG -> Android VectorDrawable, plus Ic.kt registry (emoji -> icon + color)."""
import re, sys, pathlib, xml.etree.ElementTree as ET

LU = pathlib.Path(sys.argv[1])          # lucide/icons
RES = pathlib.Path(sys.argv[2])         # app/src/main/res/drawable
KT = pathlib.Path(sys.argv[3])          # ui/Ic.kt

# emoji -> (lucide name, color key, 用途说明)
MAP = [
    # 学习
    ("📚", "book-open", "I", "课程表"),
    ("📘", "book", "B", "课程"),
    ("📖", "book-open-text", "G", "单词 / 功能介绍"),
    ("📕", "book-bookmark", "R", "错题本"),
    ("📒", "notebook", "A", "备忘录"),
    ("📝", "notebook-pen", "O", "作业 / 日记"),
    ("✏️", "pencil", "O", "编辑 / 记一件事"),
    ("✍️", "pen-line", "O", "手写 / 填写"),
    ("📋", "clipboard-list", "T", "导入 / 清单"),
    ("🎓", "graduation-cap", "I", "学校 / 复习排期"),
    ("🏫", "school", "I", "班级"),
    ("🧩", "puzzle", "V", "大作业拆解 / 小组件"),
    ("🐸", "list-todo", "G", "时间管理大师"),
    ("🎯", "target", "R", "规划与专注"),
    ("🏹", "goal", "R", "目标"),
    ("🍅", "timer", "R", "番茄钟"),
    ("⏱", "timer", "B", "计时"),
    ("⏳", "hourglass", "A", "倒计时 / 等待"),
    ("⏰", "alarm-clock", "O", "提醒时间"),
    ("🕘", "clock", "B", "时间"),
    ("📅", "calendar", "B", "日历"),
    ("🗓", "calendar-days", "B", "日期"),
    ("📲", "calendar-plus", "B", "加到手机日历"),
    # 班级
    ("💬", "message-circle", "G", "班级墙 / 一句话记事"),
    ("👥", "users", "B", "成员"),
    ("👤", "user", "S", "个人"),
    ("✨", "sparkles", "V", "整理群消息"),
    ("✦", "sparkle", "V", "神谕阁"),
    ("📢", "megaphone", "R", "发布 / 通知"),
    ("🏆", "trophy", "A", "排行榜"),
    ("🏅", "medal", "O", "等级与徽章"),
    ("⭐", "star", "A", "收藏 / 星标"),
    ("📊", "chart-column", "B", "统计"),
    ("📈", "trending-up", "G", "成长"),
    ("🔥", "flame", "O", "打卡 / 连续"),
    ("⚡", "zap", "A", "成长值 / 快速"),
    ("💡", "lightbulb", "A", "问问捞捞"),
    ("🤔", "circle-question-mark", "S", "疑问"),
    ("🐣", "sprout", "G", "云宠农场"),
    ("🎉", "party-popper", "P", "趣味 / 庆祝"),
    ("🎲", "dices", "V", "随机抽签"),
    ("💳", "wallet", "G", "记账本"),
    # 内容
    ("📷", "camera", "B", "拍照导入"),
    ("🖼", "image", "V", "图片"),
    ("📄", "file-text", "S", "文件"),
    ("📎", "paperclip", "S", "附件"),
    ("📌", "pin", "R", "置顶 / 班级墙"),
    ("📍", "map-pin", "R", "地点 / 签到"),
    ("🎒", "backpack", "O", "要带的东西"),
    ("🏷", "tag", "V", "标签"),
    ("🔍", "search", "S", "搜索"),
    ("👀", "eye", "B", "查看"),
    ("🙈", "eye-off", "S", "隐藏"),
    ("↗", "external-link", "S", "打开"),
    ("🗑", "trash", "R", "删除"),
    ("🚫", "ban", "R", "不允许"),
    ("✅", "circle-check", "G", "完成"),
    ("⏸", "pause", "S", "暂停"),
    ("➕", "plus", "I", "添加"),
    ("＋", "plus", "I", "添加（全角加号）"),
    ("🔁", "repeat", "T", "重复 / 调课"),
    ("🔄", "refresh-ccw", "T", "刷新"),
    ("↻", "refresh-cw", "T", "刷新"),
    ("☕", "coffee", "A", "空闲"),
    ("💤", "moon", "I", "休息"),
    ("📥", "inbox", "T", "收集 / 导入"),
    ("📭", "inbox", "S", "空"),
    ("📤", "upload", "B", "导出"),
    # 设置
    ("☁️", "cloud", "B", "云端同步"),
    ("🗄", "archive", "T", "备份与恢复"),
    ("🎨", "palette", "P", "外观"),
    ("🧭", "compass", "T", "捞捞教练"),
    ("🗂️", "folder-open", "I", "规划页"),
    ("🔔", "bell", "A", "提醒与通知"),
    ("📧", "mail", "B", "邮箱"),
    ("📮", "mailbox", "R", "邮箱 / 发件"),
    ("✉️", "mail-open", "P", "信箱"),
    ("🔐", "lock", "S", "账号与安全"),
    ("🔑", "key-round", "A", "密码"),
    ("🚪", "log-out", "R", "退出"),
    ("🧑\u200d🏫", "life-buoy", "T", "找老师帮忙"),
    ("🎛️", "sliders-horizontal", "I", "功能开关"),
    ("⚙️", "settings", "S", "设置 / 后台"),
    ("🧰", "layout-grid", "I", "工具"),
    ("💻", "laptop", "B", "电脑版"),
    ("💛", "heart", "P", "感谢"),
    ("🌐", "globe", "T", "网络线路"),
    ("⬆️", "circle-arrow-up", "G", "检查更新"),
    ("🔋", "battery-charging", "G", "省电"),
    ("🚀", "rocket", "V", "加速"),
    ("⇅", "arrow-left-right", "S", "切换班级"),
    ("⊞", "layout-grid", "B", "自定义首页"),
    # 7.x 习惯打卡的图标
    ("🏃", "footprints", "G", "跑步"),
    ("💧", "droplet", "B", "喝水"),
    ("🧘", "flower-2", "P", "冥想"),
    ("🎹", "piano", "V", "练琴"),
    ("😴", "moon", "I", "早睡"),
    ("🍎", "apple", "R", "吃水果"),
    ("🗣️", "languages", "T", "背单词 / 口语"),
    ("💪", "dumbbell", "O", "健身"),
    ("🧹", "brush-cleaning", "A", "打扫"),
    ("🧠", "brain", "P", "思考"),
    ("🌱", "sprout", "G", "成长"),
    ("☀️", "sun", "O", "早起"),
]

NUM = r"-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?"

def f(v): return float(v)
def fmt(x):
    s = ("%.3f" % x).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

ARGS = {"m": 2, "l": 2, "h": 1, "v": 1, "c": 6, "s": 4, "q": 4, "t": 2, "a": 7, "z": 0}

def normalize(d):
    """重新排版 path：圆弧的两个标志位（0/1）在 SVG 里可以挤在一起写（"0 011"），老安卓解析不了，这里全部拆开。"""
    out = []; i = 0; n = len(d); cmd = None
    def skip():
        nonlocal i
        while i < n and d[i] in " ,\t\n": i += 1
    def number():
        nonlocal i
        m = re.compile(NUM).match(d, i)
        if not m: raise ValueError(d[i:i+20])
        i = m.end(); return m.group(0)
    def flag():
        nonlocal i
        skip(); c = d[i]; assert c in "01", d[i:i+10]; i += 1; return c
    while True:
        skip()
        if i >= n: break
        if d[i].isalpha(): cmd = d[i]; i += 1; out.append(cmd)
            # z 没有参数
        k = ARGS[cmd.lower()]
        if k == 0: continue
        args = []
        for j in range(k):
            skip()
            args.append(flag() if cmd.lower() == "a" and j in (3, 4) else number())
        out.append(" ".join(args))
        if cmd == "m": cmd = "l"
        elif cmd == "M": cmd = "L"
    return " ".join(out)

def to_path(el):
    t = el.tag.split("}")[-1]; a = el.attrib
    if t == "path": return normalize(a["d"])
    if t == "circle":
        cx, cy, r = f(a["cx"]), f(a["cy"]), f(a["r"])
        return f"M{fmt(cx-r)},{fmt(cy)} a{fmt(r)},{fmt(r)} 0 1,0 {fmt(2*r)},0 a{fmt(r)},{fmt(r)} 0 1,0 {fmt(-2*r)},0"
    if t == "ellipse":
        cx, cy, rx, ry = f(a["cx"]), f(a["cy"]), f(a["rx"]), f(a["ry"])
        return f"M{fmt(cx-rx)},{fmt(cy)} a{fmt(rx)},{fmt(ry)} 0 1,0 {fmt(2*rx)},0 a{fmt(rx)},{fmt(ry)} 0 1,0 {fmt(-2*rx)},0"
    if t == "line":
        return f"M{a['x1']},{a['y1']} L{a['x2']},{a['y2']}"
    if t in ("polyline", "polygon"):
        p = re.findall(NUM, a["points"]); pts = list(zip(p[0::2], p[1::2]))
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        return d + (" Z" if t == "polygon" else "")
    if t == "rect":
        x, y, w, h = f(a.get("x", 0)), f(a.get("y", 0)), f(a["width"]), f(a["height"])
        rx = f(a.get("rx", a.get("ry", 0))); ry = f(a.get("ry", a.get("rx", 0)))
        rx = min(rx, w / 2); ry = min(ry, h / 2)
        if rx == 0: return f"M{fmt(x)},{fmt(y)} h{fmt(w)} v{fmt(h)} h{fmt(-w)} Z"
        return (f"M{fmt(x+rx)},{fmt(y)} h{fmt(w-2*rx)} a{fmt(rx)},{fmt(ry)} 0 0,1 {fmt(rx)},{fmt(ry)} v{fmt(h-2*ry)} "
                f"a{fmt(rx)},{fmt(ry)} 0 0,1 {fmt(-rx)},{fmt(ry)} h{fmt(-(w-2*rx))} a{fmt(rx)},{fmt(ry)} 0 0,1 {fmt(-rx)},{fmt(-ry)} "
                f"v{fmt(-(h-2*ry))} a{fmt(rx)},{fmt(ry)} 0 0,1 {fmt(rx)},{fmt(-ry)} Z")
    raise ValueError(t)

def res_name(n): return "ic_l_" + n.replace("-", "_")

def vector(name):
    root = ET.parse(LU / f"{name}.svg").getroot()
    out = ['<?xml version="1.0" encoding="utf-8"?>',
           f'<!-- Lucide「{name}」· ISC License · https://lucide.dev -->',
           '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
           '    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">']
    for el in root:
        d = to_path(el)
        fill = el.attrib.get("fill")
        fc = "#FF000000" if fill == "currentColor" else "#00000000"
        out.append(f'    <path android:pathData="{d}" android:fillColor="{fc}" android:strokeColor="#FF000000" '
                   'android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round"/>')
    out.append("</vector>")
    return "\n".join(out) + "\n"

names = sorted({m[1] for m in MAP})
for n in names:
    (RES / (res_name(n) + ".xml")).write_text(vector(n))

def kesc(s): return s.replace("\\", "\\\\").replace('"', '\\"').replace("\u200d", "\\u200D")
rows = "\n".join("        Def(\"%s\", R.drawable.%s, '%s'),   // %s" % (kesc(e), res_name(n), c, why) for e, n, c, why in MAP)
KT.write_text(KT.read_text().replace("/*@@MAP@@*/", rows))
print(len(MAP), "emoji ->", len(names), "icons")
