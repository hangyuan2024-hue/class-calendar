// 尽早套用风格和背景，避免页面先白一下再变
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("ui_skin_v1") || '"vivid"');
    if (["vivid", "clean", "dark", "cyber"].indexOf(s) < 0) s = "vivid";
    document.documentElement.dataset.skin = s;
    var bg = localStorage.getItem("ui_bg_v1");
    if (bg) {
      var o = JSON.parse(localStorage.getItem("ui_bg_opts_v1") || "{}");
      var r = document.documentElement;
      r.classList.add("has-bg");
      r.style.setProperty("--bg-img", 'url("' + bg + '")');
      r.style.setProperty("--bg-dim", (o.dim == null ? 40 : o.dim) / 100);
      r.style.setProperty("--bg-blur", (o.blur == null ? 6 : o.blur) + "px");
    }
  } catch (e) {}
})();
