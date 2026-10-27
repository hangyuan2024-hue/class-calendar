// 7.5 首页「感谢名单」：读后台的感谢名单（credit_list，不登录也能读；App「我的 → 感谢名单」里管理员维护的同一份）
(function () {
  "use strict";
  var box = document.getElementById("h6Thanks"), list = document.getElementById("h6ThanksList");
  if (!box || !list || !window.CCAuth || typeof CCAuth.rpc !== "function") return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function paint(rows) {
    rows = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.name; });
    if (!rows.length) { box.hidden = true; return; }
    list.innerHTML = rows.map(function (r) {
      return '<li class="h6-thx"><span class="h6-thx-av" aria-hidden="true">' + esc(String(r.name).trim().slice(0, 1)) + '</span><div><b>' + esc(r.name) + '</b>' + (r.contribution ? '<p>' + esc(r.contribution) + '</p>' : "") + '</div></li>';
    }).join("");
    box.hidden = false;
  }
  // 首屏不急着要：等页面空闲了再去拿
  var go = function () { CCAuth.rpc("credit_list").then(paint, function () { box.hidden = true; }); };
  if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 800);
})();
