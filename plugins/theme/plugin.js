// 个性化主题插件：演示「设置主题变量 + 添加一个标签页」
CalendarApp.register({
  id: "theme",
  init(api) {
    const THEMES = {
      default: { name: "默认", vars: {} },
      dark: { name: "深色", vars: {
        bg: "#000000", card: "#1c1c1e", line: "#38383a", text: "#f2f2f7", sub: "#98989f",
        hover: "#2c2c2e", "muted-bg": "#141416", "muted-text": "#48484a", selected: "#0a2a4a",
        "note-bg": "#3a3320", "danger-bg": "#3a1c1c" } },
      sakura: { name: "樱花粉", vars: { accent: "#ff5f8f", today: "#ff5f8f", selected: "#ffeef3", bg: "#fff7f9" } },
      mint: { name: "薄荷绿", vars: { accent: "#20a37a", today: "#20a37a", selected: "#e6f7f1", bg: "#f4fbf8" } },
    };
    const apply = (key) => {
      api.resetTheme();
      api.setTheme((THEMES[key] || THEMES.default).vars);
      api.storage.set("current", key);
    };
    apply(api.storage.get("current", "default"));

    api.addTab({
      id: "main", title: "🎨 主题",
      render(el) {
        el.innerHTML = `<div class="panel"><h2>🎨 个性化主题</h2><div class="tbtns" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>`;
        const box = el.querySelector(".tbtns");
        const draw = () => {
          const cur = api.storage.get("current", "default");
          box.innerHTML = Object.entries(THEMES).map(([k, t]) =>
            `<button data-k="${k}" class="${k === cur ? "primary" : ""}">${api.util.esc(t.name)}</button>`).join("");
        };
        box.onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) { apply(b.dataset.k); draw(); } };
        draw();
      },
    });
  },
});
