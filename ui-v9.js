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

  // ---------------- 右栏 ----------------
  var rail = document.querySelector(".siderail"), shell = document.querySelector(".shell");
  var RK = "ui_rail_off_v1";
  var tab = document.createElement("button");
  tab.type = "button"; tab.className = "v9-rail-tab"; tab.title = "展开校园速览：日历、今天的课、这周的作业";
  tab.innerHTML = '<span class="d">📅</span>校园速览';
  document.body.appendChild(tab);
  function railShownByCss() {
    // 不加任何收起时，这个宽度下右栏本来显示不显示
    if (!rail) return false;
    var off = root.classList.contains("v9-rail-off"), dr = root.classList.contains("v9-rail-drawer");
    root.classList.remove("v9-rail-off", "v9-rail-drawer");
    var shown = getComputedStyle(rail).display !== "none";
    if (off) root.classList.add("v9-rail-off"); if (dr) root.classList.add("v9-rail-drawer");
    return shown;
  }
  function layout() {
    if (!rail || !shell) return;
    var desk = window.innerWidth > 1000;
    shell.style.removeProperty("grid-template-columns");
    var natural = railShownByCss();
    var off = desk && natural && rd(RK, false);
    if (off) {
      // 把右栏那一列去掉，中间那列吃掉多出来的宽度
      root.classList.remove("v9-rail-off");
      var cols = getComputedStyle(shell).gridTemplateColumns.split(" ").filter(Boolean);
      root.classList.add("v9-rail-off");
      var sb = cols.length >= 3 ? cols[0] + " " : "";
      shell.style.setProperty("grid-template-columns", sb + "minmax(0, 1fr)", "important");
    } else root.classList.remove("v9-rail-off");
    root.classList.toggle("v9-rail-hidden", desk && (!natural || off));
    if (!desk) root.classList.remove("v9-rail-drawer");
  }
  if (rail) {
    var head = rail.querySelector(".studio-side-heading");
    if (head && !head.querySelector(".v9-rail-x")) {
      var x = document.createElement("button");
      x.type = "button"; x.className = "v9-rail-x"; x.title = "收起校园速览"; x.setAttribute("aria-label", "收起校园速览"); x.textContent = "›";
      head.appendChild(x);
      x.onclick = function () {
        if (root.classList.contains("v9-rail-drawer")) { root.classList.remove("v9-rail-drawer"); return; }
        wr(RK, true); layout();
      };
    }
    tab.onclick = function () {
      if (railShownByCss()) { wr(RK, false); layout(); }
      else root.classList.add("v9-rail-drawer");
    };
    document.addEventListener("click", function (e) {
      if (root.classList.contains("v9-rail-drawer") && !e.target.closest(".siderail") && !e.target.closest(".v9-rail-tab")) root.classList.remove("v9-rail-drawer");
      else if (root.classList.contains("v9-rail-drawer") && e.target.closest(".siderail [data-tab]")) root.classList.remove("v9-rail-drawer");
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") root.classList.remove("v9-rail-drawer"); });
    var t = 0; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(layout, 80); });
    // 换风格、收起左侧导航时重新算（只看这两样，自己改的 class 不算，免得来回触发）
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

  // ---------------- 成长页 ----------------
  var g = document.querySelector('[data-view="growth"]');
  if (g) {
    var hs = g.querySelectorAll(":scope > .sec-h");
    if (hs[0]) hs[0].classList.add("v9-g1");
    if (hs[1]) hs[1].classList.add("v9-g2");
  }
})();
