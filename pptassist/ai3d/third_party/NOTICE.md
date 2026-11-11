# 第三方代码和模型

这个文件夹里的东西不是我们写的，按各自的许可原样（或注明的改动）随软件分发。

| 文件夹 | 是什么 | 来源 | 许可 |
| --- | --- | --- | --- |
| `latentsync/` | LatentSync 1.5 口型同步的推理代码（只取了推理要用的文件：模型结构、推理流程、人脸对齐、whisper 音频特征） | [bytedance/LatentSync](https://github.com/bytedance/LatentSync) 提交 `a229c3948406bc2cf6eaf4873e662e70c6a04746` | Apache-2.0（见 `latentsync/LICENSE`） |
| `yunet/` | YuNet 人脸检测模型（`face_detection_yunet_2023mar.onnx`，SHA-256 `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`） | [opencv/opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT（见 `yunet/LICENSE`） |

**对 LatentSync 的改动**：文件本身一个字没改。`lao3d/talk.py` 在运行时把它的人脸检测（原来用 InsightFace，InsightFace 的预训练模型只许非商业研究用）换成 YuNet，
把读声音（原来用 decord）换成 soundfile，其余照原样调用。

**运行时才下载、不随软件分发的模型**（老师自己电脑上第一次用时下载，各自的许可跟着各自的项目）：

- LatentSync 1.5 权重 `ByteDance/LatentSync-1.5`（`latentsync_unet.pt`、`whisper/tiny.pt`）：CreativeML Open RAIL++-M。
  这个许可允许商用，但附带「使用限制」（附件 A）：不许用来冒充别人、未经同意生成别人的影像、散布虚假信息、骚扰等。
  捞捞PPT助手只许老师用自己的（或取得书面同意的人的）视频，生成的视频一律打「AI生成」标识，就是为了守这些限制。
- whisper tiny（OpenAI）：MIT。
- `stabilityai/sd-vae-ft-mse`：MIT。
