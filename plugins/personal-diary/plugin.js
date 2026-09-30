// 个人日记插件：组员开发的独立页面 app.html 通过 iframe 嵌入。
// 图文情绪手帐：文字/心情本机加密保存，照片存本机 IndexedDB；天气功能会联网查询 Open-Meteo。
CalendarApp.register({
  id: "personal-diary",
  init(api) {
    api.addTab({
      id: "main", title: "📝 日记",
      render(el) {
        el.innerHTML = `<div class="panel" style="padding:0;overflow:hidden">
          <iframe src="plugins/personal-diary/app.html?v=1.1.0" title="个人日记" allow="geolocation"
            style="width:100%;border:0;display:block;min-height:75vh"></iframe></div>`;
        const frame = el.querySelector("iframe");
        const fit = () => {
          try {
            const h = frame.contentDocument.documentElement.scrollHeight;
            if (h) frame.style.height = Math.max(h, window.innerHeight * 0.75) + "px";
          } catch (e) { /* 保留 min-height */ }
        };
        frame.addEventListener("load", () => {
          fit();
          try { new ResizeObserver(fit).observe(frame.contentDocument.body); } catch (e) {}
        });
      },
    });
  },
});
