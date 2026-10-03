// 介绍 + 登录页：已经登录的人只看介绍和下载，不显示登录框
(function () {
  try { if (localStorage.getItem("cc_session_v1")) document.documentElement.classList.add("authed"); } catch (e) {}
  // 没登录、从这里点去网页版（「打开网页版」「不登录，先逛逛」等）：记下来，网页版就不会再把你送回这里
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="index.html"]');
    if (a) try { localStorage.setItem("cc_guest_v1", "1"); } catch (e2) {}
  }, true);
})();
