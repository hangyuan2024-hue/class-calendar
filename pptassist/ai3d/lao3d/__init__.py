# 捞捞 · 3D 形象工坊（lao3d）：老师照片 + 参考图 → 会动的 3D 公仔
#   stylize.py  照片 + 参考图 → 公仔立绘（Qwen-Image-Edit-2509，4bit，要显卡）
#   to3d.py     立绘 → 带贴图的 3D 模型（Hunyuan3D-2，要显卡）
#   rig.py      自动绑骨骼：找关节 + 体积测地线蒙皮（自己写的，不用显卡）
#   face.py     找眼睛和嘴、抠出来、贴图补皮肤（自己写的，不用显卡）
#   glb.py      读写 .glb；raster.py 软件光栅化；build.py 把 3、4 串起来；run.py 命令行
__version__ = "1.0.0"
