# 插件开发指南（给队友看）

班级群日历是「核心 + 插件」结构：核心只负责班级日历，其他功能都做成插件，在「🧩 插件商店」里开关。

## 目录结构
```
index.html              核心页面（一般不用改）
config.js               部署配置（数据库地址和只读密钥）
plugins/registry.json   插件商店清单：只有登记在这里的插件才会被加载
plugins/<插件id>/plugin.js
plugins/_template/      新插件模板
```

## 做一个新插件
1. 复制 `plugins/_template` 文件夹，改名为你的插件 id（小写字母、数字、连字符，如 `study-log`）。
2. 把 `plugin.js` 里的 `id` 改成同一个名字，开始写功能。
3. 在 `plugins/registry.json` 里加一条：
   ```json
   { "id": "study-log", "name": "学习日志", "icon": "📝", "version": "1.0.0",
     "author": "你的名字", "description": "一句话介绍", "default": false }
   ```
4. 提交到 GitHub（开一个 Pull Request，由队长审核后合并）。合并后 1～2 分钟，所有人的插件商店里就能看到。

## 插件能用的接口（api）
| 接口 | 作用 |
|---|---|
| `api.storage.get(key, 默认值)` / `api.storage.set(key, 值)` | 读写本机数据，自动加插件前缀，不会和别的插件冲突 |
| `api.addTab({ id, title, render(el) })` | 新增一个标签页，在 `el` 里画界面 |
| `api.addEventSource((开始日期, 结束日期) => [...])` | 往日历里加事项，每项：`{ id, date, time, title, detail, location, color }` |
| `api.setTheme({ 变量名: 值 })` / `api.resetTheme()` | 改主题颜色（变量见 index.html 里的 `:root`） |
| `api.on("dayselected", fn)` | 用户点了某一天 |
| `api.getClassItems()` / `api.getSelectedDate()` / `api.goToDate(日期)` / `api.refresh()` | 读取班级事项、跳转、刷新日历 |
| `api.util.esc(文本)` | **把用户输入放进 HTML 前必须转义**，防止注入 |

参考示例：`plugins/theme`（主题，用接口写的插件）、`plugins/course-schedule`（课程表，独立页面嵌入）。

## 已经做好了一个独立的 HTML 页面？
不用改写。把它改名为 `app.html` 放进 `plugins/<插件id>/`，再复制 `plugins/course-schedule/plugin.js`，把里面的 id、标题、路径改成你的即可。要求：
- 单文件、不依赖外部网站；
- localStorage 的键统一加 `personal_<插件id>_` 前缀，避免和别人冲突。

## 规则
- 个人数据只用 `api.storage` 存在本机，不要偷偷上传到别的服务器。
- 不要修改 `index.html` 和别人的插件；需要新接口找队长加。
- 插件出错不会影响日历本身，错误会显示在插件商店里。
