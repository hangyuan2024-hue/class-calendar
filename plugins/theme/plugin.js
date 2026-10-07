// 旧「个性化主题」插件已退役。
// 主题/配色现在统一由“我的 → 外观”管理，避免旧插件与主站外观系统同时修改 CSS 变量。
CalendarApp.register({
  id: "theme",
  init(api) {
    api.addTab({
      id: "main",
      title: "🎨 外观",
      render(el) {
        el.innerHTML = `<div class="panel"><h2>🎨 外观已升级</h2><p>主题和配色已经合并到「我的 → 外观」。旧主题插件不会再修改全局颜色。</p></div>`;
      },
    });
  },
});
