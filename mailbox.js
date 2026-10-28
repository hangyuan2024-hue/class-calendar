/* 7.7 信箱：把 mailbox-ui.js 接到网站（index.html）里
 * - 「我的 → 信箱」和电脑侧栏「信箱」（带未读数）进入
 * - 网址直达：index.html#mail（打开信箱）、index.html#mail-compose=team&kind=report（直接写信给网站团队）
 *   kind: report 举报 / suggest 建议 / opensource 开源共建 / security 安全漏洞 / other 其他
 */
(function () {
  "use strict";
  if (!window.MailboxUI) return;
  var ui = null, unread = { in: 0, team: 0, review: 0 }, pending = null;
  var $ = function (id) { return document.getElementById(id); };
  var user = function () { try { return typeof currentUser !== "undefined" ? currentUser : null; } catch (e) { return null; } };
  var total = function () { return (unread.in || 0) + (unread.team || 0) + (unread.review || 0); };

  function ensureView() {
    var v = document.querySelector('.view[data-view="mail"]');
    if (v) return v;
    v = document.createElement("section");
    v.className = "view"; v.dataset.view = "mail";
    v.innerHTML = '<header class="vhead"><button class="back" data-tab="me" aria-label="返回">‹</button><h2>信箱</h2><span class="spacer"></span></header><div id="mailRoot"></div>';
    var me = document.querySelector('.view[data-view="me"]');
    (me && me.parentNode ? me.parentNode : document.body).insertBefore(v, me ? me.nextSibling : null);
    return v;
  }

  function mountUI() {
    if (ui) return ui;
    ensureView();
    var root = $("mailRoot");
    if (!user()) {
      root.innerHTML = '<div class="mbx"><p class="mbx-empty">登录后才能使用信箱<br><a class="mbx-btn pri" href="login.html?next=' + encodeURIComponent("index.html#mail") + '">登录 / 注册</a></p></div>';
      return null;
    }
    root.innerHTML = "";
    ui = window.MailboxUI.mount(root, {
      rpc: function (fn, args) { return window.CCAuth.rpc(fn, args || {}); },
      openBindEmail: function () {
        showView("settings");
        setTimeout(function () { var b = $("mailBox"); if (b) b.scrollIntoView({ behavior: "smooth", block: "center" }); }, 120);
      },
      onUnread: function (u) { unread = u || unread; badge(); }
    });
    return ui;
  }

  // 未读数：「我的」里的入口、电脑侧栏、手机底部「我的」
  function badge() {
    var n = total(), t = n > 99 ? "99+" : String(n);
    document.querySelectorAll("[data-mail-badge]").forEach(function (e) { e.textContent = t; e.hidden = !n; });
    var meNav = document.querySelector('#tabs [data-tab="me"]');
    if (meNav) {
      var d = meNav.querySelector(".mail-dot");
      if (n && !d) { d = document.createElement("em"); d.className = "badge mail-dot"; meNav.appendChild(d); }
      if (d) { if (n) d.textContent = t; else d.remove(); }
    }
  }

  async function poll() {
    if (!user() || document.hidden || !window.CCAuth) return;
    try {
      var r = await window.CCAuth.rpc("letter_unread", {});
      if (r && typeof r === "object") { unread = { in: r.in || 0, team: r.team || 0, review: r.review || 0 }; badge(); }
    } catch (e) { /* 数据库还没加 7.7 的函数：不显示 */ }
  }

  // 「我的 → 班级与账号」加一个入口
  function addEntry() {
    if ($("menuMail")) return;
    var people = document.querySelector('.view[data-view="me"] .gi[data-tab="people"]');
    if (!people) return;
    var b = document.createElement("button");
    b.className = "gi"; b.id = "menuMail"; b.dataset.tab = "mail";
    b.innerHTML = '<span class="ic">✉️</span><span class="sx"><span class="sxt">信箱 <em class="badge" data-mail-badge hidden></em></span><small>写信给捞捞团队：举报、建议、开源合作、安全问题</small></span>';
    people.parentNode.insertBefore(b, people);
  }

  // 电脑侧栏：在「设置」前面加「信箱」
  var MAIL_ICON = '<svg viewBox="0 0 24 24" class="o" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
    '<svg viewBox="0 0 24 24" class="f" aria-hidden="true"><path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v.4l-9 6.4-9-6.4V7a2.5 2.5 0 0 1 2.5-2.5z M3 9.8l9 6.4 9-6.4V17a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17z" fill="currentColor"/></svg>';
  function railBtn() {
    var tabs = $("tabs"); if (!tabs || !user()) return;
    var cur = document.querySelector(".view.on[data-view]");
    var on = cur && cur.dataset.view === "mail";
    var set = tabs.querySelector('[data-tab="settings"]');
    var b = document.createElement("button");
    b.className = "nav desk" + (on ? " on" : ""); b.dataset.tab = "mail";
    b.innerHTML = MAIL_ICON + "<span>信箱</span>" + '<em class="badge" data-mail-badge hidden></em>';
    tabs.insertBefore(b, set || null);
    if (on) { var me = tabs.querySelector('[data-tab="me"]'); if (me) me.classList.remove("on"); }
    badge();
  }

  if (typeof window.renderTabs === "function") {
    var rt = window.renderTabs;
    window.renderTabs = function () { var r = rt.apply(this, arguments); try { railBtn(); } catch (e) {} return r; };
  }
  if (typeof window.showView === "function") {
    var sv = window.showView;
    window.showView = function (id) {
      if (id === "mail") ensureView();
      var r = sv.apply(this, arguments);
      if (id === "mail") {
        var u = mountUI();
        if (u) { if (pending) { u.open(pending); pending = null; } else u.refresh(); }
      }
      return r;
    };
  }

  // 网址直达
  function fromHash() {
    var h = location.hash;
    if (h === "#mail") { history.replaceState(null, "", location.pathname); return {}; }
    var m = h.match(/^#mail-compose=([^&]*)(?:&(.*))?$/);
    if (!m) return null;
    var p = new URLSearchParams(m[2] || "");
    history.replaceState(null, "", location.pathname);
    var o = { tab: "compose", to: decodeURIComponent(m[1] || "team") };
    if (p.get("kind")) o.kind = p.get("kind");
    if (p.get("subject")) o.subject = p.get("subject").slice(0, 80);
    return o;
  }
  async function route() {
    var o = fromHash(); if (!o) return;
    for (var i = 0; i < 50 && !user(); i++) await new Promise(function (r) { setTimeout(r, 200); });   // 等登录状态（最多 10 秒）
    if (o.tab) pending = o;
    showView("mail");
  }
  window.addEventListener("hashchange", route);

  function boot() {
    ensureView(); addEntry(); badge();
    try { renderTabs(); } catch (e) {}
    route();
    setTimeout(poll, 3000);
    setInterval(poll, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MailboxWeb = { open: function (o) { pending = o || null; showView("mail"); }, poll: poll };
})();
