// 用户协议、隐私政策里用到的信息：改这里就行（两个页面和登录页都会跟着变）
//   contact：联系方式（邮箱 / QQ 群等），用户咨询、投诉、要求删除数据时找你们。不填会显示「通过班级管理员联系我们」
//   ver：协议版本，内容有大改时改成新日期，已经勾选过同意的人会被要求重新勾选
window.LEGAL_INFO = {
  app: "捞捞课程表",
  team: "信息捞捞队",
  contact: "laolaokechengbiao@163.com",
  updated: "2026年10月10日",
  ver: "2026-10-10",
};
(function () {
  function fill() {
    var L = window.LEGAL_INFO;
    document.querySelectorAll("[data-li]").forEach(function (el) {
      var k = el.getAttribute("data-li");
      if (k === "contact") el.textContent = L.contact ? L.contact : "通过你所在班级的老师 / 管理员转达给我们";
      else if (L[k]) el.textContent = L[k];
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
