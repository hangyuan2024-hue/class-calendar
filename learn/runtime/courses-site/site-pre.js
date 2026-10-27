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

  // 7.6.4 第一次打开：显示下载进度条（下载了几个文件、多少 MB），页面文件都下完、存储组件也装好了再刷新
  var ui = (function () {
    var css = "html.learn-booting body>*{visibility:hidden!important}html.learn-booting body{background:#f4f6fb}" +
      ".lbp{position:fixed;inset:0;z-index:2147482000;display:none;place-items:center;padding:16px;background:#f4f6fb;font:14px/1.7 -apple-system,'PingFang SC','Microsoft YaHei',system-ui,sans-serif;color:#2b3a55}" +
      "html.learn-booting .lbp{display:grid}.lbp-c{width:min(420px,100%);text-align:center}.lbp-c b{display:block;font-size:17px;margin-bottom:4px;color:#1d2a3a}" +
      ".lbp-c p{margin:0;color:#6b7a90;font-size:13px}.lbp-bar{height:8px;margin:18px 0 10px;border-radius:8px;background:#e1e7f2;overflow:hidden}" +
      ".lbp-bar i{display:block;height:100%;width:2%;border-radius:8px;background:linear-gradient(90deg,#4c6fff,#2fb6a0);transition:width .35s}" +
      ".lbp-n{display:flex;justify-content:space-between;font-size:12.5px;color:#46566b;font-variant-numeric:tabular-nums}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var box = document.createElement("div"); box.className = "lbp"; box.setAttribute("role", "progressbar"); box.setAttribute("aria-valuemin", "0"); box.setAttribute("aria-valuemax", "100");
    box.innerHTML = '<div class="lbp-c"><b>正在下载课内学习</b><p>只有第一次打开要下载，之后会快很多</p><div class="lbp-bar"><i></i></div><div class="lbp-n"><span class="lbp-t">准备中…</span><span class="lbp-p">0%</span></div></div>';
    document.documentElement.appendChild(box);   // 放在 body 外面：body 里的东西都先藏着
    var bar = box.querySelector("i"), t = box.querySelector(".lbp-t"), pc = box.querySelector(".lbp-p");
    // 每个页面大概要下载多少个文件（打开一次数出来的，差一点没关系，到 100% 之前会停在 96%）
    var EXP = { "index.html": 74 }, page = location.pathname.split("/").pop() || "index.html";
    var expect = EXP[page] || EXP["index.html"], files = 0, bytes = 0, swOk = false, last = Date.now(), shown = 0;
    function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }
    function paint(final) {
      var v = final ? 100 : Math.min(96, Math.round(Math.min(1, files / expect) * 88 + (swOk ? 8 : 0) + 2));
      if (v < shown) v = shown; shown = v;
      bar.style.width = v + "%"; pc.textContent = v + "%"; box.setAttribute("aria-valuenow", String(v));
      t.textContent = final ? "下载完成，正在打开…" : "已下载 " + files + " 个文件 · " + mb(bytes);
    }
    function add(list) {
      list.forEach(function (e) { files++; bytes += e.transferSize || e.encodedBodySize || 0; });
      if (list.length) { last = Date.now(); paint(false); }
    }
    try {
      add(performance.getEntriesByType("resource"));
      new PerformanceObserver(function (l) { add(l.getEntries()); }).observe({ type: "resource" });
    } catch (e) {}
    paint(false);
    return { sw: function () { swOk = true; last = Date.now(); paint(false); }, done: function () { paint(true); }, idle: function () { return Date.now() - last; } };
  })();
  if (bump() > 3) { help("loop"); return; }
  // 卡住了才提示：25 秒一点进展都没有（不是「总共超过 25 秒」，网慢但一直在下载就接着等）
  var reloaded = false, loaded = document.readyState === "complete", swReady = false;
  var slow = setInterval(function () { if (ui.idle() > 25000) { clearInterval(slow); help("stuck"); } }, 2000);
  function go() { if (reloaded) return; reloaded = true; clearInterval(slow); ui.done(); setTimeout(function () { location.reload(); }, 150); }
  // 页面文件都下完（刷新后直接用浏览器缓存）、存储组件也装好了，再刷新；文件迟迟下不完的话，组件好了 60 秒后也刷新
  function maybe() { if (swReady && loaded) go(); }
  window.addEventListener("load", function () { loaded = true; maybe(); });
  function ready() { if (swReady) return; swReady = true; ui.sw(); maybe(); setTimeout(go, 60000); }
  navigator.serviceWorker.addEventListener("controllerchange", ready);
  navigator.serviceWorker.register(sw, { scope: scope }).then(function () { return navigator.serviceWorker.ready; }).then(function () {
    setTimeout(ready, navigator.serviceWorker.controller ? 0 : 1500);
  }).catch(function (e) { clearInterval(slow); help("error", e); });
})();
