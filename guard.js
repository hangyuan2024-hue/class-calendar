// 防止本站页面被别的网站嵌进去（点击劫持），并保护新版外观系统不被旧主题插件覆盖。
(function () {
  "use strict";

  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* 对方禁止跳转时，页面保持隐藏 */ }
    return;
  }

  // 旧的「个性化主题」插件已经被“我的 → 外观”取代。
  // 它仍可能从旧缓存/云端插件列表启动，并在延迟加载后 resetTheme()，
  // 从而把清爽 + 天空蓝的行内颜色删掉，页面就会突然回落到 Codex CSS 的靛紫默认色。
  // 在 app.js 的 message 监听器之前拦截这两个旧主题消息，其他插件消息完全不受影响。
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.cc === "theme" || d.cc === "resetTheme") {
      e.stopImmediatePropagation();
      setTimeout(stabilizeAppearance, 0);
    }
  }, true);

  var SKY = { id: "sky", name: "天空蓝", p: "#1ea0ff", s: "#ff7b2e" };
  var VALID_SKINS = { fresh: 1, auto: 1, vivid: 1, clean: 1, dark: 1, cyber: 1 };
  var paletteApi = null;
  var rawApply = null;

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (e) { return fallback; }
  }

  function validHex(x) { return /^#[0-9a-f]{6}$/i.test(String(x || "")); }

  function currentPalette() {
    var p = readJSON("ui_palette_v1", null);
    return p && validHex(p.p) && validHex(p.s) ? p : SKY;
  }

  function currentSkin() {
    var want = readJSON("ui_skin_v1", "fresh");
    if (!VALID_SKINS[want]) want = "fresh";
    var dark = want === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    return { want: want, skin: want === "auto" ? "fresh" : want, dark: !!dark };
  }

  function expectedMode(s) { return s.dark ? "fresh-dark" : s.skin; }

  function stabilizeAppearance() {
    try {
      if (!paletteApi || typeof paletteApi.apply !== "function") return;
      var s = currentSkin();
      var root = document.documentElement;
      // localStorage 是外观设置的唯一来源；修复旧插件/旧缓存把 DOM 改成另一套皮肤的情况。
      root.dataset.skin = s.skin;
      if (s.want === "auto" && s.dark) root.dataset.mode = "dark";
      else delete root.dataset.mode;
      paletteApi.apply(currentPalette(), expectedMode(s));
    } catch (e) { /* 外观保护绝不能阻断页面启动 */ }
  }

  // 天空蓝过去用“没有 ui_palette_v1 记录”表示。Codex 后来把 fresh 的 CSS 默认主色改成了靛紫，
  // 所以 null 已经不能再等同于天空蓝。包一层 ccPalette.apply：没有记录时显式应用天空蓝。
  try {
    Object.defineProperty(window, "ccPalette", {
      configurable: true,
      enumerable: true,
      get: function () { return paletteApi; },
      set: function (v) {
        paletteApi = v;
        if (v && typeof v.apply === "function" && !v.__laolaoStableTheme) {
          rawApply = v.apply.bind(v);
          v.apply = function (pal, skin) {
            var safe = pal && validHex(pal.p) && validHex(pal.s) ? pal : SKY;
            return rawApply(safe, skin);
          };
          try { Object.defineProperty(v, "__laolaoStableTheme", { value: true }); } catch (e) { v.__laolaoStableTheme = true; }
        }
        // boot.js 在赋值后还会执行一次自己的旧初始化；放到下一任务再修正，避免被它清回去。
        setTimeout(stabilizeAppearance, 0);
      }
    });
  } catch (e) { /* 极老浏览器直接使用后面的定时修复 */ }

  // 把旧主题插件从“已启用插件”里移除。若还没有显式启用列表，就用已缓存的插件注册表
  // 生成默认列表，但排除 theme；当前页即使已经启动了旧插件，上面的 message 拦截仍会保护外观。
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
  // 云同步可能把旧的 plugins_enabled_v1 再拉回来，因此做很轻量的周期清理。
  setInterval(retireLegacyThemePlugin, 15000);

  // 页面恢复、系统深浅色变化时再校正一次；正常用户操作仍以 localStorage 中的最新选择为准。
  window.addEventListener("pageshow", function () { setTimeout(stabilizeAppearance, 0); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(stabilizeAppearance, 0); });
  try {
    var mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", function () {
      if (readJSON("ui_skin_v1", "fresh") === "auto") setTimeout(stabilizeAppearance, 0);
    });
  } catch (e) {}

  // app.js 会在启动、同步、切页时调用 applyLook/applyPalette；再做几次短延迟校正，
  // 覆盖旧 Service Worker/插件代码延迟启动的竞态，不长期轮询页面样式。
  [50, 250, 1000, 2500, 6000].forEach(function (ms) { setTimeout(stabilizeAppearance, ms); });
})();
