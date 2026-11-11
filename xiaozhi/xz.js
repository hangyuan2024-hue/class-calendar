/* 捞小智入口：地址和状态在 site-config.js 的 xiaozhi 里改（url 留空 = 内测准备中，按钮点不了） */
(function () {
  "use strict";
  var c = (window.LAOLAO_SITE && window.LAOLAO_SITE.xiaozhi) || {};
  var url = String(c.url || "").trim();
  var ok = /^https:\/\//.test(url);
  var st = document.getElementById("xzSt"), go = document.getElementById("xzGo"), hint = document.getElementById("xzHint");
  if (st) { st.classList.toggle("on", ok); st.querySelector("span").textContent = ok ? (c.status && c.status !== "内测准备中" ? c.status : "内测中") : (c.status || "内测准备中"); }
  if (!go) return;
  if (ok) {
    go.href = url; go.target = "_blank"; go.rel = "noopener"; go.removeAttribute("aria-disabled");
    go.innerHTML = '进入捞小智 <span aria-hidden="true">↗</span>';
    if (hint) hint.innerHTML = "会在新窗口打开。内容由 AI 生成，仅供参考。";
  }
})();
