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
  // 7.6.2 一片白的时候查原因：记下没加载出来的脚本 / 样式、脚本报错；30 秒还没加载完，或者页面上什么都没有，就弹出说明卡片（带这些信息，截图发给我们就能看出原因）
  var D = window.__learnDiag = window.__learnDiag || { errs: [], fails: [], t0: Date.now() };
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) { if (/^(SCRIPT|LINK)$/.test(t.tagName)) D.fails.push(String(t.src || t.href || "").replace(location.origin, "")); return; }
    if (D.errs.length < 8) D.errs.push(String(e.message || "error").slice(0, 160) + " @" + String(e.filename || "").split("/").pop() + ":" + (e.lineno || 0));
  }, true);
  function watchdog(tool, cls) {
    setTimeout(function () {
      if (document.getElementById("lbh") || document.documentElement.classList.contains(cls)) return;
      var text = document.body ? (document.body.innerText || "").replace(/\s+/g, "").length : 0;
      var framed = false; try { framed = window.top !== window; } catch (e) { framed = true; }   // 嵌在课内里的导图预览页本来就没什么字，不按字数判断
      var bad = document.readyState !== "complete" || D.fails.length > 0 || (!framed && ((text < 30 && D.errs.length > 0) || text < 5));
      if (!bad) return;
      var show = function () { if (window.LearnBootHelp) window.LearnBootHelp.show({ tool: tool, why: "broken", diag: D }); };
      if (window.LearnBootHelp) return show();
      var s = document.createElement("script"); s.src = new URL("../boot-help.js?v=762", location.href).href; s.onload = show;
      (document.head || document.documentElement).appendChild(s);
    }, 30000);
  }
  watchdog("思维导图", "mm-booting");
  // 7.6.1 打不开时显示说明卡片（原因 + 怎么办），见 ../boot-help.js
  function help(why, err) {
    document.documentElement.classList.remove("mm-booting");
    var show = function () { if (window.LearnBootHelp) window.LearnBootHelp.show({ tool: "思维导图", why: why, err: err }); };
    if (window.LearnBootHelp) return show();
    var s = document.createElement("script"); s.src = new URL("../boot-help.js?v=762", location.href).href; s.onload = show;
    (document.head || document.documentElement).appendChild(s);
  }
  // 刷新了好几次还没被接管（有的浏览器的省流 / 极速模式会这样）：别一直刷新，停下来说明原因
  function bump() {
    try { var r = JSON.parse(sessionStorage.getItem("learn_boot_n") || "null"), now = Date.now(); if (!r || now - r.t > 60000) r = { n: 0, t: now }; r.n++; sessionStorage.setItem("learn_boot_n", JSON.stringify(r)); return r.n; } catch (e) { return 0; }
  }
  if (!("serviceWorker" in navigator)) { window.MM_BOOTING = true; help("nosw"); return; }
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
    try { sessionStorage.removeItem("learn_boot_n"); } catch (e) {}
    // 有新版 sw.js 时后台更新，下次打开生效
    navigator.serviceWorker.register(SW, { scope: SCOPE }).catch(function () {});
    return;
  }
  // 第一次：先装好再刷新（装好之前页面里的请求都会失败，所以先把页面盖住）
  window.MM_BOOTING = true;
  document.documentElement.classList.add("mm-booting");
  var st = document.createElement("style");
  st.textContent = "html.mm-booting body>*{visibility:hidden!important}html.mm-booting body{background:#f4f6fb}html.mm-booting body::before{content:'正在准备思维导图……第一次打开要下载组件，请稍等';visibility:visible;position:fixed;inset:0;display:grid;place-items:center;padding:0 24px;text-align:center;font:600 15px/1.8 -apple-system,\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif;color:#2b3a55}html.mm-booting body::after{content:'';visibility:visible;position:fixed;left:50%;top:calc(50% - 56px);width:28px;height:28px;margin-left:-14px;border-radius:50%;border:3px solid #d5ddeb;border-top-color:#4c6fff;animation:lbspin .9s linear infinite}@keyframes lbspin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
  if (bump() > 3) { help("loop"); return; }
  var reloaded = false, slow = setTimeout(function () { help("stuck"); }, 25000);
  function go() { if (reloaded) return; reloaded = true; clearTimeout(slow); location.reload(); }
  navigator.serviceWorker.addEventListener("controllerchange", go);
  navigator.serviceWorker.register(SW, { scope: SCOPE }).then(function () { return navigator.serviceWorker.ready; }).then(function () {
    setTimeout(function () { if (navigator.serviceWorker.controller) go(); }, 300);
    setTimeout(go, 4000);
  }).catch(function (e) { clearTimeout(slow); help("error", e); });
})();
