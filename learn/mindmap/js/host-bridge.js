/* =========================================================================
 * host-bridge.js —— 宿主兼容桩 + 捞捞账号接入
 *
 * vendor/mindmap.js 依赖主站 app.js 的这些全局：
 *   $ esc load save showView showBanner currentUser Sync CCAuth isMobile currentView
 * 这个文件在 vendor/mindmap.js **之前**加载，把它们补齐。三种打开方式：
 *
 *   1. 网站上直接打开（www.laolaokechengbiao.cn/learn/mindmap/）
 *      → 用网站的 auth.js（同一个捞捞账号、同一个登录状态），导图存到账号里。
 *   2. 嵌在捞捞课程表网页版 / 电脑版里（iframe，地址带 ?host=app 或 ?host=desktop）
 *      → 不自己登录：通过 postMessage 让外面那一层代为调用 mm_* 接口、告诉我当前是谁。
 *   3. 本地 `node server.js` 开发（127.0.0.1:8788）→ 没有账号，只存在这台设备（和以前一样）。
 *
 * 嵌入时的消息（都带 mmb:1，只和直接的父窗口来往）：
 *   子 → 父  {t:"hello"}                       打开了，要用户信息
 *            {t:"rpc", id, fn, args}           代为调用接口（父窗口只放行 mm_list/get/save/rename/del）
 *            {t:"rev"}                          我改了导图，通知别的设备（父窗口自己记 mm_rev_v1）
 *            {t:"back"}                         点了「返回」
 *   父 → 子  {t:"user", user, back}             当前登录的人（null = 没登录），要不要显示返回
 *            {t:"rpc-r", id, ok, data, error}  接口结果
 *            {t:"changed"}                      别的设备改了导图
 *            {t:"leave"} / {t:"create"}         离开导图页（把没传的传上去）/ 新建一张导图
 * ========================================================================= */
(function () {
  "use strict";

  var VIEW = "mindmap";
  var qs = new URLSearchParams(location.search);
  var HOST = window.parent !== window && /^(app|desktop)$/.test(qs.get("host") || "") ? qs.get("host") : "";
  window.MM_HOST = HOST || (window.CCAuth ? "web" : "local");
  document.documentElement.dataset.host = window.MM_HOST;

  /* ---------- DOM ---------- */
  window.$ = function $(id) { return document.getElementById(id); };
  window.esc = function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  window.currentView = function currentView() { return VIEW; };
  window.isMobile = function isMobile() {
    if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) return true;
    return window.innerWidth <= 720;
  };

  /* ---------- 顶部提示条 ---------- */
  window.showBanner = function showBanner(msg) {
    var el = document.getElementById("banner");
    if (!el) return;
    el.textContent = msg || "";
    el.className = msg ? "on" : "";
  };
  window.showView = function showView(_name) {
    if (typeof window.renderMindmap === "function") window.renderMindmap();
  };

  /* ---------- 跨设备变更：mm_rev_v1 一变，导图就去账号里看看 ---------- */
  var changeCbs = [];
  function emitChanged() {
    var set = new Set(["mm_rev_v1"]);
    changeCbs.forEach(function (f) { try { f(set); } catch (e) { console.error(e); } });
  }
  window.Sync = { onChange: function (f) { changeCbs.push(f); return function () {}; } };

  /* ---------- 本地存储（mm_last_v1 这些）；mm_rev_v1 要告诉别的设备 ---------- */
  window.load = function load(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  window.save = function save(k, v) {
    var ok = true;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { ok = false; }
    if (k === "mm_rev_v1") {
      if (HOST) post({ t: "rev" });
      else if (window.MM_HOST === "web" && window.CCAuth && window.currentUser) {
        // 网站上单独打开：把「导图改过了」记进账号（和课程表网页版同一个同步项），手机 / 电脑上的捞捞就知道去拿新的
        try { window.CCAuth.rpc("udata_push", { p: [{ ns: "mm_rev_v1", k: "_", v: v, t: Date.now() }] }).catch(function () {}); } catch (e) {}
      }
    }
    return ok;
  };

  /* ================= 1. 嵌在捞捞课程表里：postMessage 转接 ================= */
  function post(o) { o.mmb = 1; try { window.parent.postMessage(o, "*"); } catch (e) {} }
  if (HOST) {
    var seq = 0, waits = {}, user = null;
    Object.defineProperty(window, "currentUser", { configurable: true, get: function () { return user; } });
    window.CCAuth = {
      rpc: function (fn, args) {
        return new Promise(function (resolve, reject) {
          var id = "r" + (++seq);
          var timer = setTimeout(function () { delete waits[id]; reject(new Error("网络不好，稍后自动同步")); }, 30000);
          waits[id] = { resolve: resolve, reject: reject, timer: timer };
          post({ t: "rpc", id: id, fn: fn, args: args || {} });
        });
      },
    };
    window.addEventListener("message", function (ev) {
      if (ev.source !== window.parent) return;
      var d = ev.data || {};
      if (!d || d.mmb !== 1) return;
      if (d.t === "user") {
        var was = user ? user.id : "";
        user = d.user && d.user.id ? { id: String(d.user.id), name: String(d.user.name || "") } : null;
        // 登录信息比页面晚到：到了就去账号里拿一次列表（导图自己的「登录后上传」每 2 秒检查一次，会接着把本机的传上去）
        if (user && user.id !== was) setTimeout(emitChanged, 0);
        document.documentElement.classList.toggle("mm-has-back", !!d.back);
      } else if (d.t === "rpc-r") {
        var w = waits[d.id]; if (!w) return;
        delete waits[d.id]; clearTimeout(w.timer);
        if (d.ok) w.resolve(d.data); else w.reject(new Error(d.error || "请求失败"));
      } else if (d.t === "changed") emitChanged();
      else if (d.t === "leave") { if (typeof window.mmLeave === "function") window.mmLeave(); }
      else if (d.t === "create") { if (window.Mindmap && typeof window.Mindmap.create === "function") window.Mindmap.create(); }
    });
    window.MMBridge = { back: function () { post({ t: "back" }); } };
    post({ t: "hello" });
  }

  /* ================= 2. 网站上直接打开：用网站的捞捞账号 ================= */
  else if (window.CCAuth) {
    var u = null;
    Object.defineProperty(window, "currentUser", { configurable: true, get: function () { return u; } });
    var refresh = function () {
      return window.CCAuth.me().then(function (me) { var was = u ? u.id : ""; u = me && me.id ? me : null; paintUser(); if (u && u.id !== was) setTimeout(emitChanged, 0); }).catch(function () { u = null; paintUser(); });
    };
    refresh();
    // 别的标签页登录 / 退出、或者回到这个页面：重新看一下是谁、账号里有没有新的
    window.addEventListener("storage", function (ev) { if (ev.key === "cc_session_v1") location.reload(); if (ev.key === "mm_rev_v1") emitChanged(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh().then(function () { if (u) emitChanged(); }); });
    window.MMBridge = { back: function () { location.href = "../"; } };
  }

  /* ================= 3. 本地开发：没有账号 ================= */
  else {
    window.currentUser = null;
    window.CCAuth = { rpc: function () { return Promise.reject(new Error("本地开发模式没有账号")); } };
    window.MMBridge = { back: function () { history.back(); } };
  }

  /* ---------- 头部：返回、账号 ---------- */
  function paintUser() {
    var el = document.getElementById("mmUser");
    if (!el || window.MM_HOST !== "web") return;
    var me = window.currentUser;
    el.innerHTML = me
      ? '<span class="mm-user-name">' + window.esc(me.display_name || me.account || "已登录") + "</span>"
      : '<a class="mm-head-link" href="../../app.html?next=' + encodeURIComponent("learn/mindmap/") + '#login">登录捞捞账号</a>';
  }

  window.addEventListener("DOMContentLoaded", function () {
    var back = document.getElementById("mmBackHost");
    if (back) back.addEventListener("click", function (e) { e.preventDefault(); window.MMBridge.back(); });
    paintUser();
    if (typeof window.renderMindmap === "function") window.renderMindmap();
  });
})();
