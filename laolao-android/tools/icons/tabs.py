"""底部导航栏图标（7.x）：Lucide 线条图标 → tab_v_*.xml（没选中）和 tab_v_*_on.xml（选中：线条稍粗，封闭的形状里填一层淡色）。
用法：python3 tabs.py <lucide/icons> ../../app/src/main/res/drawable
颜色在代码里用 setColorFilter 染（没选中灰色、选中主题色），这里统一写黑色。"""
import sys, pathlib, xml.etree.ElementTree as ET
src = open(pathlib.Path(__file__).with_name("gen.py"), encoding="utf-8").read()
ns = {}
sys_argv = sys.argv
sys.argv = [sys.argv[0], sys_argv[1], sys_argv[2], "/dev/null"]
exec(src.split("names = sorted")[0], ns)          # 借用 gen.py 里的 to_path / normalize
LU = pathlib.Path(sys_argv[1]); RES = pathlib.Path(sys_argv[2])
TABS = {"home": "house", "homework": "file-text", "growth": "chart-no-axes-combined", "tools": "layout-grid", "me": "user"}
# 选中时哪些形状填淡色：封闭的（以 z 结尾、方块、圆），外加「我的」身体那一段
FILL_EXTRA = {("user", 0)}
def build(tab, name, on):
    root = ET.parse(LU / f"{name}.svg").getroot()
    out = ['<?xml version="1.0" encoding="utf-8"?>',
           f'<!-- 底栏「{tab}」{"选中" if on else ""} · Lucide「{name}」· ISC License · https://lucide.dev -->',
           '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
           '    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">']
    for i, el in enumerate(root):
        d = ns["to_path"](el); t = el.tag.split("}")[-1]
        closed = t in ("rect", "circle", "ellipse", "polygon") or d.strip().lower().endswith("z") or (name, i) in FILL_EXTRA
        fc = "#3D000000" if (on and closed) else "#00000000"
        out.append(f'    <path android:pathData="{d}" android:fillColor="{fc}" android:strokeColor="#FF000000" '
                   f'android:strokeWidth="{"2.3" if on else "1.9"}" android:strokeLineCap="round" android:strokeLineJoin="round"/>')
    out.append("</vector>")
    return "\n".join(out) + "\n"
for tab, name in TABS.items():
    (RES / f"tab_v_{tab}.xml").write_text(build(tab, name, False))
    (RES / f"tab_v_{tab}_on.xml").write_text(build(tab, name, True))
print("ok", len(TABS) * 2, "files")
