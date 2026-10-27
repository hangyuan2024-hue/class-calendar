/* site-pre.js —— 课内学习 · 网页版启动（捞捞学习板块）
 * 课内本机版要在电脑上运行 node back/server.js；网站上改由 /learn/sw.js（Service Worker）在浏览器里提供同一套 /api 接口，
 * 数据存在本浏览器里，登录后自动备份到捞捞账号（../learn-sync.js）。第一次打开要先装好 sw.js 再刷新一次。 */
(function () {
  "use strict";
  var here = location.pathname.replace(/[^/]*$/, "");          // /learn/courses/
  window.COURSES_API_BASE = here + "api";
  window.MINDMAP_APP_URL = new URL("../mindmap/", location.href).href;
  window.LEARN_WEB = true;
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
  if (location.protocol !== "file:") watchdog("课内学习", "learn-booting");

  // 7.6.1 打不开时显示说明卡片（原因 + 怎么办），见 ../boot-help.js
  function help(why, err) {
    document.documentElement.classList.remove("learn-booting");
    var show = function () { if (window.LearnBootHelp) window.LearnBootHelp.show({ tool: "课内学习", why: why, err: err }); };
    if (window.LearnBootHelp) return show();
    var s = document.createElement("script"); s.src = new URL("../boot-help.js?v=762", location.href).href; s.onload = show;
    (document.head || document.documentElement).appendChild(s);
  }
  // 刷新了好几次还没被接管（有的浏览器的省流 / 极速模式会这样）：别一直刷新，停下来说明原因
  function bump() {
    try { var r = JSON.parse(sessionStorage.getItem("learn_boot_n") || "null"), now = Date.now(); if (!r || now - r.t > 60000) r = { n: 0, t: now }; r.n++; sessionStorage.setItem("learn_boot_n", JSON.stringify(r)); return r.n; } catch (e) { return 0; }
  }
  if (!("serviceWorker" in navigator) || location.protocol === "file:") { window.LEARN_BOOTING = true; help("nosw"); return; }
  var sw = new URL("../sw.js", location.href).pathname, scope = new URL("../", location.href).pathname;
  if (navigator.serviceWorker.controller) {
    try { sessionStorage.removeItem("learn_boot_n"); } catch (e) {}
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
  st.textContent = "html.learn-booting body>*{visibility:hidden!important}html.learn-booting body{background:#f4f6fb}html.learn-booting body::before{content:'正在准备课内学习……第一次打开要下载组件，请稍等';visibility:visible;position:fixed;inset:0;display:grid;place-items:center;padding:0 24px;text-align:center;font:600 15px/1.8 -apple-system,\"PingFang SC\",\"Microsoft YaHei\",system-ui,sans-serif;color:#2b3a55}html.learn-booting body::after{content:'';visibility:visible;position:fixed;left:50%;top:calc(50% - 56px);width:28px;height:28px;margin-left:-14px;border-radius:50%;border:3px solid #d5ddeb;border-top-color:#4c6fff;animation:lbspin .9s linear infinite}@keyframes lbspin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
  if (bump() > 3) { help("loop"); return; }
  var done = false, slow = setTimeout(function () { help("stuck"); }, 25000);
  function go() { if (done) return; done = true; clearTimeout(slow); location.reload(); }
  navigator.serviceWorker.addEventListener("controllerchange", go);
  navigator.serviceWorker.register(sw, { scope: scope }).then(function () { return navigator.serviceWorker.ready; }).then(function () {
    setTimeout(function () { if (navigator.serviceWorker.controller) go(); }, 300);
    setTimeout(go, 4000);
  }).catch(function (e) { clearTimeout(slow); help("error", e); });
})();
