# 捞捞形象工坊（lao3d）：老师照片 + 参考图 → 会动的 3D 公仔

捞捞PPT助手「我的形象」页最下面的「AI 生成 3D 形象」调的就是这里。全部在老师自己的电脑上跑，生成过程不联网（第一次要下载模型）。

## 四步

| 步骤 | 做什么 | 用什么 | 要显卡吗 |
| --- | --- | --- | --- |
| 1. 公仔立绘 `stylize.py` | 老师照片（定长相）+ 参考图（定风格）→ 几张正面全身的 Q版公仔图（2～2.5 头身、大头小身子、表面光滑），老师挑一张 | 阿里 Qwen-Image-Edit-2509（Apache-2.0），nunchaku 4bit 量化版（SVDQuant）；16G 内存时读图那部分（Qwen2.5-VL 7B）也用 4bit，算完就放掉 | 要（12G 显存够） |
| 2. 3D 模型 `to3d.py` | 立绘 → 带贴图的 3D 模型（先长造型，再按图上色） | 腾讯 Hunyuan3D-2（Hunyuan3D-2GP 的 mmgp 省显存方式） | 要（12G 显存够） |
| 3. 磨皮 + 绑骨骼 `smooth.py`、`rig.py` | 把表面的小台阶、褶皱磨平；找关节 + 算每块皮跟哪根骨头动 | 自己写的（见下） | 不要 |
| 4. 会眨眼、会说话 `face.py` | 找眼睛和嘴，抠成小图；贴图上原来的地方补成皮肤 | 自己写的（见下） | 不要 |

已经有满意的公仔图（比如用豆包做的），可以跳过第 1 步，直接从第 2 步开始。

## 真人数字人 `talk.py`（老师视频 + 配音 → 对口型）

- 模型：LatentSync 1.5（字节跳动，代码 Apache-2.0、权重 CreativeML Open RAIL++-M，推理最少 8G 显存，3060 够用）。推理代码原样放在 `third_party/latentsync`（只取推理要的文件，见 `third_party/NOTICE.md`），权重第一次用时从 Hugging Face（连不上就 hf-mirror）下到整合包旁边的 `lao3d_talk/checkpoints`。
- 换掉的两处（运行时替换，原文件没改）：人脸检测原来用 InsightFace（它的预训练模型只许非商业研究用）→ OpenCV 的 YuNet（MIT，模型随软件带）：YuNet 给两眼和鼻尖，LatentSync 的对齐模板就是 StyleSync 的「两眼 + 鼻子」模板往上挪、两边放宽，所以眉毛中心 = 眼睛往上 0.27 个眼距、横向放宽 41/37 倍，鼻子中间 = 两眼连线往下 0.27 个眼距；读声音原来用 decord（新 Python 装不上）→ soundfile。
- 模板（PPT 助手从老师视频里正对镜头的那几秒裁出来，720×1280、25 帧）比配音短就来回放（正着放完倒着放）；配音长就按停顿切成不超过 16 秒的段分别做（省内存），每段接着上一段模板的位置，最后接起来。叠「AI生成」、写 AIGC 元数据、配上原配音是 PPT 助手（ffmpeg）做的。
- 依赖装在 `lao3d_talk/libs`（全部 `--no-deps`，不动整合包的 torch / numpy），只在这个进程里优先用：diffusers 0.32.2、omegaconf、einops、kornia、DeepCache、ffmpeg-python、soundfile、imageio。
- **还没在真的显卡上跑过**；不用显卡的部分（来回放、按停顿切、YuNet 换 InsightFace 的点、命令行）有测试。

## 自己写的两步

**磨皮**（`smooth.py`）：生成的模型表面常有一圈圈小台阶和褶皱（从体素抽面留下的）。贴图接缝处重合的点先合起来，用 Taubin 平滑（一步收、一步放，体积基本不缩）磨，而且只沿法线方向挪点，点不在表面上滑，贴图不跑位；磨几遍按网格疏密定（`--smooth` 调力度）。磨完法线也按合起来的点算，接缝处没有一道线。

**绑骨骼**（`rig.py`）：

1. 摆正：脚踩 y=0、身高统一 1.25。比较头部正面、背面的皮肤色多少，背对着的就转过来。
2. 看正面剪影（1200 像素高，软件光栅化 `raster.py`），从脚往上一行行看：两段合成一段的地方是裆部（两条腿并在一起、分不出来时，按 A 字站姿两只手尖的高度估裆部——Q版公仔手短，手尖正好在胯边上）。身子两边单独的、一直垂到下面的是胳膊（最低处是手），垂到肩膀附近就停的是头发。腋下到头顶之间最窄的地方是脖子。上臂贴着身子时，顺着胳膊外侧的轮廓往上走，到肩膀顶上轮廓急转弯为止。
3. 关节的前后位置（z）从实心体素里取：沿 z 打射线数穿过几层皮，不膨胀，腿缝、胳膊缝都留着。
4. 蒙皮用体积测地线（Geodesic Voxel Binding 的思路）：每根骨头在实心体里走最短路，权重是距离的 -6 次方，取最大的 4 个，再在皮上抹匀两次。贴图接缝处重合的点先合起来算。胳膊和身子贴在一起分不开时，在胳膊内侧切一刀，身子侧面的皮不跟胳膊动。

**会眨眼、会说话**（`face.py`）：

1. 给头拍一张正交的正面照（按贴图上色）。
2. 找脸：最大的一块皮肤色。脸里面深色、左右对称、差不多一样大的一对是眼睛（有两对就要靠下那对，上面那对是眉毛），下面中间深色或偏红的是嘴。找得不准，老师在这张照片上点三下纠正（`--hints`）。
3. 眼睛和嘴原样抠下来，存成带透明边的小图，放在 glb 的 extras 里。
4. 先在正面照上把眼睛和嘴补成皮肤（OpenCV inpaint），再把贴图上落在那里的像素换成补好的颜色。三角形之间的缝也一起改，免得把原来的眼睛渗出来。

播放时（`renderer/avatar3d.js` 的 `buildAi`），脸上贴一层跟着同一套骨骼动的透明画布，把眼睛和嘴画回原位。平时和生成的一模一样；眨眼时眼睛压扁，说话时嘴换成张开的样子，挥手时眯成笑眼。胳膊的动作按这个模型自己的胳膊长度用两节骨头的 IK 现算：挥手是手举到头旁边左右摆，指幻灯片是往左上方伸，想一想是手送到下巴底下。

## 命令

捞捞PPT助手在 `ai3d/` 目录里用整合包的 Python 跑 `python -m lao3d.run …`。标准输出里以 `@@` 开头的一行是一条 JSON 消息：`stage`、`p`（0～1）、`msg`，最后一条带 `done` 或 `error`。

```
python -m lao3d.run check  [--hy 整合包]        看环境
python -m lao3d.run setup  [--hy 整合包]        装缺的组件（国内自动用清华 pip 源、hf-mirror）
python -m lao3d.run stylize --photo 照片 [--style 参考图] --out 文件夹 [--n 3] [--quality best|fast] [--clothes photo|style]
python -m lao3d.run to3d   --image 立绘 --out raw.glb --hy 整合包 [--quality best|fast] [--seed 1234]
python -m lao3d.run build  --src raw.glb --out 文件夹 [--smooth 1]   磨皮 + 绑骨骼 + 做脸 → avatar.glb（--smooth 2 磨得更狠，0 不磨）
python -m lao3d.run face   --out 文件夹 --hints '{"e1":[x,y],"e2":[x,y],"mouth":[x,y]}'
python -m lao3d.run talk-setup --hy 整合包                     装真人数字人的组件、下模型
python -m lao3d.run talk   --hy 整合包 --template 模板.mp4 --audio 配音.wav --out 出来.mp4 [--quality best|fast]
```

`stylize` 多一个 `--extra 侧面.jpg,背面.jpg`：视频里挑出来的侧面 / 背面拼成一张当第 3 张图，提示词让发型的长短、扎法、后脑勺照着它。

## 输出：avatar.glb

一个 glb 文件，大约 5MB：

- 网格和贴图（眼睛、嘴已经补成皮肤）。
- 17 根骨头：hips、spine、chest、neck、head、shoulder/elbow/wrist、hip/knee/ankle（`_L` 是模型自己的左边 +x，`_R` 是 -x）。关节在模型空间里都不转，只平移。
- 蒙皮。
- `extras.lao`：身高、关节位置、手尖 / 脚尖 / 头顶、裆部和脖子的高度、提醒（`warn`）、脸（脸框、两只眼睛和嘴的框、颜色、抠下来的小图、头部正面照的换算参数）。

## 测试

`python -m unittest discover -s ai3d/tests`。用几个球和圆柱拼的假公仔（`tests/fake_doll.py`，头上画了眼睛和嘴）测找关节（也测两条腿并在一起的）、蒙皮、磨皮（疙瘩磨掉、体积不变、贴图坐标不动）、找眼睛和嘴、补贴图、转身、点三下纠正、命令行。不用显卡，CI 里每次都跑。

第 1、2 步要显卡，只按官方代码写好了（diffusers 的 `QwenImageEditPlusPipeline`、nunchaku 的示例、Hunyuan3D-2GP 的 `gradio_app.py`）。**还没在真的 3060 上跑过**，第一次跑出问题，看工坊的日志（PPT 助手里出错时会带上最后几行）。

## 许可

模型不随软件分发，老师自己下载，各自的许可跟着各自的项目：Qwen-Image-Edit-2509（Apache-2.0）、nunchaku（Apache-2.0）、Hunyuan3D-2（Tencent Hunyuan Community License，适用地区不含欧盟、英国、韩国）、mmgp（以它自己的仓库为准）、LatentSync 1.5 权重（CreativeML Open RAIL++-M，附带使用限制：不得冒充他人、不得未经同意生成他人影像等）、whisper tiny（MIT）、sd-vae-ft-mse（MIT）。随软件带的：LatentSync 推理代码（Apache-2.0）、YuNet（MIT），见 `third_party/NOTICE.md`。只许非商业使用的（InsightFace、Wav2Lip 等）一概不用。
