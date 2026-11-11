# 捞捞编程 · 皮肤商店

捞捞编程「画出来」的 3D 舞台上，数组里每个数是一个「数据小兵」。皮肤商店可以把小兵换成别的样子，比如老师的分身：每个数是一根发光的柱子（越大越高），老师的公仔分身（大头手办的样子，发型、发色、衣服颜色照着老师来）站在柱子顶上；正在比较的会托腮想一想，交换的会挥手。小人的模型和捞捞PPT助手是同一个（`coder/renderer/avatar3d.js`，和 `pptassist/renderer/avatar3d.js` 保持一样）。

皮肤商店里的皮肤就放在这个文件夹里。网站更新后，所有同学打开捞捞编程 →「画出来」→ 右上角「皮肤」就能看到。

## 一个皮肤 = 一个 .json 文件

皮肤只是一份数据，**不能带代码**。不认识的字段会被忽略，颜色写错了用默认色。文件不超过 80KB（带照片脸时）。

```json
{
  "id": "c-teacher",
  "name": "C 语言老师",
  "author": "你的名字",
  "version": "1.0.0",
  "desc": "一句话介绍（120 字以内）",
  "model": "person",
  "person": {
    "skin": "#f3c2a2",
    "hair": "#2a1b14",
    "hairStyle": "bob",
    "bangs": "full",
    "glasses": true,
    "glassesColor": "#3b3b46",
    "top": "#f3f5fb",
    "bottom": "pants",
    "pants": "#3b4a6b",
    "collar": "#ffffff",
    "shoes": "#2f3650",
    "eye": "#2b1d18",
    "blush": true,
    "earrings": false,
    "accent": "#22d3ee",
    "antenna": true,
    "earpods": true
  },
  "colors": { "body": "#7c8cf0", "cmp": "#22d3ee", "swap": "#f472b6", "sorted": "#84cc16", "pivot": "#f59e0b" }
}
```

| 字段 | 说明 |
|---|---|
| `id` | 字母、数字、`-`、`_`，最多 40 个字符，上架后不要改 |
| `name` / `author` / `desc` / `version` | 商店卡片上显示的名字、作者、介绍、版本号 |
| `model` | `"robot"`：原版小机器人（只换颜色）；`"person"`：老师的机器人分身 |
| `person.skin` | 皮肤颜色 |
| `person.hair` / `hairStyle` | 头发颜色；发型：`none` 不要头发（机器人头）、`flare` 外翻长发、`long` 长直发、`bob` 波波头、`short` 短发、`ponytail` 马尾、`bun` 丸子头、`curly` 卷发 |
| `person.bangs` / `eyeStyle` | 刘海：`middle` 中分、`full` 齐刘海、`side` 斜刘海、`none` 没有刘海；眼睛（面罩上发光）：`open` 圆眼、`smile` 弯弯的笑眼 |
| `person.glasses` / `glassesColor` | 戴不戴眼镜、镜框颜色 |
| `person.skin` 之外：`top` / `pants` / `shoes` | 上身外壳、下身外壳、脚的颜色（关节是金属色） |
| `person.bottom` / `pants` | 下装：`pants` 裤子、`skirt` 裙子；裤子 / 裙子的颜色 |
| `person.eye` / `blush` / `earrings` | 眼睛颜色、要不要腮红、要不要耳环 |
| `person.accent` / `antenna` / `earpods` | 发光色（面罩上的眼睛、眉毛、嘴，耳机上的灯圈，领带、工作牌）；要不要小天线（默认不要）、两侧的圆形耳机 |
| `colors` | 可选：柱子在各种状态的颜色。`body` 平时、`cmp` 正在比较、`swap` 正在交换、`sorted` 排好了、`pivot` 基准、`mark` 标记 |

颜色都写成 `#rrggbb`。

`person.faceImage`（可选）：照片做的脸，`data:image/jpeg;base64,...` 或 png，不超过 60KB。用捞捞PPT助手「我的形象」里标好五官，点「导出成捞捞编程皮肤」就会带上。有了它，小人脸上就是老师的卡通照片脸（嘴会张、眼睛会眨），同学一看就认得出。`person.photoFace: false` 可以不用照片脸。文件最大 80KB。

## 怎么上架

1. 先在捞捞编程里试穿：「画出来」→「皮肤」→「导入皮肤文件」，选你的 .json，看看效果。
2. 把文件放进这个文件夹，在 `index.json` 的 `skins` 里加一行：`{ "id": "你的id", "file": "你的id.json" }`。
3. 提交到仓库（main 分支）。网站自动更新后，皮肤商店里就有了。

皮肤商店每次打开时去官网取最新列表；同学用过的皮肤会存在自己电脑上，断网也能继续用。

`person.faceStyle`：脸是什么样的。`doll`（默认）= 公仔风（2026.11）：大头公仔，瓷白的脸上画着粗眉毛、眯眯笑眼、桃色腮红和小嘴，会眨眼、说话、笑；黑色头发是一缕缕有厚度的发片（`hairStyle` 选 `ponytail` 就是高马尾 + 红发圈）；肉乎乎的公仔手；毛衣、裤子上有白色格子（`person.grid: false` 不要格子）。`person.rig: true` 会露出机器人骨架（红色关节球、绿色线路、银色脊椎和骨头手），默认不要。`screen` = 机器人屏幕脸（白色机器人头 + 黑色玻璃面罩上的发光五官，颜色是 `person.shell`）；`cyber` / `photo` / `cartoon` = 用 `faceImage` 那张照片脸。

`person.faceLines`（可选，公仔脸 / 屏幕脸用）：老师五官的形状，捞捞PPT助手从照片里量出来的（眉毛的弧度和粗细、眼睛的长短和眼皮的弧度、嘴角的弯法、鼻子多宽），大约 1KB，全是 0–1 的数字。没有就用默认的五官。不照着线条原样画，而是取其中的特点（两眼距离、眼睛圆还是细长、眼角走向、眉毛粗细和走向、嘴宽、笑的弧度）画成公仔的五官（屏幕脸是发光的大眼睛、眉毛和嘴）。格式：`brows` 两条眉毛各 7 个点 `[u, v]`、`browT` 两条眉毛的粗细、`eyes` 两只眼睛各 `{ up: 上眼皮 7 点, lo: 下眼皮 7 点, iris: [u, v, 半径] }`、`mouth: { line: 嘴的中线 9 点, h: 嘴唇厚度, open: 笑着露牙的高度 }`、`nose: [u, v, 宽]`。点数不对、数不在 0–1 里的整份不要。
