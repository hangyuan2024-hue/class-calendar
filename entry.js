// 介绍 + 登录页：已经登录的人只看介绍和下载，不显示登录框
(function () {
  try { if (localStorage.getItem("cc_session_v1")) document.documentElement.classList.add("authed"); } catch (e) {}
  // 没登录、从这里点去网页版（「打开网页版」「不登录，先逛逛」等）：记下来，网页版就不会再把你送回这里
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="index.html"]');
    if (a) try { sessionStorage.setItem("cc_guest_v1", "1"); } catch (e2) {}
  }, true);
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

// 离线缓存：第二次打开几乎不用等
(function () {
  try {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || localStorage.getItem("sw_test")))
      window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  } catch (e) {}
})();
