# 捞捞编程（Windows 电脑版）

给刚学编程的同学：不用自己装编译器，打开就能写代码、按 F5 运行；看不懂报错，问电脑里的本地模型（不联网）。

- 自带：C / C++（MinGW-w64 GCC）、Python 3.12、llama.cpp + 通义千问 Qwen2.5-Coder 1.5B
- 一键安装：Java（JDK 21）、JavaScript（Node.js 20）、Go（国内镜像优先，装在 `%APPDATA%\LaolaoCode\toolchains`）
- 74 道练习，分 4 个题库：入门 15 题（任何语言）、计算机二级 C（27 题，按 NCRE 考纲原创）、二级 Python（20 题）、经典算法（12 题）；「检查」自动跑测试。题库在 `tools/bank-specs.js`，改完运行 `node tools/build-banks.js` 生成 `core/banks.js`，登录捞捞账号后进度同步（`user_kv` 的 `code_progress_v1` / `code_days_v1`）
- 代码默认放在「文档\捞捞编程」
- **画出来**：把程序一行一行走一遍，画出每一步所有变量的样子
  - 实时画面：写 C / C++ / Python 时编辑器右下角的悬浮小窗，停手 1 秒多就把（还没保存的）代码跑一遍，把最重要的数组 / 链表画成动画，编辑器里同时标出正在执行的那一行；点小窗或按 F7 放大
  - 大画面：每一层函数调用一张卡片（递归看得清），数组画成柱子（i、j、lo、hi、指针指着哪一格都标出来，传给函数的数组也标在原数组上），字符串一格一个字，二维数组画成网格，结构体画成盒子，链表画成一串节点，二叉树画成树，字典 / map 画成表；右边代码高亮、输出跟着走，点代码某一行跳到走到这一行的那一步
  - 做法：C / C++ 用 `gcc -g` 编译后在 gdb 里跑 `core/tracer/gdb_trace.py`（gdb 自带的 Python 一步步 step，读出所有变量；一行里的死循环每 0.12 秒戳停一次）；Python 用 `core/tracer/py_trace.py`（sys.settrace）。gdb 没有 Python 时退回老办法：自动加 `SHOW(数组, 个数)` 只画数组（`core/viz.js`）
  - 3D 舞台（`renderer/stage3d.js`，three.js）：数组里每个数是一个「数据小兵」小机器人，越大越高；比较时捞小智飞过去用扫描光照着、两个小兵互相看；交换时大的蹲下起跳从小的头顶翻过去、小的缩着身子滑过去，落地扬灰；改值时身体弹性长高 / 变矮；排好变绿蹦一下；全部排好挨个蹦、撒彩带。i、j、lo、hi 在地上亮光圈和名字牌。大画面、悬浮小窗、拖出去的小窗口都有；没有 WebGL 时退回平面柱子
  - 捞小智（`renderer/xiaozhi.js` 平面版，3D 版在舞台里）：白色圆壳、深色玻璃面罩、两道青色光眼睛、天线、悬浮推进光；在舞台上当讲解员（气泡里说这一步在干什么），也是「问捞捞」的形象
  - 音效（`renderer/sfx.js`）：全部用 Web Audio 现场合成，没有音频文件。比较的两个音按数值大小定音高（五声音阶，排序的过程像一段旋律）；起跳、落地、改值、排好、找到、全部完成、出错各有声音；右上角喇叭或按 M 开关。边打字边自动播放时不出声，点了播放才出声
  - 算法演示：冒泡、选择、插入、快排、归并、二分查找，C 代码在测试里真的编译运行，结果和动画最后一步一致
- **刷题**（左边第三个标签）：估计你的水平，推荐力扣（leetcode.cn）和 Codeforces 上「跳一跳够得着」的题，**在软件里做**
  - 点「开始做」：左边换成题目（从网站实时拿，只存在本机），在「文档\捞捞编程\刷题」里建代码文件（力扣题带好函数模板）
  - 运行样例：力扣题只写一个函数，软件按题目的参数类型自动配一个 main（C / C++ / Python，支持数组、二维数组、字符串、链表、二叉树……），用样例跑、和样例输出比；报错行号对回你的代码。Codeforces 题直接用样例输入跑
  - 提交：登录力扣（软件里弹出力扣自己的登录页，扫码或密码，密码不经过捞捞编程）后交到力扣，用它全部的测试数据判，结果和网页上一样；没登录就比样例，样例全对也记进水平（分量轻一点）
  - 实时画面也能画力扣题：用第 1 个样例调你的函数，只画你写的那几行
  - 水平分：国际象棋等级分（Elo）的办法，总分 + 每个知识点一个分；软件里的练习、刷题的提交、手动标记「做出来了 / 看了题解 / 没做出来 / 太简单」都算
  - 推荐：难度比你现在高一点、弱项优先、刚起步先推基础题，做过的和跳过的不推
  - 题库：只拿题目列表；自带 66 道力扣常见题，联网后「更新题库」拿完整列表，7 天更新一次；连不上就用自带的
  - 填上力扣 / Codeforces 用户名可以同步你在网站上做出来的题（只读公开信息）
- **更新**：点「重启并更新」后有安装进度窗口；安装程序会等软件完全退出、结束没退干净的本地模型再装（以前静默安装碰到文件被占用会直接放弃，看起来像没反应）。没装上的话下次打开会说原因，给「手动安装」

## 目录

| 路径 | 做什么 |
|---|---|
| `main.js` / `preload.js` | Electron 窗口；界面只能通过 `cc.call(方法)` 调 `core/service.js` 里列出的方法 |
| `core/service.js` | 全部功能（文件、运行、练习、安装、本地模型、账号），不依赖 Electron |
| `core/langs.js` | 各语言：编译器在哪找、模板 |
| `core/runner.js` | 编译运行（输出马上显示、输入、停止、死循环保护、中文路径） |
| `core/diag.js` | 读懂报错：哪一行 + 中文提示 |
| `core/toolchains.js` | 一键安装 Java / Node.js / Go |
| `core/ai.js` / `core/tutor.js` | 本地模型、提问的提示词（默认给提示不直接给答案） |
| `core/exercises.js` | 入门练习和检查 |
| `core/account.js` | 练习进度、连续天数、同步到捞捞账号 |
| `core/trace.js` / `core/tracer/*.py` | 画出来：gdb（C / C++）、settrace（Python）一步步追踪 |
| `renderer/viz.js` / `renderer/viz-board.js` | 悬浮小窗、大画面；把一步的变量画成柱子、格子、链表、树 |
| `core/viz.js` / `renderer/viz-algos.js` | 退回用的 SHOW 宏；内置算法演示的 C 代码和步骤 |
| `core/problems.js` / `renderer/prob.js` | 在软件里做题：题面、模板、自动配 main 本地判、力扣在线运行 / 提交 |
| `core/judge.js` / `core/skill.js` / `renderer/lc.js` | 刷题：力扣 / Codeforces 题目列表和做题记录；水平分和推荐；推荐列表 |
| `renderer/icons.js` | 线条图标（Lucide） |
| `renderer/stage3d.js` / `renderer/sfx.js` / `renderer/xiaozhi.js` | 3D 舞台（three.js，MIT，`npm install` 后由 prepare 拷到 renderer/vendor/three）、合成音效、捞小智 |
| `renderer/` | 界面（CodeMirror 5） |
| `installer/laolao-code.iss` | Inno Setup 安装包脚本 |

`core/api.js`、`core/site-config.js` 是打包前从 `desktop/core/api.js`、网站 `config.js` 拷来的（`node scripts/prepare.js`），同一个账号。

## 开发

```bash
npm install
npm start            # 开发版用电脑上装好的编译器
npm test             # 运行、练习、核心逻辑、画出来（追踪）、做题判样例、水平分和推荐
node test/ui-server.js   # 不开 Electron，在浏览器里测界面（配合 test/cc-shim.js）
```

打包在 GitHub Actions（`.github/workflows/code.yaml`）：下载编译器、Python、llama.cpp、模型 → 测试 → electron-builder → Inno Setup → 发布到 Releases 的 `laolao-code`。
