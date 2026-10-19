# 捞捞编程（Windows 电脑版）

给刚学编程的同学：不用自己装编译器，打开就能写代码、按 F5 运行；看不懂报错，问电脑里的本地模型（不联网）。

- 自带：C / C++（MinGW-w64 GCC）、Python 3.12、llama.cpp + 通义千问 Qwen2.5-Coder 1.5B
- 一键安装：Java（JDK 21）、JavaScript（Node.js 20）、Go（国内镜像优先，装在 `%APPDATA%\LaolaoCode\toolchains`）
- 15 道入门练习（任何语言都能做，「检查」自动跑测试），登录捞捞账号后进度同步（`user_kv` 的 `code_progress_v1` / `code_days_v1`）
- 代码默认放在「文档\捞捞编程」

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
| `renderer/` | 界面（CodeMirror 5） |
| `installer/laolao-code.iss` | Inno Setup 安装包脚本 |

`core/api.js`、`core/site-config.js` 是打包前从 `desktop/core/api.js`、网站 `config.js` 拷来的（`node scripts/prepare.js`），同一个账号。

## 开发

```bash
npm install
npm start            # 开发版用电脑上装好的编译器
npm test             # 运行、练习、核心逻辑
node test/ui-server.js   # 不开 Electron，在浏览器里测界面（配合 test/cc-shim.js）
```

打包在 GitHub Actions（`.github/workflows/code.yaml`）：下载编译器、Python、llama.cpp、模型 → 测试 → electron-builder → Inno Setup → 发布到 Releases 的 `laolao-code`。
