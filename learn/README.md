# 捞捞学习：AI 思维导图与课内学习平台

> 学习捞捞队 · 西安交通大学《电信T.A杯》「AI+教育」创新应用技能大赛 · 高等教育赛道 · 选题一 AI+教学

捞捞学习由两个工具组成，网页打开即用，数据本地优先，登录捞捞调度账号后自动备份：

- **捞捞思维导图**（`learn/mindmap/`）：无限画布、节点里写 Markdown 和 LaTeX 公式（79 个高数、线代模板按 Tab 补全）、连线自动绕开节点、线标、图片 / PDF 节点、跨导图引用；接入大模型（DeepSeek、智谱 GLM、Kimi 或兼容接口）从提纲、讲义生成导图，没有 Key 时按大纲本地生成。最初开发于 <https://github.com/hikingsama/Laolao-mindmap>，源码已并入本仓库
- **课内学习**（`learn/courses/`）：按课程整理资料、笔记、错题、复习、考核、知识框架，资料和错题挂到知识点上，考核截止日期同步到捞捞课程表提醒。源码在 `learn/courses_app/`（最初开发于 <https://github.com/RainyyyyDay/courses_app>）。课程资料可以一键「生成导图 / 编辑导图」：嵌入的就是同一份思维导图（`learn/mindmap/course.html`、`preview.html`）

## 源码在哪里（2026-10-27 起并入本仓库）

| 目录 | 内容 |
|---|---|
| `learn/mindmap/` | 思维导图，只有这一份：`index.html` 是独立的捞捞思维导图，`course.html` / `preview.html` 是课内学习里嵌入的工作台和只读预览。地址都用相对路径，网站（`/learn/mindmap/`）和本机课内服务（`/mindmap/`）共用 |
| `learn/courses_app/` | 课内学习的完整源码（前端 `fronted/`、后端 `back/`、文档、测试），以后在这里维护 |
| `learn/courses/`、`learn/sw.js` | 网站上实际运行的课内学习：由 `learn/courses_app/` 生成，不要直接改 |
| `learn/runtime/` | 网页版运行环境（浏览器里跑后端）和生成脚本 |

改了 `learn/courses_app/` 之后，在网站根目录运行 `node learn/runtime/build.js`（需要 esbuild），重新生成 `learn/courses/` 和 `learn/sw.js`。
思维导图的新版本如果还是在原来的仓库里开发，用 `node learn/runtime/import-mindmap.js --module <courses_app>/modules/mindmap --standalone <Laolao-mindmap>` 导入（自动改成相对路径、加上网站版的启动脚本）。

网页版的思维导图后台任务（「大纲 / 正文生成导图」）在浏览器的 Service Worker 里运行：生成完成前要保持页面打开；PDF 讲义的后台通览需要本机的原生绘图库，网站上暂不支持。网站上导图的 AI 用导图自己的「大模型 API 接入」（独立版和课内嵌入的工作台共用一份）。

## 和信息捞捞队的合作

捞捞学习和捞捞课程表同属「捞捞调度」平台，由两支队伍合作完成、分别参赛：

- **学习捞捞队（本作品）**：捞捞思维导图与课内学习的设计和开发。
- **信息捞捞队（作品「班级信息整理助手」，即捞捞课程表）**：提供网站集成、捞捞调度账号与云端备份，并负责两边的数据互通：考核截止日期进课程表、课程表里的「学习」入口、期末复习排期读取课内学习的知识点和错题。

本作品的材料只把学习捞捞队开发的部分算作成果；对接部分是两队合作的结果。

## 在线体验

| 入口 | 地址 |
|---|---|
| 捞捞学习首页 | https://www.laolaokechengbiao.cn/learn/ |
| 思维导图 | https://www.laolaokechengbiao.cn/learn/mindmap/ |
| 课内学习 | https://www.laolaokechengbiao.cn/learn/courses/ |
| 评审测试账号 | 账号 `ceshi`，密码 `ceshi12345678`（登录后可体验账号备份） |

## 评审快速导览

| 内容 | 位置 | 说明 |
|---|---|---|
| 导图编辑器 | `mindmap/js/scene-renderer.js`、`mindmap/js/edge-router.js` | 节点渲染、连线自动绕开节点 |
| 节点内容与公式 | `mindmap/js/node-content.js`、`mindmap/js/math-completion.js` | Markdown-it + KaTeX；公式模板 Tab 补全 |
| AI 生成导图 | `mindmap/js/ai-*.js`、`mindmap/prompts/` | 大纲 / 正文、课件 / 讲义生成；提示词与过程可查看 |
| 课内学习前端 | `courses_app/fronted/js/`（网站上运行的副本在 `courses/js/`） | 课程、资料、笔记、错题、复习计划、考核、知识框架 |
| 课内学习后端 | `courses_app/back/` | 原本的 Node.js 服务（Express + SQLite）；网页版把它打包进 `sw.js` |
| 浏览器里运行后端 | `runtime/sw-entry.js`、`runtime/memfs.js`、`runtime/sqlite.js` | 两套后端打包进一个 Service Worker：IndexedDB 存文件，WebAssembly 版 SQLite 存数据库，离线可用 |
| 账号备份 | `learn-sync.js` | 登录后增量备份，大于 5MB 的附件分块上传 |

打包命令（在网站根目录）：`node learn/runtime/build.js`，用本仓库的 `learn/courses_app/` 生成 `learn/sw.js` 和 `learn/courses/`。
