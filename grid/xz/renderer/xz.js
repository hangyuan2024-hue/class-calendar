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
