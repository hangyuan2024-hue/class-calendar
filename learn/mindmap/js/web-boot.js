/* web-boot.js —— 网页版启动（6.8）
 * 本机版靠 node server.js 提供 api/ 接口；放在网站上时没有这个服务，改由捞捞学习的 ../sw.js（Service Worker，课内学习也用它）
 * 在浏览器里提供同一套接口，导图和附件存在本浏览器里。第一次打开要先装好 sw.js 再刷新一次页面。
 * 本机（127.0.0.1 / localhost，比如电脑版或 npm start）照旧用真正的服务，不装 Service Worker。 */
(function () {
  "use strict";
  // 网站登录（../../auth.js）在 host-bridge.js 里会被换成占位，先留一份给「从账号导入旧导图」用
  window.MM_CCAUTH = window.CCAuth || null;
  // ?sw=1：在本机也用浏览器存储（测试网页版用）
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
  window.MM_WEB = !local;
  if (local || location.protocol === "file:") return;
  if (!("serviceWorker" in navigator)) {
    document.addEventListener("DOMContentLoaded", function () {
      var b = document.getElementById("banner"); if (b) { b.textContent = "这个浏览器不支持离线存储（Service Worker），思维导图没法保存。请换用新版 Chrome、Edge、Safari 或微信里的浏览器。"; b.className = "on"; }
    });
    return;
  }
  var SW = new URL("../sw.js", location.href).pathname, SCOPE = new URL("../", location.href).pathname;
  // 6.8 版的 Service Worker 注册在 learn/mindmap/ 上，会挡住新的 learn/sw.js：注销后刷新一次（导图数据新版会自动搬过去）
  if (navigator.serviceWorker.controller && /\/learn\/mindmap\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL)) {
    window.MM_BOOTING = true;
    navigator.serviceWorker.getRegistrations().then(function (list) {
      return Promise.all(list.filter(function (r) { return /\/learn\/mindmap\/$/.test(r.scope); }).map(function (r) { return r.unregister(); }));
    }).then(function () { location.reload(); }, function () { location.reload(); });
    return;
  }
  if (navigator.serviceWorker.controller) {
    // 有新版 sw.js 时后台更新，下次打开生效
    navigator.serviceWorker.register(SW, { scope: SCOPE }).catch(function () {});
    return;
  }
  // 第一次：先装好再刷新（装好之前页面里的请求都会失败，所以先把页面盖住）
  window.MM_BOOTING = true;
  document.documentElement.classList.add("mm-booting");
  var st = document.createElement("style");
  st.textContent = "html.mm-booting body>*{visibility:hidden}html.mm-booting body::before{content:'正在准备思维导图……';visibility:visible;position:fixed;inset:0;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#667}";
  document.head.appendChild(st);
  var reloaded = false;
  function go() { if (reloaded) return; reloaded = true; location.reload(); }
  navigator.serviceWorker.addEventListener("controllerchange", go);
  navigator.serviceWorker.register(SW, { scope: SCOPE }).then(function () { return navigator.serviceWorker.ready; }).then(function () {
    setTimeout(function () { if (navigator.serviceWorker.controller) go(); }, 300);
    setTimeout(go, 4000);
  }).catch(function (e) {
    document.documentElement.classList.remove("mm-booting");
    var b = document.getElementById("banner"); if (b) { b.textContent = "思维导图存储没准备好：" + (e && e.message || e) + "。请刷新页面重试；无痕模式下可能用不了。"; b.className = "on"; }
  });
})();
