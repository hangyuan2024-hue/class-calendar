/* 6.10 介绍页：下载区先选板块（捞捞课程表 / 捞捞编程）；地址带 #get-code 直接打开捞捞编程 */
(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".v8-get-tabs [data-gt]"));
  if (!tabs.length) return;
  function pick(k, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-gt") === k;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls")); if (panel) panel.hidden = !on;
      if (on && focus) t.focus();
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t.getAttribute("data-gt")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault(); var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; pick(n.getAttribute("data-gt"), true);
    });
  });
  function fromHash() {
    if (location.hash === "#get-code") { pick("code"); var g = document.getElementById("get"); if (g) g.scrollIntoView(); }
  }
  window.addEventListener("hashchange", fromHash); fromHash();
})();
