// 防止本站页面被别的网站嵌进去（点击劫持）：被嵌入时整页隐藏，并尽量跳出到顶层
(function () {
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* 对方禁止跳转时，页面保持隐藏 */ }
    return;
  }

  // AI Agent Competition Edition UI
  // 只挂载视觉层，不改业务逻辑、数据结构、DOM id 或事件。
  var path = (location.pathname || "/").toLowerCase();
  var page = "generic";
  if (path === "/" || /\/index\.html$/.test(path)) page = "main";
  else if (/\/app\.html$/.test(path)) page = "landing";
  else if (/\/login\.html$/.test(path)) page = "auth";
  else if (/\/class\.html$/.test(path)) page = "class";
  document.documentElement.setAttribute("data-competition-ui", page);

  function mountCompetitionUI() {
    var old = document.getElementById("competition-ui-css");
    if (old) old.remove();
    var link = document.createElement("link");
    link.id = "competition-ui-css";
    link.rel = "stylesheet";
    link.href = "competition-ui.css?v=20261005-final";
    document.head.appendChild(link); // 放到现有样式最后，确保只做视觉覆盖
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountCompetitionUI, { once: true });
  } else {
    mountCompetitionUI();
  }
})();
