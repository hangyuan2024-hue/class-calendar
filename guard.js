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
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || typeof d !== "object") return;
    if (d.cc === "theme" || d.cc === "resetTheme") {
      e.stopImmediatePropagation();
      setTimeout(stabilizeAppearance, 0);
    }
  }, true);

  var VALID_SKINS = { fresh: 1, auto: 1, vivid: 1, clean: 1, dark: 1, cyber: 1 };

  // 「深空蓝」保留上一版的高饱和蓝 + 暖橙组合。
  // 内部仍通过主站现有“自定义配色”入口保存，确保云同步照常工作。
  var DEEP_SPACE = {
    id: "custom",
    name: "深空蓝",
    p: "#1ea0ff",
    s: "#ff7b2e"
  };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (e) { return fallback; }
  }

  function validHex(x) { return /^#[0-9a-f]{6}$/i.test(String(x || "")); }

  // 「默认」= 没有 ui_palette_v1 记录，让 fresh/workspace CSS 自己的柔和蓝紫基底生效。
  function currentPalette() {
    var p = readJSON("ui_palette_v1", null);
    return p && validHex(p.p) && validHex(p.s) ? p : null;
  }

  function isDeepSpace(p) {
    return !!p &&
      String(p.p || "").toLowerCase() === DEEP_SPACE.p &&
      String(p.s || "").toLowerCase() === DEEP_SPACE.s;
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

      // 有其他配色时重新应用；默认(null)时清掉行内配色，回到清爽原始柔和配色。
      if (window.ccPalette && typeof window.ccPalette.apply === "function") {
        window.ccPalette.apply(currentPalette(), s.dark ? "fresh-dark" : s.skin);
      }
    } catch (e) { /* 外观保护不能阻断页面 */ }
  }

  // 外观命名：
  // 1. 原「天空蓝」（内部 id=sky）改名为「默认」，行为仍是恢复 CSS 原始配色。
  // 2. 新增「深空蓝」，使用上一版 #1ea0ff + #ff7b2e。
  function decoratePalettePicker() {
    var box = document.getElementById("palPick");
    if (!box) return;

    var base = box.querySelector('[data-pal="sky"]');
    if (base) {
      // 保留圆点，只替换按钮中的文字节点。
      var nodes = base.childNodes;
      var changed = false;
      for (var i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) {
          nodes[i].nodeValue = "默认";
          changed = true;
          break;
        }
      }
      if (!changed) base.appendChild(document.createTextNode("默认"));
      base.setAttribute("aria-label", "默认配色");
      base.title = "默认 · 柔和蓝紫";
    }

    var pal = currentPalette();
    var deep = box.querySelector('[data-pal="deep-space"]');
    if (!deep) {
      deep = document.createElement("button");
      deep.type = "button";
      deep.className = "pal";
      deep.dataset.pal = "deep-space";
      deep.style.setProperty("--s", DEEP_SPACE.s);
      deep.innerHTML =
        '<span class="dot" style="background:linear-gradient(135deg,#6fc4ff,#1ea0ff)"></span>深空蓝';
      deep.title = "深空蓝 · 高饱和蓝 + 暖橙";
      if (base && base.nextSibling) box.insertBefore(deep, base.nextSibling);
      else if (base) box.appendChild(deep);
      else box.insertBefore(deep, box.firstChild);
    }

    // 当深空蓝实际由主站以 custom 保存时，把自动生成的“我的配色”隐藏，避免重复。
    var custom = box.querySelector('[data-pal="custom"]');
    if (custom) custom.style.display = isDeepSpace(pal) ? "none" : "";

    deep.classList.toggle("on", isDeepSpace(pal));
    if (base) base.classList.toggle("on", !pal);
  }

  // 通过主站已有 palP.oninput -> setPalette -> save -> Sync.note 保存，
  // 这样深空蓝也会和其他外观设置一样正常云同步。
  document.addEventListener("click", function (e) {
    var target = e.target;
    var btn = target && target.closest ? target.closest('#palPick [data-pal="deep-space"]') : null;
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    try {
      var p = document.getElementById("palP");
      var s = document.getElementById("palS");
      if (p && s && typeof p.oninput === "function") {
        p.value = DEEP_SPACE.p;
        s.value = DEEP_SPACE.s;
        p.oninput();
        setTimeout(decoratePalettePicker, 0);
        setTimeout(stabilizeAppearance, 0);
        return;
      }

      // 极早期兜底；正常情况下不会走到这里。
      localStorage.setItem("ui_palette_v1", JSON.stringify(DEEP_SPACE));
      stabilizeAppearance();
      setTimeout(decoratePalettePicker, 0);
    } catch (err) {}
  }, true);

  function watchPalettePicker() {
    var box = document.getElementById("palPick");
    if (!box) {
      setTimeout(watchPalettePicker, 250);
      return;
    }
    decoratePalettePicker();
    try {
      new MutationObserver(function () {
        setTimeout(decoratePalettePicker, 0);
      }).observe(box, { childList: true, subtree: false });
    } catch (e) {}
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

  window.addEventListener("pageshow", function () {
    setTimeout(stabilizeAppearance, 0);
    setTimeout(decoratePalettePicker, 50);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      setTimeout(stabilizeAppearance, 0);
      setTimeout(decoratePalettePicker, 50);
    }
  });
  try {
    var mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", function () {
      if (readJSON("ui_skin_v1", "fresh") === "auto") setTimeout(stabilizeAppearance, 0);
    });
  } catch (e) {}

  // 覆盖页面启动、插件延迟加载、同步恢复等竞态。
  [50, 250, 1000, 2500, 6000].forEach(function (ms) {
    setTimeout(stabilizeAppearance, ms);
    setTimeout(decoratePalettePicker, ms + 20);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchPalettePicker, { once: true });
  } else {
    watchPalettePicker();
  }
})();
