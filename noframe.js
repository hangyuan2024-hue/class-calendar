// 6.15 防点击劫持：本站页面不允许被别的网站用 iframe 嵌进去（GitHub Pages 不能加响应头，只能用脚本挡）
(function () {
  if (window.top === window.self) return;
  var same = false;
  try { same = window.top.location.origin === window.location.origin; } catch (e) { same = false; }
  if (same) return;   // 自己站内的嵌入（比如插件预览）放行
  document.documentElement.style.display = "none";
  try { window.top.location.replace(window.self.location.href); } catch (e) {}
})();
