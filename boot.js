// 尽早套用风格、配色和背景，避免页面先白一下再变
(function () {
  // ---------- 配色：一个主色 + 一个点缀色，自动算出整套颜色 ----------
  function hex2rgb(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; });
    var n = parseInt(h, 16);
    return /^[0-9a-f]{6}$/i.test(h) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [30, 160, 255];
  }
  function rgb2hex(c) { return "#" + c.map(function (x) { return ("0" + Math.round(Math.max(0, Math.min(255, x))).toString(16)).slice(-2); }).join(""); }
  function mix(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
  function lum(h) {
    return hex2rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  // 按钮上是白字：主色太浅时自动加深，保证看得清
  function readable(h) { var c = h, i = 0; while ((1.05) / (lum(c) + 0.05) < 3 && i++ < 12) c = mix(c, "#000000", 0.12); return c; }
  function rgba(h, a) { var c = hex2rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function derive(p, s, skin) {
    var P = readable(p), S = s || "#ff7b2e", v = {};
    v.accent = P; v.blue = P; v.today = skin === "vivid" ? S : P; v["m-top"] = S;
    if (skin === "dark") {
      v.selected = mix(P, "#000000", 0.82); v.hover = mix(P, "#000000", 0.9);
    } else {
      v.selected = mix(p, "#ffffff", 0.86); v.hover = mix(p, "#ffffff", 0.93);
    }
    if (skin === "vivid") {
      v.bg = mix(p, "#ffffff", 0.78); v.bg2 = mix(p, "#ffffff", 0.95); v.line = mix(p, "#ffffff", 0.9); v["muted-bg"] = mix(p, "#ffffff", 0.96);
      v.hero = "linear-gradient(165deg, " + mix(p, "#ffffff", 0.2) + " 0%, " + mix(p, "#ffffff", 0.5) + " 58%, " + mix(p, "#ffffff", 0.8) + " 100%)";
      v["tile-a"] = "linear-gradient(140deg, " + mix(S, "#ffffff", 0.3) + " 0%, " + S + " 100%)";
      v["tile-b"] = "linear-gradient(140deg, " + mix(p, "#ffffff", 0.45) + " 0%, " + P + " 100%)";
      v.shadow = "0 14px 34px -16px " + rgba(P, 0.38);
      v["nav-on-shadow"] = "0 8px 20px -10px " + rgba(P, 0.5);
      v["add-bg"] = "linear-gradient(135deg, " + mix(p, "#ffffff", 0.15) + ", " + P + ")";
    }
    return v;
  }
  var applied = [];   // 只清掉自己设过的颜色，不动插件设的
  function apply(pal, skin) {
    var r = document.documentElement;
    applied.forEach(function (k) { r.style.removeProperty("--" + k); });
    applied = [];
    if (!pal || !pal.p || skin === "cyber") return null;   // 元宇宙有自己的霓虹配色
    var v = derive(pal.p, pal.s, skin);
    Object.keys(v).forEach(function (k) { r.style.setProperty("--" + k, v[k]); applied.push(k); });
    return v;
  }
  window.ccPalette = { derive: derive, apply: apply, mix: mix, readable: readable };

  try {
    var s = JSON.parse(localStorage.getItem("ui_skin_v1") || '"vivid"');
    if (["vivid", "clean", "dark", "cyber"].indexOf(s) < 0) s = "vivid";
    document.documentElement.dataset.skin = s;
    apply(JSON.parse(localStorage.getItem("ui_palette_v1") || "null"), s);
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
