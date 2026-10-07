// 防止本站页面被别的网站嵌进去（点击劫持），并保护新版外观系统不被旧主题插件覆盖。
(function () {
  "use strict";

  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* 对方禁止跳转时，页面保持隐藏 */ }
    return;
  }

  // 旧的「个性化主题」插件已经被“我的 → 外观”取代。
  // 它可能从旧缓存/同步记录延迟启动并发送 resetTheme/theme，导致当前外观突然变色。
  // 在 app.js 的 message 监听器之前拦截这两个旧消息；其他插件完全不受影响。
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.cc === "theme" || d.cc === "resetTheme") {
      e.stopImmediatePropagation();
      setTimeout(stabilizeAppearance, 0);
    }
  }, true);

  var VALID_SKINS = { fresh: 1, auto: 1, vivid: 1, clean: 1, dark: 1, cyber: 1 };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (e) { return fallback; }
  }

  function validHex(x) { return /^#[0-9a-f]{6}$/i.test(String(x || "")); }

  // 重要：天空蓝在原站里用“没有 ui_palette_v1 记录”表示。
  // 这里必须保留 null，让 fresh/workspace-v2.css 自己的柔和蓝紫基底生效，
  // 不能再强制写入 #1ea0ff/#ff7b2e，否则会变成高饱和蓝橙版。
  function currentPalette() {
    var p = readJSON("ui_palette_v1", null);
    return p && validHex(p.p) && validHex(p.s) ? p : null;
  }

  function currentSkin() {
    var want = readJSON("ui_skin_v1", "fresh");
    if (!VALID_SKINS[want]) want = "fresh";
    var dark = want === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    return { want: want, skin: want === "auto" ? "fresh" : want, dark: !!dark };
  }

  function stabilizeAppearance() {
    try {
      var s = currentSkin();
      var root = document.documentElement;
      root.dataset.skin = s.skin;
      if (s.want === "auto" && s.dark) root.dataset.mode = "dark";
      else delete root.dataset.mode;

      // 有自定义/其他配色时重新应用；天空蓝(null)时清掉旧行内变量，
      // 回到 CSS 中原本的清爽柔和配色。
      if (window.ccPalette && typeof window.ccPalette.apply === "function") {
        window.ccPalette.apply(currentPalette(), s.dark ? "fresh-dark" : s.skin);
      }
    } catch (e) { /* 外观保护不能阻断页面 */ }
  }

  // 把旧主题插件从已启用列表里移除。若云同步把旧状态拉回来，也会再次清理。
  function retireLegacyThemePlugin() {
    try {
      var key = "plugins_enabled_v1";
      var raw = localStorage.getItem(key);
      if (raw != null) {
        var list = JSON.parse(raw);
        if (Array.isArray(list) && list.indexOf("theme") >= 0) {
          localStorage.setItem(key, JSON.stringify(list.filter(function (x) { return x !== "theme"; })));
        }
        return;
      }
      var reg = readJSON("plugin_registry_v1", null);
      if (!reg || !Array.isArray(reg.list) || !reg.list.some(function (p) { return p && p.id === "theme"; })) return;
      var defaults = reg.list
        .filter(function (p) { return p && p.id !== "theme" && p.default_on && (p.channel == null || p.channel === "published"); })
        .map(function (p) { return p.key || p.id; })
        .filter(Boolean);
      localStorage.setItem(key, JSON.stringify(defaults));
    } catch (e) {}
  }

  retireLegacyThemePlugin();
  setInterval(retireLegacyThemePlugin, 15000);

  window.addEventListener("pageshow", function () { setTimeout(stabilizeAppearance, 0); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(stabilizeAppearance, 0);
  });
  try {
    var mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", function () {
      if (readJSON("ui_skin_v1", "fresh") === "auto") setTimeout(stabilizeAppearance, 0);
    });
  } catch (e) {}

  // 覆盖页面启动、插件延迟加载、同步恢复等竞态。
  [50, 250, 1000, 2500, 6000].forEach(function (ms) { setTimeout(stabilizeAppearance, ms); });
})();
