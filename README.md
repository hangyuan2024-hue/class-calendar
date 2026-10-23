# 班级信息整理助手（捞捞课程表）

> 面向高校学生的信息整合、任务管理与学习成长平台 · 信息捞捞队
> 陕西省高校「AI+教育」创新应用技能大赛 · 高等教育赛道 · 选题一 AI+教学

用 AI 把班级群里零散的作业、考试、通知整理成带时间、地点、科目的日程；拍一张课表截图就能导入整学期课表。
课表、作业和个人事项汇集在一个「学习工作台」里，到点提醒；「捞捞教练」作为智能学伴告诉学生现在先做哪一件。
网页、微信小程序、安卓 App、Windows 电脑版同一个账号，数据实时同步。

## 在线体验

| 平台 | 地址 |
|---|---|
| 网页版 | https://www.laolaokechengbiao.cn （点「进入工作台」，**不登录也能体验**个人事项、课表、规划和工具） |
| 微信小程序 | 微信搜索「捞捞课程表」 |
| 安卓 App / Windows 电脑版 | 官网「下载」栏目 |
| 捞捞学习（思维导图、课内学习） | https://www.laolaokechengbiao.cn/learn/ |

## 评审快速导览

想快速了解核心能力，建议按下面的顺序看代码（都在仓库根目录）：

| 功能 | 文件 | 说明 |
|---|---|---|
| 群消息本地整理 | `parse.js` | 不调用大模型的本地规则：时间、地点、科目、「提前交」等口语表达；拿不准的标记出来交给 AI |
| 闲时自学 | `lao-train.js` | 设备空闲时用本班已发布的事项自我测验、学习纠错，准确率持续提升 |
| Word 通知导入 | `docx-text.js` | 在本机读取 .docx，不上传 |
| 智能排序与离线问答 | `island-core.js` | 离截止远近、事项类型综合排序；不联网的问答 |
| 捞捞教练（智能学伴） | `coach-core.js` | 「先做这个」推荐、专注掉落、班级同步自习（只统计人数和分钟数） |
| 课程表 | `courses.js`、`course-image.js` | 课表导入、调课、班级课表、导出课表图片 |
| 多端同步 | `app.js`（`Sync`）、`live.js` | 逐条带时间戳同步、实时更新、局域网同步 |
| 班级签到 / 老师端 | `checkin-ui.js`、`teacher.js` | 定位与动态码签到；「班级情况」看板 |
| 思维导图 / 课内学习 | `mindmap.js`、`study.js` | 捞捞学习板块 |
| 账号与安全 | `auth.js`、`guard.js` | 登录、设备管理、异常登录自动退出、防点击劫持 |
| 安卓 App | `laolao-android/` | Kotlin 原生实现，核心规则与网页一致（`core/Coach.kt`、`core/Sync.kt` 等） |
| Windows 电脑版 | `desktop/` | Electron；`core/ai.js` 为本地大模型（Qwen2.5 1.5B，首次使用时下载） |

测试：`test/*.test.js`（`node test/xxx.test.js` 直接运行，不需要安装依赖）。

## 本地运行网页版

网页是纯静态文件，不需要构建：

```bash
git clone https://github.com/hangyuan2024-hue/class-calendar.git
cd class-calendar
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/index.html?guest=1
```

不登录即可使用个人事项、课表、规划和工具；登录、班级、同步会连接线上服务器。

## 技术架构

- **客户端**：网页（原生 JavaScript，离线缓存，可安装为桌面应用）、微信小程序、安卓原生 App（Kotlin）、Windows 电脑版（Electron），共用同一套接口和核心规则。
- **后端**：云端 PostgreSQL，业务逻辑以数据库函数实现，经 REST 接口调用；课表识别、聊天截图识别、群消息整理等 AI 服务部署在扣子平台。
  后端代码涉及服务密钥，未放入本仓库；评审如需查看，请联系团队负责人提供只读访问。
- **AI 整理流程**：本地规则先解析 → 拿不准的交给大模型（云端或本地模型）抽取结构化字段 → 用户核对修正 → 修正结果沉淀为本班共享的整理规则。
- **安全**：接口最小权限白名单、数据库行级安全隔离班级数据、登录设备管理、异常登录自动退出、接口限流。

## 目录

```
/                网页版（index.html 工作台、app.html 官网首页、learn/ 捞捞学习、code/ 捞捞编程介绍）
laolao-android/  安卓 App（当前版本）
desktop/         Windows 电脑版
plugins/         内置插件（课程表、日记等）
partners/        合作队伍的原始代码（见下方说明）
test/            测试
```

## 说明

- 「课内学习」功能来自合作队伍的开源项目 courses_app（原始代码保存在 `partners/courses_app/`），在本项目中改为统一的界面和账号体系；课程表插件由团队组员开发（`plugins/course-schedule/`）。
- Windows 电脑版的历史更新记录见 `CHANGELOG-windows.md` 和 `desktop/README.md`。
- 项目计划逐步开源共建，欢迎各高校开发者参与（官网「开源共建」栏目）。
