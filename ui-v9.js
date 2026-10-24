/* ui-v9.js —— 6.17 界面整理（配合 ui-v9.css，放在所有脚本最后）
 *   · 右边「校园速览」收起 / 展开（记在这台设备上）
 *   · 首页：问候 + 接下来的安排放最上面；教练卡和「我管理的班级」并成一行
 *   · 工具页：捞捞学习两个大入口 + 搜索工具
 *   · 设置页：左边分类导航，点了跳到对应位置
 *   · 成长页：给两个小标题打上记号，电脑上排成两栏 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var rd = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  var wr = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ---------------- 右栏「校园速览」：电脑上默认收起，点右边的小标签以悬浮面板展开 ----------------
  var rail = document.querySelector(".siderail"), shell = document.querySelector(".shell");
  var tab = document.createElement("button");
  tab.type = "button"; tab.className = "v9-rail-tab"; tab.title = "校园速览：日历、今天的课、这周的作业";
  tab.innerHTML = '<span class="d">' + (window.ccIcon ? ccIcon("calendar") : "") + "</span>校园速览";
  document.body.appendChild(tab);
  function layout() {
    if (!rail || !shell) return;
    var desk = window.innerWidth > 1000;
    shell.style.removeProperty("grid-template-columns");
    root.classList.remove("v9-rail-off");
    if (desk && getComputedStyle(rail).display !== "none") {
      // 去掉右栏那一列，中间吃掉多出来的宽度
      var cols = getComputedStyle(shell).gridTemplateColumns.split(" ").filter(Boolean);
      shell.style.setProperty("grid-template-columns", (cols.length >= 3 ? cols[0] + " " : "") + "minmax(0, 1fr)", "important");
    }
    root.classList.toggle("v9-rail-off", desk);
    root.classList.toggle("v9-rail-hidden", desk);
    if (!desk) root.classList.remove("v9-rail-drawer");
  }
  if (rail) {
    var head = rail.querySelector(".studio-side-heading");
    if (head && !head.querySelector(".v9-rail-x")) {
      var x = document.createElement("button");
      x.type = "button"; x.className = "v9-rail-x"; x.title = "收起"; x.setAttribute("aria-label", "收起校园速览"); x.innerHTML = window.ccIcon ? ccIcon("x") : "×";
      head.appendChild(x);
      x.onclick = function () { root.classList.remove("v9-rail-drawer"); };
    }
    tab.onclick = function (e) { e.stopPropagation(); root.classList.toggle("v9-rail-drawer"); };
    document.addEventListener("click", function (e) {
      if (!root.classList.contains("v9-rail-drawer")) return;
      if (!e.target.closest(".siderail") || e.target.closest(".siderail [data-tab]")) root.classList.remove("v9-rail-drawer");
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") root.classList.remove("v9-rail-drawer"); });
    var t = 0; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(layout, 80); });
    var sig = function () { return (root.getAttribute("data-skin") || "") + "|" + root.classList.contains("sidebar-collapsed"); }, last = sig();
    new MutationObserver(function () { var s = sig(); if (s !== last) { last = s; clearTimeout(t); t = setTimeout(layout, 30); } }).observe(root, { attributes: true, attributeFilter: ["data-skin", "class"] });
    layout();
  }

  // ---------------- 首页 ----------------
  var row = null;
  function homeRow() {
    var grid = document.querySelector('[data-view="home"] .studio-focus-grid');
    var coach = $("coachCard"); if (!grid || !coach) return;
    if (!row) {
      row = document.createElement("div"); row.className = "v9-home-row";
      grid.parentNode.insertBefore(row, grid.nextSibling);
      row.appendChild(coach);
    }
    var th = $("teachHome");
    if (th && th.parentNode !== row) row.appendChild(th);
    var coachOn = !!coach.firstElementChild;
    coach.classList.toggle("v9-gone", !coachOn);
    var n = (coachOn ? 1 : 0) + (th ? 1 : 0);
    row.classList.toggle("v9-one", n === 1);
    row.classList.toggle("v9-none", n === 0);
  }
  var home = document.querySelector('[data-view="home"]');
  if (home) {
    var ht = 0;
    new MutationObserver(function () { clearTimeout(ht); ht = setTimeout(homeRow, 20); }).observe(home, { childList: true, subtree: false });
    var cc = $("coachCard"); if (cc) new MutationObserver(function () { clearTimeout(ht); ht = setTimeout(homeRow, 20); }).observe(cc, { childList: true });
    homeRow();
  }

  // ---------------- 工具页 ----------------
  var tools = document.querySelector('[data-view="tools"]');
  if (tools && !tools.querySelector(".v9-feature")) {
    var entries = tools.querySelectorAll(":scope > .kn-entry");
    if (entries.length) {
      var feat = document.createElement("div"); feat.className = "v9-feature";
      var h = document.createElement("div"); h.className = "sec-h"; h.innerHTML = "<b>捞捞学习</b><span>思维导图、课内学习，登录后自动备份到账号</span>";
      entries[0].parentNode.insertBefore(h, entries[0]);
      h.parentNode.insertBefore(feat, h.nextSibling);
      entries.forEach(function (e) { feat.appendChild(e); });
    }
    var grid = $("toolGrid");
    if (grid) {
      var top = document.createElement("div"); top.className = "v9-tools-top";
      var mac = /Mac|iPhone|iPad/.test(navigator.platform);
      top.innerHTML = '<input type="search" id="v9ToolQ" placeholder="搜索我的工具" aria-label="搜索我的工具"><kbd>' + (mac ? "⌘K" : "Ctrl K") + "</kbd>";
      var head2 = tools.querySelector(":scope > .vhead");
      (head2 || tools.firstChild).parentNode.insertBefore(top, (head2 ? head2.nextSibling : tools.firstChild));
      var q = $("v9ToolQ");
      var filter = function () {
        var k = q.value.trim().toLowerCase(), shown = 0;
        grid.querySelectorAll(":scope > .tool").forEach(function (t) {
          if (t.dataset.tab === "store") { t.classList.toggle("v9-hide", !!k); return; }
          var hit = !k || t.textContent.toLowerCase().indexOf(k) >= 0; t.classList.toggle("v9-hide", !hit); if (hit) shown++;
        });
        var em = grid.querySelector(".v9-empty");
        if (k && !shown) { if (!em) { em = document.createElement("div"); em.className = "v9-empty"; grid.appendChild(em); } em.textContent = "没找到「" + q.value.trim() + "」。下面「添加工具」里可能有。"; }
        else if (em) em.remove();
      };
      q.addEventListener("input", filter);
      q.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { var first = grid.querySelector(":scope > .tool:not(.v9-hide) [data-tab], :scope > .tool:not(.v9-hide)[data-tab]"); if (first) first.click(); }
        if (e.key === "Escape") { q.value = ""; filter(); }
      });
      new MutationObserver(function () { if (q.value) filter(); }).observe(grid, { childList: true });
    }
  }

  // ---------------- 设置页：左边分类 ----------------
  var set = document.querySelector('[data-view="settings"]');
  var nav = $("setNav");
  function buildNav() {
    if (!set || !nav) return;
    var heads = Array.prototype.filter.call(set.querySelectorAll(".v9-set-body > .sec-h"), function (h) { return getComputedStyle(h).display !== "none"; });
    nav.innerHTML = heads.map(function (h, i) { h.id = h.id || "setSec" + i; var b = h.querySelector("b"); return '<a href="#' + h.id + '" data-sec="' + h.id + '">' + (b ? b.textContent : "") + "</a>"; }).join("");
  }
  if (set && nav) {
    nav.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-sec]"); if (!a) return; e.preventDefault();
      var el = $(a.dataset.sec); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.querySelectorAll("a").forEach(function (x) { x.classList.toggle("on", x === a); });
    });
    window.addEventListener("scroll", function () {
      if (!set.classList.contains("on")) return;
      var cur = null;
      nav.querySelectorAll("a[data-sec]").forEach(function (a) { var el = $(a.dataset.sec); if (el && el.getBoundingClientRect().top < 140) cur = a; });
      nav.querySelectorAll("a").forEach(function (x) { x.classList.toggle("on", x === (cur || nav.firstElementChild)); });
    }, { passive: true });
    new MutationObserver(function () { if (set.classList.contains("on")) buildNav(); }).observe(set, { attributes: true, attributeFilter: ["class"] });
    buildNav();
  }

  // ---------------- 设置：电脑上以悬浮窗打开，不离开当前页面 ----------------
  if (set && typeof window.showView === "function") {
    var orig = window.showView, back = set.querySelector(".vhead .back"), xbtn = document.createElement("button");
    xbtn.type = "button"; xbtn.className = "v9-set-x"; xbtn.title = "关闭（Esc）"; xbtn.setAttribute("aria-label", "关闭设置");
    xbtn.innerHTML = window.ccIcon ? ccIcon("x") : "×";
    var vh = set.querySelector(".vhead"); if (vh) vh.appendChild(xbtn);
    var veil = document.createElement("div"); veil.className = "v9-set-veil"; document.body.appendChild(veil);
    var floatOn = function () { return window.innerWidth > 700; };
    var home = { parent: set.parentNode, next: set.nextSibling };
    var openSet = function () {
      // 挪到 body 下面：不受中间那一栏的层级和模糊影响
      if (set.parentNode !== document.body) { home = { parent: set.parentNode, next: set.nextSibling }; document.body.appendChild(set); }
      root.classList.add("v9-set-open"); set.classList.add("v9-float");
      buildNav(); set.scrollTop = 0;
      try { loadSecurity(); } catch (e) {}
      try { if (typeof renderSyncUI === "function") renderSyncUI(); } catch (e) {}
    };
    var closeSet = function () {
      root.classList.remove("v9-set-open"); set.classList.remove("v9-float");
      if (set.parentNode === document.body && home.parent) home.parent.insertBefore(set, home.next && home.next.parentNode === home.parent ? home.next : null);
    };
    window.ccCloseSettings = closeSet;
    window.showView = function (id) {
      if (id === "settings" && floatOn()) { root.classList.remove("v9-rail-drawer"); openSet(); return; }
      if (root.classList.contains("v9-set-open")) closeSet();
      return orig.apply(this, arguments);
    };
    try { showView = window.showView; } catch (e) {}
    xbtn.onclick = closeSet; veil.onclick = closeSet;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("v9-set-open")) closeSet(); });
    window.addEventListener("resize", function () { if (!floatOn() && root.classList.contains("v9-set-open")) { closeSet(); orig("settings"); } });
    set.addEventListener("scroll", function () {
      if (!set.classList.contains("v9-float")) return;
      var top = set.getBoundingClientRect().top, cur = null;
      nav.querySelectorAll("a[data-sec]").forEach(function (a) { var el = $(a.dataset.sec); if (el && el.getBoundingClientRect().top - top < 120) cur = a; });
      nav.querySelectorAll("a").forEach(function (x) { x.classList.toggle("on", x === (cur || nav.firstElementChild)); });
    }, { passive: true });
    // 地址带 #settings 打开的：页面先停在首页，设置浮在上面
    if (set.classList.contains("on") && floatOn()) { orig("home"); openSet(); }
  }

  // ---------------- 成长页 ----------------
  var g = document.querySelector('[data-view="growth"]');
  if (g) {
    var hs = g.querySelectorAll(":scope > .sec-h");
    if (hs[0]) hs[0].classList.add("v9-g1");
    if (hs[1]) hs[1].classList.add("v9-g2");
  }
})();

/* ---------------- 6.17 左下角账号菜单（个人中心、设置、外观、帮助、退出），像常见的桌面应用一样 ----------------
 * 电脑上左侧导航不再放「我的」「设置」，点左下角自己的头像打开这个菜单；手机底部栏照旧有「我的」 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var chip = $("userChip"); if (!chip) return;
  var I = function (n) { return window.ccIcon ? ccIcon(n) : ""; };
  var LOOKS = [["fresh", "清爽"], ["clean", "简约"], ["paper", "书页"], ["cyber", "捞捞元宇宙"]];
  var MODES = [["light", "浅色", "sun"], ["dark", "深色", "moon"], ["system", "跟随系统", "monitor"]];
  var menu = document.createElement("div"); menu.id = "acctMenu"; menu.className = "v9-acct"; menu.hidden = true; menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  function me() { return typeof currentUser !== "undefined" && currentUser ? currentUser : null; }
  function render() {
    var u = me(), st = window.ccLookState ? ccLookState() : { look: "fresh", mode: "light" };
    var name = u ? (u.display_name || u.account || "我") : "";
    var role = u && window.CCAuth && CCAuth.ROLE_NAMES ? (CCAuth.ROLE_NAMES[u.role] || "") : "";
    var lookName = (LOOKS.find(function (x) { return x[0] === st.look; }) || LOOKS[0])[1];
    var modeName = (MODES.find(function (x) { return x[0] === st.mode; }) || MODES[0])[1];
    menu.innerHTML =
      '<div class="v9-acct-h"><span class="av">' + (name ? esc1([...name][0]) : "?") + '</span><span class="t"><b>' + esc1(name) + "</b><small>" + esc1(role + (u && u.account ? " · @" + u.account : "")) + "</small></span></div>" +
      '<button role="menuitem" data-go="me">' + I("user") + "<span>个人中心</span><small>资料、成长、常用入口</small></button>" +
      '<button role="menuitem" data-go="settings">' + I("settings") + "<span>设置</span><small>同步、通知、安全</small></button>" +
      '<button role="menuitem" class="sub" data-sub="look">' + I("palette") + "<span>外观</span><small>" + lookName + " · " + modeName + "</small>" + I("chevron", "chev") + "</button>" +
      '<div class="v9-acct-sub" hidden>' +
        '<div class="v9-acct-looks">' + LOOKS.map(function (x) { return '<button data-look="' + x[0] + '" class="' + (x[0] === st.look ? "on" : "") + '"><i class="pv ' + x[0] + '"></i>' + x[1] + "</button>"; }).join("") + "</div>" +
        '<div class="v9-acct-modes">' + MODES.map(function (x) { return '<button data-mode="' + x[0] + '" class="' + (x[0] === st.mode ? "on" : "") + '">' + I(x[2]) + x[1] + "</button>"; }).join("") + "</div>" +
        '<small class="v9-acct-note">深浅色每个外观各记各的</small></div>' +
      '<div class="sep"></div>' +
      '<button role="menuitem" data-go="intro">' + I("help") + "<span>帮助与功能介绍</span></button>" +
      '<a role="menuitem" href="app.html">' + I("home") + "<span>捞捞官网</span><small>下载 App、捞捞学习</small></a>" +
      '<div class="sep"></div>' +
      '<button role="menuitem" class="danger" data-act="logout">' + I("logout") + "<span>退出登录</span></button>";
  }
  function esc1(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function place() {
    var r = chip.getBoundingClientRect(), w = Math.max(260, Math.min(300, window.innerWidth - 24));
    menu.style.width = w + "px";
    menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + "px";
    menu.style.bottom = Math.max(12, window.innerHeight - r.top + 8) + "px";
  }
  function open() { render(); menu.hidden = false; place(); chip.setAttribute("aria-expanded", "true"); }
  function close() { menu.hidden = true; chip.setAttribute("aria-expanded", "false"); }
  chip.setAttribute("aria-haspopup", "menu");
  chip.addEventListener("click", function (e) {
    if (!me()) return;                       // 没登录：照旧去登录
    e.preventDefault(); e.stopImmediatePropagation();
    if (menu.hidden) open(); else close();
  }, true);
  menu.addEventListener("click", function (e) {
    e.stopPropagation();                     // 菜单内容会重画，别让下面「点外面关菜单」误判
    var b = e.target.closest("button, a"); if (!b) return;
    if (b.dataset.sub) { var sub = menu.querySelector(".v9-acct-sub"); sub.hidden = !sub.hidden; b.classList.toggle("open", !sub.hidden); place(); return; }
    if (b.dataset.look) {
      if (b.dataset.look === "cyber" && typeof enterMeta === "function") { close(); enterMeta(); return; }
      if (typeof setSkin === "function") setSkin(b.dataset.look);
      render(); menu.querySelector(".v9-acct-sub").hidden = false; return;
    }
    if (b.dataset.mode) { if (typeof setLookMode === "function") setLookMode(b.dataset.mode); render(); menu.querySelector(".v9-acct-sub").hidden = false; return; }
    if (b.dataset.go) { close(); if (typeof showView === "function") showView(b.dataset.go); return; }
    if (b.dataset.act === "logout") { close(); var lb = $("logoutBtn"); if (lb) lb.click(); return; }
    close();
  });
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { close(); chip.focus(); } });
  window.addEventListener("resize", function () { if (!menu.hidden) place(); });
})();
