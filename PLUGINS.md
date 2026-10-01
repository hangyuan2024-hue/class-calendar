# 插件开发规范（给队员看）

班级群日历是「核心 + 插件」结构。插件存在数据库里，通过 **插件后台（dev.html）** 上传，不需要再改 GitHub 上的文件，也不需要手写作者名。

## 一、账号与身份

| 身份 | 能做什么 |
|---|---|
| 学生 | 使用日历，在插件商店里开关**已发布**的插件（注册后默认是学生） |
| 测试员 | 额外能在插件商店里看到并试用**测试中**的插件 |
| 开发者 | 上传、更新、撤回、删除**自己的**插件；也能试用测试中的插件 |
| 管理员 | 审核发布 / 驳回 / 下架、设默认开启、转交作者、分配身份 |
| 老师、班委 | 已预留，后续开放 |

流程：在 `login.html` 注册 → 把账号发给管理员 → 管理员在后台把你设成「开发者」或「测试员」→ 刷新即可。

## 二、插件长什么样

一个插件 = 下面两个文件**至少一个**：

1. **`app.html`（推荐新手用）**：一个完整的、单文件的网页（CSS、JS 都写在里面）。上传后自动变成日历顶部的一个标签页。
2. **`plugin.js`**：用接口写的插件，可以往日历里加事项、改主题、加多个标签页等。两个都有时，在 plugin.js 里用 `api.mountApp(el)` 把 app.html 放到你想要的位置。

### 插件运行在「隔离间」里（安全规则，2026-10 起）
所有插件（plugin.js 和 app.html）都在 `sandbox.html` 隔离间里运行（iframe sandbox，不同源）：
- 拿不到登录信息、读不到日历网页自己的存储、调不了数据库接口，也不能把整个网页跳走。
- `localStorage` 照常可以用，但每个插件**有自己独立的一份**（同一个插件的 plugin.js 和 app.html 共用），别的插件和日历网页都看不到。以前存在网页里的数据会在第一次运行时自动搬过来。
- 没有 `indexedDB`（用 localStorage 代替）；`alert / confirm`、下载文件、打开新窗口可以用。
- plugin.js 会运行两次：一次在后台（负责 `addEventSource`、`setTheme`），每个标签页再各运行一次（负责 `render`）。所以 `init` 里不要做「只能做一次」的事。
- `api.mountApp(el)` 会把 app.html 放在标签页内容的下方。
- `api.setTheme` 只能改已有的颜色变量，值只能是颜色（如 `#ff5f8f`、`rgb(...)`）。
- `api.addEventSource` 返回的事项只认 `id、date(YYYY-MM-DD)、time(HH:MM)、title、detail、location、color(颜色)`，其余忽略。

### app.html 的要求
- 单文件，**不引用外部 CSS/JS 文件**（国内网络可能打不开；隔离间也只允许内联脚本）。
- 本地存储的键统一加前缀 `personal_<插件id>_`，方便以后迁移。
- 如果要联网（比如查天气），只能访问 https 网址，并在「一句话介绍」或 README 里写清楚会访问什么网站、发送了什么数据。
- 发布前管理员必须先「查看代码」；查看之后作者再改代码，发布会被拒绝，需要重新查看。

### plugin.js 的写法
```js
CalendarApp.register({
  id: "study-log",            // 必须和后台填写的插件 ID 完全一致
  init(api) {
    api.addTab({ id: "main", title: "📓 学习日志", render(el) {
      el.innerHTML = `<div class="panel"><h2>学习日志</h2></div>`;
      api.mountApp(el);       // 如果同时上传了 app.html，把它嵌进来
    }});
  },
});
```

| 接口 | 作用 |
|---|---|
| `api.storage.get(key, 默认值)` / `api.storage.set(key, 值)` | 读写本机数据，自动加插件前缀 |
| `api.addTab({ id, title, render(el) })` | 新增一个标签页 |
| `api.mountApp(el, { minHeight })` | 把 app.html 嵌进 el，自动调整高度 |
| `api.addEventSource((开始日期, 结束日期) => [...])` | 往日历里加事项：`{ id, date, time, title, detail, location, color }` |
| `api.setTheme({ 变量: 值 })` / `api.resetTheme()` | 改主题颜色 |
| `api.on("dayselected", fn)` | 用户点了某一天 |
| `api.getClassItems()` / `api.getSelectedDate()` / `api.goToDate(日期)` / `api.refresh()` | 读取班级事项、跳转、刷新 |
| `api.util.esc(文本)` | **把用户输入放进 HTML 前必须转义** |

参考：`plugins/theme/plugin.js`（纯接口）、`plugins/course-schedule/`（plugin.js + app.html）、`plugins/personal-diary/`（只有 app.html）。

## 三、上传与发布流程

1. 登录后进入 **插件后台**。
2. 「上传插件」：第一次选「＋ 新插件」，填插件 ID（小写字母、数字、连字符，如 `study-log`，**发布后不能改**）、名称、图标、版本号、介绍，选择文件，点「提交测试」。
3. 页面会先做**自动体检**：id 对不上、读取登录信息会直接拦下；访问外部网址、存储键没加前缀会给出⚠提醒。
4. 提交后状态是「测试中」：开发者和测试员可以在日历的插件商店里启用试用，同学们看不到。
5. 管理员审核：通过就「发布」，所有同学可见；不通过会「驳回」并写意见，你在「我的插件」里能看到，改好后重新提交即可。
6. 更新版本：在「我的插件」点「上传新版本」，版本号要比线上的大（如 1.0.0 → 1.0.1）。只改名称或介绍时可以不选文件，自动沿用上一版。**新版本审核通过前，同学们用的一直是旧版本。**

## 四、规则
- 个人数据只存在本机，不要偷偷上传到别的服务器。
- 不要读取登录信息（`cc_session_v1`），不要用 `eval`。
- 插件出错不会影响日历本身，错误信息会显示在插件商店里。
