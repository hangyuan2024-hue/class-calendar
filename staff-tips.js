// 7.55 入班申请提醒（7.28 SQL：my_join_requests，和小程序 1.24.5 首页「入班申请」一样）
//   老师、能审批的班委：有同学申请加入时，首页顶上出现一行「X 班有 N 人申请入班」，点开去班级页审批
(function () {
  "use strict";
  const logged = () => typeof currentUser !== "undefined" && !!currentUser;
  let at = 0, bar = null;
  async function check(force) {
    if (!logged() || typeof CCAuth === "undefined") { if (bar) bar.hidden = true; return; }
    if (!force && Date.now() - at < 120000) return;
    at = Date.now();
    let l = [];
    try { l = await CCAuth.rpc("my_join_requests", {}); } catch (e) { return; }
    if (!Array.isArray(l)) l = [];   // 服务器还没有 7.28
    const home = document.querySelector('section.view[data-view="home"]'); if (!home) return;
    if (!bar) {
      bar = document.createElement("a"); bar.href = "class.html"; bar.id = "joinReqBar"; bar.className = "surface";
      bar.style.cssText = "display:flex;align-items:center;gap:10px;margin:8px 16px;padding:10px 14px;border-radius:14px;text-decoration:none;color:inherit;font-size:14px";
      const h = home.querySelector(".vhead"); if (h) h.after(bar); else home.prepend(bar);
    }
    const n = l.reduce((a, x) => a + (+x.n || 0), 0);
    bar.hidden = !n;
    if (n) bar.innerHTML = `<span style="font-size:18px">🙋</span><span style="flex:1"><b>入班申请</b> · ${l.map((x) => `${esc(x.name)} ${x.n} 人`).join("、")}在等你批准</span><span>去审批 ›</span>`;
  }
  setTimeout(() => check(true), 3500);
  setInterval(() => { if (!document.hidden) check(false); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(false); });
})();
