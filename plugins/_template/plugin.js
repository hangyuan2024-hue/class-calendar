// 插件模板：复制这个文件夹，改名为你的插件 id（只用小写字母、数字、连字符）
// 然后在 plugins/registry.json 里登记，否则不会被加载。
CalendarApp.register({
  id: "my-plugin",            // 必须和文件夹名、registry.json 里的 id 一致
  init(api) {
    // api.storage.get(key, 默认值) / api.storage.set(key, 值)  —— 只存本机，自动加插件前缀
    // api.addTab({ id, title, render(el) })                      —— 新增一个标签页
    // api.addEventSource((开始日期, 结束日期) => [{ id, date:"YYYY-MM-DD", time:"HH:MM", title, detail, location, color }])
    // api.setTheme({ accent: "#ff5f8f" }) / api.resetTheme()      —— 修改主题颜色变量
    // api.on("dayselected", (日期) => {})                         —— 用户点了某一天
    // api.getClassItems() / api.getSelectedDate() / api.goToDate("2026-10-01") / api.refresh()
    // api.util.esc(文本)  —— 把用户输入放进 HTML 前一定要转义
    api.addTab({
      id: "main", title: "🧪 示例",
      render(el) { el.innerHTML = `<div class="panel"><h2>我的插件</h2><p>Hello!</p></div>`; },
    });
  },
});
