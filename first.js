// 打开网站时分流：没登录 → 先去「介绍 + 登录」页（app.html）；已经登录 → 直接用网页版
// 不跳转的情况：已登录、这次打开网站时点过「不登录，先逛逛」/「打开网页版」（关掉浏览器后下次还会先到登录页）、
// 带参数或 # 的链接（邀请、功能介绍等）、安卓 App 里、爬虫
(function () {
  try {
    if (/ClassCalendarApp|bot|spider|crawl|Headless/i.test(navigator.userAgent)) return;
    if (window.top !== window.self || /app\.html$/.test(location.pathname)) return;
    if (localStorage.getItem("cc_session_v1")) return;                          // 已登录
    var ss = sessionStorage, GUEST = "cc_guest_v1";
    if (/[?&]guest=1\b/.test(location.search)) { ss.setItem(GUEST, "1"); return; }
    if (ss.getItem(GUEST)) return;
    if (location.search || location.hash) return;
    document.documentElement.style.visibility = "hidden";
    location.replace("app.html");
  } catch (e) { /* 出错就留在网页版 */ }
})();

// 网站更新了（离线缓存在后台拿到了新版）：底部提示「有新版本，点这里刷新」
(function () {
  try {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data !== "cc-updated" || document.getElementById("ccUpd") || !document.body) return;
      var b = document.createElement("button"); b.id = "ccUpd"; b.type = "button"; b.textContent = "网站有新版本，点这里刷新";
      b.style.cssText = "position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;border:0;border-radius:999px;padding:10px 18px;background:#0e2240;color:#fff;font:600 14px/1.2 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;white-space:nowrap";
      b.onclick = function () { location.reload(); };
      document.body.appendChild(b);
    });
  } catch (e) {}
})();
