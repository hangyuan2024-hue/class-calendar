// 6.5 板块页（learn/、code/）：显示「已登录 xx / 登录捞捞账号」，和网站同一个账号
(function () {
  "use strict";
  var el = document.querySelector("[data-who]");
  if (!el || !window.CCAuth) return;
  var here = el.getAttribute("data-who");   // 登录后回到哪（learn/、code/）
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var paint = function (me) {
    el.classList.toggle("on", !!me);
    el.innerHTML = me
      ? '<span class="dot"></span>已登录 <b>' + esc(me.display_name || me.account || "") + "</b> · 三个板块用同一个账号"
      : '<span class="dot"></span>还没登录 · <a href="../app.html?next=' + encodeURIComponent(here) + '#login">登录捞捞账号</a>，导图、学习记录跟着账号走';
  };
  paint(null);
  window.CCAuth.me().then(function (me) { paint(me && me.id ? me : null); }, function () {});
})();
