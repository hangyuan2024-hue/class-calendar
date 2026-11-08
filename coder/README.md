# 捞捞编程（Windows 电脑版）

给刚学编程的同学：不用自己装编译器，打开就能写代码、按 F5 运行；看不懂报错，问电脑里的本地模型（不联网）。

- 自带：C / C++（MinGW-w64 GCC）、Python 3.12、llama.cpp + 通义千问 Qwen2.5-Coder 1.5B
- 一键安装：Java（JDK 21）、JavaScript（Node.js 20）、Go（国内镜像优先，装在 `%APPDATA%\LaolaoCode\toolchains`）
- 74 道练习，分 4 个题库：入门 15 题（任何语言）、计算机二级 C（27 题，按 NCRE 考纲原创）、二级 Python（20 题）、经典算法（12 题）；「检查」自动跑测试。题库在 `tools/bank-specs.js`，改完运行 `node tools/build-banks.js` 生成 `core/banks.js`，登录捞捞账号后进度同步（`user_kv` 的 `code_progress_v1` / `code_days_v1`）
- 代码默认放在「文档\捞捞编程」
- **画出来**（顶栏 🎬 / F7）：把代码的执行过程画成动画
  - 算法动画：冒泡、选择、插入、快排、归并、二分查找。柱子一步步动，右边 C 代码高亮正在执行的那一行，下面是变量的值和一句中文说明；数据可以自己填。每种算法的 C 代码在测试里真的编译运行，结果要和动画最后一步一致
  - 我的代码：把你自己写的 C / C++ 跑一遍画出来。复制一份，在给 int 数组元素赋值的语句后面（同一行，行号不变）自动加 `SHOW(数组, 个数)`，编译时 `-include` 一个头文件，程序每打一帧就是一幅画；原文件不动。也可以自己写 `SHOW(a, n);` / `SHOW2(a, n, i, j);`
- **刷题**（左边第三个标签）：估计你的水平，推荐力扣（leetcode.cn）和 Codeforces 上「跳一跳够得着」的题
  - 水平分：国际象棋等级分（Elo）的办法，总分 + 每个知识点一个分。软件里的练习检查通过会自动算（改几次才对、问过捞捞的少加一点）；外面的题点「去做」在浏览器里打开，做完回来点「做出来了 / 看了题解 / 没做出来 / 太简单」
  - 推荐：难度比你现在高一点（把握大约四到六成）、弱项优先、刚起步时先推数组字符串这类基础题，做过的和跳过的不推
  - 题库：只拿题目列表（编号、标题、难度、知识点、通过率），题目内容不搬，点开是原网站。自带 66 道力扣常见题，联网后「更新题库」从力扣 / Codeforces 的公开接口拿完整列表，存在本机，7 天更新一次；连不上就用自带的
  - 填上力扣 / Codeforces 用户名可以同步你在网站上做出来的题（只读公开信息，不要密码）

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
| `core/viz.js` / `renderer/viz-algos.js` / `renderer/viz.js` | 画出来：自动加 SHOW、读帧；内置算法的 C 代码和步骤；动画界面 |
| `core/judge.js` / `core/skill.js` / `renderer/lc.js` | 刷题：力扣 / Codeforces 题目列表和做题记录；水平分和推荐；界面 |
| `renderer/` | 界面（CodeMirror 5） |
| `installer/laolao-code.iss` | Inno Setup 安装包脚本 |

`core/api.js`、`core/site-config.js` 是打包前从 `desktop/core/api.js`、网站 `config.js` 拷来的（`node scripts/prepare.js`），同一个账号。

## 开发

```bash
npm install
npm start            # 开发版用电脑上装好的编译器
npm test             # 运行、练习、核心逻辑、画出来、水平分和推荐
node test/ui-server.js   # 不开 Electron，在浏览器里测界面（配合 test/cc-shim.js）
```

打包在 GitHub Actions（`.github/workflows/code.yaml`）：下载编译器、Python、llama.cpp、模型 → 测试 → electron-builder → Inno Setup → 发布到 Releases 的 `laolao-code`。
