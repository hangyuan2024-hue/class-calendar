/* theme.js —— 课内学习跟着捞捞网站的外观走（清爽 / 简约 / 书页 / 捞捞元宇宙，浅色 / 深色 / 跟随系统）
 * 网站在「设置 → 外观」或左下角菜单里选的外观存在本浏览器（ui_skin_v1、ui_mode_v1），这里读同一份；
 * 页面上加 data-look、data-tone，颜色在 theme.css（打包时自动生成）。右上角的小按钮可以临时切深浅色。 */
(function () {
  "use strict";
  var LOOKS = { fresh: 1, clean: 1, paper: 1, cyber: 1 };
  function rd(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function state() {
    var s = rd("ui_skin_v1", "fresh"), legacy = "";
    if (s === "vivid") s = "fresh"; else if (s === "dark") { s = "fresh"; legacy = "dark"; } else if (s === "auto") { s = "fresh"; legacy = "system"; }
    if (!LOOKS[s]) s = "fresh";
    var modes = rd("ui_mode_v1", {}) || {}, pm = rd("compose_mode_v1", "");
    var mode = modes[s] || legacy || (/^(dark|light|system)$/.test(pm) && s !== "cyber" ? pm : "") || (s === "cyber" ? "dark" : "light");
    var sys = !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    return { look: s, mode: mode, dark: mode === "dark" || (mode === "system" && sys) };
  }
  function apply() {
    var st = state(), r = document.documentElement;
    r.dataset.look = st.look; r.dataset.tone = st.dark ? "dark" : "light";
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    try { window.dispatchEvent(new CustomEvent("learn-theme", { detail: st })); } catch (e) {}
    m.content = st.dark ? (st.look === "paper" ? "#1b1916" : st.look === "clean" ? "#121214" : st.look === "cyber" ? "#080e1c" : "#131e21") : (st.look === "paper" ? "#f3eee3" : st.look === "cyber" ? "#edf2fb" : "#ffffff");
    return st;
  }
  window.LearnTheme = {
    state: state, apply: apply,
    // 切深浅色：记在当前外观上（和网站同一份设置）
    toggle: function () {
      var st = state(), modes = Object.assign({}, rd("ui_mode_v1", {}) || {});
      modes[st.look] = st.dark ? "light" : "dark";
      try { localStorage.setItem("ui_mode_v1", JSON.stringify(modes)); localStorage.setItem("compose_mode_v1", JSON.stringify(modes[st.look])); } catch (e) {}
      return apply();
    },
  };
  apply();
  window.addEventListener("storage", function (e) { if (/^(ui_skin_v1|ui_mode_v1|compose_mode_v1)$/.test(e.key || "")) apply(); });
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply); } catch (e) {}
})();
