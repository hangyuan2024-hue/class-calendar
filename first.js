// 第一次打开网站：先去介绍页（app.html）看看；以后再打开就直接进网页版
// 不跳转的情况：已经用过本站（浏览器里存过东西）、带了参数或 # 的链接（邀请、功能介绍等）、
// 安卓 App 里、添加到主屏幕后打开、浏览器不让存东西（避免每次都被带走）
(function () {
  try {
    var KEY = "intro_seen_v1";
    if (localStorage.getItem(KEY)) return;
    var used = localStorage.length > 0;
    localStorage.setItem(KEY, "1");
    if (localStorage.getItem(KEY) !== "1") return;
    if (used || location.search || location.hash) return;
    // 微信、QQ 等 App 里的浏览器和各种爬虫不跳：一打开就自动跳到带下载按钮的页面，容易被微信判成可疑网页
    if (/ClassCalendarApp|MicroMessenger|\sQQ\/|WeiBo|DingTalk|AlipayClient|bot|spider|crawl|Headless/i.test(navigator.userAgent)) return;
    if (navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)) return;
    if (window.top !== window.self) return;
    document.documentElement.style.visibility = "hidden";
    location.replace("app.html");
  } catch (e) { /* 存不了东西就留在网页版 */ }
})();
