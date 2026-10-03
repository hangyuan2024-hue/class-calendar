// 打开网站时分流：没登录的人先去「介绍 + 登录」页（app.html），已经登录的直接用网页版
// 不跳转的情况：已登录、选过「不登录，先逛逛」、以前不登录用过（浏览器里存着自己的事项等）、
// 从介绍页点「打开网页版」等进来（会带 ?guest=1 或先记下）、带参数或 # 的链接（邀请、功能介绍等）、安卓 App 里、添加到主屏幕后打开、爬虫
(function () {
  try {
    if (/ClassCalendarApp|bot|spider|crawl|Headless/i.test(navigator.userAgent)) return;
    if (window.top !== window.self || /app\.html$/.test(location.pathname)) return;
    var ls = localStorage;
    var GUEST = "cc_guest_v1";
    if (ls.getItem("cc_session_v1")) { ls.removeItem(GUEST); return; }        // 已登录（以后退出登录，就回到登录页）
    if (/[?&]guest=1\b/.test(location.search)) { ls.setItem(GUEST, "1"); return; }
    if (ls.getItem(GUEST)) return;
    if (location.search || location.hash) return;
    if (navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)) return;
    // 以前不登录用过、存着自己的数据：当作访客，不打扰（退出过登录的人除外，让他们回到登录页）
    var mine = ["intro_seen_v1", GUEST, "login_last_account_v1"], used = false;
    for (var i = 0; i < ls.length; i++) if (mine.indexOf(ls.key(i)) < 0) { used = true; break; }
    if (used && !ls.getItem("login_last_account_v1")) { ls.setItem(GUEST, "1"); return; }
    ls.setItem("cc_probe_v1", "1"); if (ls.getItem("cc_probe_v1") !== "1") return;   // 存不了东西就别跳，免得来回跳
    ls.removeItem("cc_probe_v1");
    document.documentElement.style.visibility = "hidden";
    location.replace("app.html");
  } catch (e) { /* 出错就留在网页版 */ }
})();
