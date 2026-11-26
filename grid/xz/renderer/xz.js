// 捞小智电脑版：页面一打开就进入「捞小智」（show.js 靠 lg-page 事件知道进来了）
//   顶上的「体验版」说明：还有没训练好的部分就一直显示（每次打开都显示）；全部训练好了自动消失
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  $("#xzHide").onclick = () => { $("#xzTrial").hidden = true; };
  $("#xzSite").onclick = () => window.lg.call("openSite").catch(() => {});
  window.dispatchEvent(new CustomEvent("lg-page", { detail: "show" }));
  async function check() {
    try {
      const S = await window.lg.call("showState");
      const parts = (S && S.product && S.product.parts) || [];
      if (parts.length && parts.every((p) => p.ready)) $("#xzTrial").hidden = true;
    } catch (e) {}
  }
  setTimeout(check, 3000); setInterval(check, 10 * 60e3);
})();
// 左边栏：新对话、插件、最近的对话（show.js 管列表）；插件页顶上「回到对话」；对话框下面「接自己的模型…」也跳到插件页
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const go = (p) => {
    document.querySelectorAll(".page").forEach((x) => x.classList.toggle("on", x.id === "p-" + p));
    document.querySelectorAll(".side a[data-p]").forEach((a) => a.classList.toggle("on", a.dataset.p === p));
    window.dispatchEvent(new CustomEvent("lg-page", { detail: p }));
  };
  document.querySelectorAll(".side a[data-p]").forEach((a) => (a.onclick = () => go(a.dataset.p)));
  const back = document.createElement("button"); back.className = "btn small"; back.textContent = "← 回到对话"; back.style.marginLeft = "12px"; back.onclick = () => go("show");
  const h2 = $("#p-plugins h2"); if (h2) h2.appendChild(back);
  window.addEventListener("lg-go", (e) => go(e.detail));
})();
