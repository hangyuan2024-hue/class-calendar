安卓 App 的功能图标（7.x）

· 图标用的是 Lucide 线条图标（ISC 许可，见 LICENSE-lucide.txt），和底部导航栏同一个风格。
· 对照表在 app/src/main/java/com/laolao/classcalendar/ui/Ic.kt：页面里写的表情 → 哪个图标、什么颜色。
· 图标文件是 app/src/main/res/drawable/ic_l_*.xml，由 gen.py 从 Lucide 的 SVG 转出来。

加一个图标：
  1. 在 gen.py 的 MAP 里加一行：("表情", "lucide 图标名", "颜色字母", "用途")
  2. 下载 Lucide 的 icons 文件夹（https://github.com/lucide-icons/lucide 里的 icons/）
  3. cp Ic.kt.tpl ../../app/src/main/java/com/laolao/classcalendar/ui/Ic.kt
     python3 gen.py <lucide/icons> ../../app/src/main/res/drawable ../../app/src/main/java/com/laolao/classcalendar/ui/Ic.kt

底部导航栏图标（tab_v_*.xml，选中时用 *_on 实心版）：
  python3 tabs.py <lucide/icons> ../../app/src/main/res/drawable
