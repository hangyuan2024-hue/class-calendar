/* 6.10 介绍页的账号管理（app.html、learn/、code/ 共用）
 *   · 没登录：顶栏显示「登录」
 *   · 登录了：顶栏显示头像 + 名字（手机上只显示头像），点开是「账号管理」面板：
 *       进入工作台 / 账号与安全（工作台「我的」页：登录设备、改密码、找回方式）/ 切换账号 / 退出登录
 *     切换账号、退出登录都要再点一次确认，不会一点就退出
 *   · 介绍页底部「欢迎回来」卡片上的「管理账号」也打开这个面板（window.SiteAcct.open()）
 *   依赖 auth.js（CCAuth）；页面 <body data-root="../"> 说明网站根目录在哪（介绍页本身不用写） */
(function () {
  "use strict";
  if (!window.CCAuth) return;
  var root = (document.body && document.body.getAttribute("data-root")) || "";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var first = function (s) { return Array.from(String(s || "?").trim() || "?")[0]; };
  var me = null, dlg = null, confirmFor = "";

  // ---------- 顶栏 ----------
  function paintHead() {
    var login = document.querySelectorAll("[data-acct-login]"), btns = document.querySelectorAll("[data-acct-btn]");
    login.forEach(function (a) { a.hidden = !!me; });
    document.querySelectorAll("[data-acct-open]").forEach(function (a) { a.hidden = !me; });
    btns.forEach(function (b) {
      b.hidden = !me;
      if (!me) return;
      b.innerHTML = '<span class="v8-av" aria-hidden="true">' + esc(first(me.display_name || me.account)) + '</span><span class="v8-an">' + esc(me.display_name || me.account || "我的账号") + "</span>";
      b.setAttribute("aria-label", "账号管理：" + (me.display_name || me.account || ""));
      b.setAttribute("data-noi18n", "");
    });
    // 「进入工作台」「免登录先试试」：登录了就直接进自己的账号
    if (me) document.querySelectorAll('a[href="' + root + 'index.html?guest=1"]').forEach(function (a) { a.href = root + "index.html"; });
  }

  // ---------- 账号管理面板 ----------
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "v8-acct-dlg";
    dlg.setAttribute("aria-labelledby", "v8AcctTitle");
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) { close(); return; }
      var b = e.target.closest("[data-acct]"); if (!b) return;
      var a = b.getAttribute("data-acct");
      if (a === "close") close();
      else if (a === "switch" || a === "out") { confirmFor = confirmFor === a ? "" : a; paint(); }
      else if (a === "no") { confirmFor = ""; paint(); }
      else if (a === "yes") signOut(confirmFor === "switch");
    });
    dlg.addEventListener("close", function () { confirmFor = ""; });
    return dlg;
  }
  function paint() {
    if (!dlg || !me) return;
    var role = (CCAuth.ROLE_NAMES && CCAuth.ROLE_NAMES[me.role]) || "";
    var ask = confirmFor === "switch" ? "换成别的账号登录？" : "退出这个账号？";
    dlg.innerHTML =
      '<div class="v8-acct-card">' +
      '<button class="v8-acct-x" type="button" data-acct="close" aria-label="关闭">✕</button>' +
      '<div class="v8-acct-me"><span class="v8-av big" aria-hidden="true">' + esc(first(me.display_name || me.account)) + '</span>' +
      '<div><h2 id="v8AcctTitle" data-noi18n>' + esc(me.display_name || me.account || "") + '</h2><p>' + esc([role, me.account ? "@" + me.account : ""].filter(Boolean).join(" · ")) + "</p></div></div>" +
      '<p class="v8-acct-tip">捞捞调度账号：课程表、学习、编程三个板块通用</p>' +
      '<div class="v8-acct-list">' +
      '<a href="' + root + 'index.html"><span class="ic">⌂</span><span><b>进入工作台</b><small>课表、作业、班级消息</small></span><em>↗</em></a>' +
      '<a href="' + root + 'index.html#me"><span class="ic">🛡</span><span><b>账号与安全</b><small>登录设备、修改密码、找回方式</small></span><em>›</em></a>' +
      '<button type="button" data-acct="switch"' + (confirmFor === "switch" ? ' class="on"' : "") + '><span class="ic">⇄</span><span><b>切换账号</b><small>退出后换一个账号登录</small></span><em>›</em></button>' +
      '<button type="button" data-acct="out" class="out' + (confirmFor === "out" ? " on" : "") + '"><span class="ic">⎋</span><span><b>退出登录</b><small>这台设备上不再保持登录</small></span><em>›</em></button>' +
      "</div>" +
      (confirmFor ? '<div class="v8-acct-ask" role="alert"><b>' + ask + '</b><span>这台设备上的本机数据会保留，下次登录还在。</span>' +
        '<div><button type="button" data-acct="no">取消</button><button type="button" data-acct="yes" class="danger">' + (confirmFor === "switch" ? "退出并换账号" : "确定退出") + "</button></div></div>" : "") +
      "</div>";
    var y = dlg.querySelector('[data-acct="yes"]'); if (y) y.focus();
  }
  function open() {
    if (!me) { location.href = root + "app.html#login"; return; }
    ensure(); confirmFor = ""; paint();
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
  }
  function close() { if (dlg && dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute("open"); } } }
  function signOut(toLogin) {
    var y = dlg.querySelector('[data-acct="yes"]'); if (y) { y.disabled = true; y.textContent = "正在退出…"; }
    Promise.resolve(CCAuth.signOut()).catch(function () {}).then(function () {
      me = null; close(); paintHead();
      // 介绍页：刷新后停在登录框；学习 / 编程页：换账号就去介绍页的登录框，退出就留在这页
      if (document.getElementById("login")) { try { history.replaceState(null, "", location.pathname + location.search + "#login"); } catch (e) {} location.reload(); }
      else if (toLogin) location.href = root + "app.html#login";
      else location.reload();
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-acct-btn], [data-acct-open]")) { e.preventDefault(); open(); }
  });
  window.SiteAcct = { open: open, me: function () { return me; } };

  paintHead();
  Promise.resolve(CCAuth.session()).then(function (s) { return s ? CCAuth.me() : null; }).then(function (m) { me = m && (m.id || m.account) ? m : null; paintHead(); }, function () {});
})();
