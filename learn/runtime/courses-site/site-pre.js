/* site-pre.js —— 课内学习 · 网页版启动（捞捞学习板块）
 * 课内本机版要在电脑上运行 node back/server.js；网站上改由 /learn/sw.js（Service Worker）在浏览器里提供同一套 /api 接口，
 * 数据存在本浏览器里，登录后自动备份到捞捞账号（../learn-sync.js）。第一次打开要先装好 sw.js 再刷新一次。 */
(function () {
  "use strict";
  var here = location.pathname.replace(/[^/]*$/, "");          // /learn/courses/
  window.COURSES_API_BASE = here + "api";
  window.MINDMAP_APP_URL = new URL("../mindmap/", location.href).href;
  window.LEARN_WEB = true;
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
      var b = document.createElement("div"); b.className = "learn-fatal";
      b.textContent = "这个浏览器不支持离线存储（Service Worker），课内学习没法使用。请换用新版 Chrome、Edge、Safari，或微信里的浏览器。";
      document.body.prepend(b);
    });
    return;
  }
  var sw = new URL("../sw.js", location.href).pathname, scope = new URL("../", location.href).pathname;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.register(sw, { scope: scope }).catch(function () {});   // 有新版时后台更新，下次打开生效
    return;
  }
  // 第一次：先装好再刷新（装好之前页面里的接口请求都会失败，所以先把页面盖住）
  window.LEARN_BOOTING = true;
  // 装好之前接口都还不通：先挂起这些请求（页面马上刷新），免得报一堆「连不上」
  var rawFetch = window.fetch;
  window.fetch = function (input, opt) {
    var u = typeof input === "string" ? input : input && input.url || "";
    if (String(u).indexOf(window.COURSES_API_BASE) >= 0 || /\/api\//.test(new URL(u, location.href).pathname)) return new Promise(function () {});
    return rawFetch.apply(this, arguments);
  };
  document.documentElement.classList.add("learn-booting");
  var st = document.createElement("style");
  st.textContent = "html.learn-booting body>*{visibility:hidden!important}html.learn-booting body::before{content:'正在准备课内学习……';visibility:visible;position:fixed;inset:0;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#667}";
  document.head.appendChild(st);
  var done = false;
  function go() { if (done) return; done = true; location.reload(); }
  navigator.serviceWorker.addEventListener("controllerchange", go);
  navigator.serviceWorker.register(sw, { scope: scope }).then(function () { return navigator.serviceWorker.ready; }).then(function () {
    setTimeout(function () { if (navigator.serviceWorker.controller) go(); }, 300);
    setTimeout(go, 4000);
  }).catch(function (e) {
    document.documentElement.classList.remove("learn-booting");
    document.addEventListener("DOMContentLoaded", function () {
      var b = document.createElement("div"); b.className = "learn-fatal";
      b.textContent = "课内学习的本地存储没准备好：" + (e && e.message || e) + "。请刷新重试；无痕模式下可能用不了。";
      document.body.prepend(b);
    });
  });
})();
