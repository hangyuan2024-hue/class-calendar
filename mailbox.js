/* 7.7 信箱：把 mailbox-ui.js 接到网站（index.html）里
 * - 电脑：侧栏用户头像右边的信箱按钮（有新信标红），点开是悬浮窗（float-wm.js：可拖动、调大小、和别的窗口拼接）
 * - 手机：「我的 → 信箱」进入单独一页
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

  // 信箱内容只有一份（#mailRoot），电脑上放进悬浮窗，手机上放回「信箱」页，写到一半的信不会丢
  function rootEl() {
    var r = $("mailRoot");
    if (!r) { r = document.createElement("div"); r.id = "mailRoot"; ensureView().appendChild(r); }
    return r;
  }
  function mountUI() {
    if (ui) return ui;
    ensureView();
    var root = rootEl();
    if (!user()) {
      root.innerHTML = '<div class="mbx"><p class="mbx-empty">登录后才能使用信箱<br><a class="mbx-btn pri" href="login.html?next=' + encodeURIComponent("index.html#mail") + '">登录 / 注册</a></p></div>';
      return null;
    }
    root.innerHTML = "";
    ui = window.MailboxUI.mount(root, {
      rpc: function (fn, args) { return window.CCAuth.rpc(fn, args || {}); },
      openBindEmail: function () {
        closeFloat();
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
    var rb = $("railMail"); if (rb) { rb.classList.toggle("has-new", !!n); rb.title = n ? "信箱：" + n + " 封新信" : "信箱"; }
    var meNav = document.querySelector('#tabs [data-tab="me"]');
    if (meNav && !isDesk()) {
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
    b.innerHTML = '<span class="ic">' + window.MailboxUI.icon("mail") + '</span><span class="sx"><span class="sxt">信箱 <em class="badge" data-mail-badge hidden></em></span><small>写信给捞捞团队：举报、建议、开源合作、安全问题</small></span>';
    people.parentNode.insertBefore(b, people);
  }

  // ---------- 电脑：用户头像右边的信箱按钮 + 悬浮窗（float-wm.js，可拖动、调大小、和别的窗口拼接）----------
  var mailWin = null;
  function isDesk() { return !!(window.FloatWM && window.FloatWM.enabled()); }
  function railBtn() {
    if ($("railMail")) return;
    var chip = $("userChip"); if (!chip || !chip.parentNode) return;
    var row = document.createElement("div"); row.className = "rail-me-row";
    chip.parentNode.insertBefore(row, chip); row.appendChild(chip);
    var b = document.createElement("button");
    b.type = "button"; b.id = "railMail"; b.className = "rail-mail"; b.title = "信箱"; b.setAttribute("aria-label", "信箱");
    b.innerHTML = window.MailboxUI.icon("mail") + '<em class="rm-n" data-mail-badge hidden></em>';
    b.addEventListener("click", function () { if (window.FloatWM && window.FloatWM.isOpen("mail")) closeFloat(); else openFloat(); });
    row.appendChild(b);
    badge();
  }
  function openFloat(o) {
    if (!mailWin) { mailWin = document.createElement("div"); mailWin.className = "mbx-win"; document.body.appendChild(mailWin); }
    var root = rootEl();
    if (root.parentNode !== mailWin) mailWin.appendChild(root);
    window.FloatWM.open({ id: "mail", title: "信箱", icon: window.MailboxUI.icon("mail"), el: mailWin, w: 980, h: 720, minW: 600, minH: 420,
      onClose: function () { var b = $("railMail"); if (b) b.classList.remove("on"); } });
    var b = $("railMail"); if (b) b.classList.add("on");
    var u = mountUI();
    if (u) { if (o && o.tab) u.open(o); else u.refresh(); }
  }
  function closeFloat() { if (window.FloatWM) window.FloatWM.close("mail"); }
  // 换成窄屏（手机布局）时，内容放回「信箱」页
  addEventListener("resize", function () { if (!isDesk()) { var v = ensureView(), r = $("mailRoot"); if (r && r.parentNode !== v) v.appendChild(r); } });

  if (typeof window.showView === "function") {
    var sv = window.showView;
    window.showView = function (id) {
      if (id === "mail" && isDesk()) { var p = pending; pending = null; openFloat(p); return; }   // 电脑上：悬浮窗，不切换页面
      if (id === "mail") { ensureView(); var rt = rootEl(), vw = ensureView(); if (rt.parentNode !== vw) vw.appendChild(rt); closeFloat(); }
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
    ensureView(); addEntry(); railBtn(); badge();
    route();
    setTimeout(poll, 3000);
    setInterval(poll, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MailboxWeb = { open: function (o) { pending = o || null; showView("mail"); }, close: closeFloat, poll: poll };
})();
