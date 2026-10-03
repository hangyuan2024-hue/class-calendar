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
