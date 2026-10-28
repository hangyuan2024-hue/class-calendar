/* 7.7 信箱界面（网页、电脑版共用同一份；电脑版由 desktop/scripts/sync-web.js 拷过去）
 *   MailboxUI.mount(el, { rpc, openBindEmail, onUnread }) → 返回 { open(opt), refresh(), unread() }
 *     rpc(fn, args)        调服务器函数（网页：CCAuth.rpc；电脑版：api）
 *     openBindEmail()      打开「绑定邮箱」的地方（没有就不显示按钮）
 *     onUnread({in,team,review})  未读数变化时通知外面（侧栏小红点）
 *   open({ tab: "compose", to: "team" | 账号, kind: "report" | "suggest" | "opensource" | "security" | "other", subject, body })
 *   服务器函数见扣子 7.7-mailbox.sql（letter_*） */
(function () {
  "use strict";
  var KIND = { report: "举报", suggest: "建议", opensource: "开源合作", security: "安全问题", other: "其他", user: "私信" };
  var TEAM_KINDS = ["report", "suggest", "opensource", "security", "other"];
  var KIND_TIP = {
    report: "举报违法违规内容、骚扰、侵权等。请写清楚是哪里（班级、账号、页面）、什么时间、什么内容，能截图的话把关键文字抄下来。",
    suggest: "功能建议、体验问题、发现的错误都可以。",
    opensource: "想参与开发、设计、文档，或者想在自己学校使用、二次开发。请说说你会什么、想做什么、怎么联系你。",
    security: "发现安全漏洞请写在这里，不要公开发布。我们会尽快修复并在感谢名单里致谢（如果你愿意）。",
    other: "其他想对捞捞团队说的话。",
  };
  // 线条图标（24×24，跟着文字颜色）
  var P = {
    inbox: '<path d="M3 13.5 5.6 5.8A2 2 0 0 1 7.5 4.5h9a2 2 0 0 1 1.9 1.3L21 13.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
    send: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/>',
    team: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/>',
    review: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.3-4.6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    report: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    suggest: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2h5c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
    opensource: '<path d="m8 8-5 4 5 4"/><path d="m16 8 5 4-5 4"/><path d="m13.5 5-3 14"/>',
    security: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/><path d="M12 15v2"/>',
    other: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1 1 21 12z"/>',
    user: '<path d="M3.5 6.5h17v11h-17z"/><path d="m4 7 8 6 8-6"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><path d="M16 4.9a3.2 3.2 0 0 1 0 6.2"/><path d="M18 14.9c1.6.7 2.7 2.5 3 5.1"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
    tools: '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    tips: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.6v.1"/>',
  };
  P.in = P.inbox; P.out = P.send;
  function ic(k, cls) { return '<svg class="mbx-svg' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[k] || P.mail) + "</svg>"; }
  var KIND_ICON = { report: ic("report"), suggest: ic("suggest"), opensource: ic("opensource"), security: ic("security"), other: ic("other"), user: ic("user") };
  var KIND_DESC = { report: "违规、骚扰、侵权", suggest: "功能想法、体验问题", opensource: "参与开发、学校合作", security: "漏洞私下报告", other: "其他想说的话" };
  var BOX = {
    in: ["in", "收件箱", "别人写给你的信，和捞捞团队的回复"], out: ["out", "已发送", "你写出去的信，审核中的也在这里"],
    team: ["team", "团队信箱", "用户写给捞捞团队的信，处理完点「标记已处理」"], review: ["review", "待审核", "先审后发的用户私信、命中敏感词的信和被举报的信"],
    settings: ["settings", "设置", "谁能给我写信、新信提醒、黑名单"], compose: ["compose", "写信", ""],
  };
  var EMPTY_SVG = '<svg viewBox="0 0 120 90" aria-hidden="true"><rect x="14" y="22" width="92" height="58" rx="10" fill="currentColor" opacity=".08"/><rect x="14" y="22" width="92" height="58" rx="10" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".35"/><path d="M18 28l42 30 42-30" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" opacity=".45"/><circle cx="96" cy="20" r="11" fill="var(--mbx-brand)"/><path d="M91 20h10M96 15v10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function when(t) {
    var d = new Date(t); if (isNaN(d)) return "";
    var s = (Date.now() - d) / 1000;
    if (s < 60) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    var y = new Date().getFullYear() === d.getFullYear();
    return (y ? "" : d.getFullYear() + "/") + (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function who(p) { if (!p) return ""; if (p.team) return "捞捞团队"; return (p.name || "") + (p.account ? "（" + p.account + "）" : ""); }
  function errMsg(e) { return (e && (e.message || e.msg)) || "出错了，请稍后再试"; }

  function mount(el, opts) {
    opts = opts || {};
    var rpc = opts.rpc;
    var S = { tab: "in", lists: {}, cur: null, settings: null, words: null, unread: { in: 0 }, compose: null, busy: false, admin: false };
    el.classList.add("mbx");
    el.innerHTML = '<div class="mbx-shell"><aside class="mbx-side">' +
      '<button type="button" class="mbx-compose" data-a="compose">' + ic("compose") + '写信</button>' +
      '<nav class="mbx-tabs" role="tablist" aria-label="信箱文件夹"></nav>' +
      '<div class="mbx-safe"><b>' + ic("lock") + '安全与合规</b><span>全程 HTTPS 加密传输</span><span>服务器上加密保存</span><span>用户之间的信先审后发</span><span>可举报、可拉黑</span></div>' +
      '</aside><section class="mbx-panel"><header class="mbx-ph"><span class="mbx-ph-ic" aria-hidden="true"></span><div class="mbx-ph-t"><h2></h2><p></p></div><div class="mbx-ph-a"></div></header>' +
      '<div class="mbx-main" aria-live="polite"></div></section></div><div class="mbx-toast" role="status"></div>';
    var tabsEl = el.querySelector(".mbx-tabs"), main = el.querySelector(".mbx-main"), toastEl = el.querySelector(".mbx-toast"), toastT = 0;
    var phIc = el.querySelector(".mbx-ph-ic"), phT = el.querySelector(".mbx-ph-t h2"), phS = el.querySelector(".mbx-ph-t p"), phA = el.querySelector(".mbx-ph-a");
    function head(key, title, sub, actions) {
      var b = BOX[key] || ["mail", "", ""];
      phIc.innerHTML = ic(b[0]); phT.textContent = title || b[1]; phS.textContent = sub == null ? b[2] : sub; phS.hidden = !phS.textContent;
      phA.innerHTML = actions || "";
    }
    // 页面里的确认框（电脑版不支持 window.prompt，所以都用这个）
    function ask(title, input) {
      return new Promise(function (done) {
        var d = document.createElement("div"); d.className = "mbx-ask";
        d.innerHTML = '<div class="mbx-ask-c" role="dialog" aria-modal="true"><p>' + esc(title) + "</p>" + (input ? '<input maxlength="200" placeholder="' + esc(input) + '">' : "") +
          '<div class="mbx-acts"><button type="button" class="mbx-btn pri" data-ok>确定</button><button type="button" class="mbx-btn" data-no>取消</button></div></div>';
        el.appendChild(d);
        var inp = d.querySelector("input"); setTimeout(function () { (inp || d.querySelector("[data-ok]")).focus(); }, 20);
        var end = function (v) { d.remove(); done(v); };
        d.addEventListener("click", function (e) { if (e.target.closest("[data-ok]")) end(inp ? inp.value : true); else if (e.target.closest("[data-no]") || e.target === d) end(null); });
        d.addEventListener("keydown", function (e) { if (e.key === "Escape") end(null); if (e.key === "Enter" && inp) end(inp.value); });
      });
    }
    function toast(t, bad) { toastEl.textContent = t; toastEl.className = "mbx-toast on" + (bad ? " bad" : ""); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = "mbx-toast"; }, 3600); }
    function tabsHtml() {
      var u = S.unread || {}, t = [["in", "收件箱", u.in], ["out", "已发送"], ["settings", "设置"]];
      if (S.admin) t.splice(2, 0, ["team", "团队信箱", u.team], ["review", "待审核", u.review]);
      tabsEl.innerHTML = t.map(function (x) {
        return '<button type="button" role="tab" data-mtab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '" class="' + (S.tab === x[0] ? "on" : "") + '">' +
          '<span class="ic" aria-hidden="true">' + ic(BOX[x[0]][0]) + "</span><span class=\"lb\">" + x[1] + "</span>" +
          (x[2] ? '<em>' + (x[2] > 99 ? "99+" : x[2]) + "</em>" : "") + "</button>";
      }).join("");
      var cb = el.querySelector(".mbx-compose"); if (cb) cb.classList.toggle("on", S.tab === "compose");
    }
    async function loadUnread() {
      try { S.unread = (await rpc("letter_unread", {})) || { in: 0 }; S.admin = S.unread.team != null; } catch (e) {}
      tabsHtml(); if (opts.onUnread) opts.onUnread(S.unread);
      return S.unread;
    }
    async function loadList(box, more) {
      var arr = more ? S.lists[box] || [] : [];
      var before = more && arr.length ? arr[arr.length - 1].id : null;
      var got = await rpc("letter_list", { p_box: box, p_before: before, p_limit: 30 });
      S.lists[box] = arr.concat(got || []); S.more = (got || []).length === 30;
    }
    function badge(l) {
      var b = "";
      if (l.to_team || l.kind !== "user") b += '<span class="mbx-k k-' + esc(l.kind) + '">' + esc(KIND[l.kind] || "") + "</span>";
      if (l.status === "held") b += '<span class="mbx-k k-held">审核中</span>';
      if (l.status === "removed") b += '<span class="mbx-k k-removed">已删除（违规）</span>';
      if (l.reported) b += '<span class="mbx-k k-report">被举报</span>';
      if (l.team_done) b += '<span class="mbx-k k-done">已处理</span>';
      if (l.flag && S.admin) b += '<span class="mbx-k k-flag">' + esc(l.flag) + "</span>";
      return b;
    }
    function drawList() {
      var box = S.tab, arr = S.lists[box];
      head(box, null, null, '<button type="button" class="mbx-icon" data-a="reload" title="刷新" aria-label="刷新">' + ic("reload") + '</button>');
      if (!arr) { main.innerHTML = skeleton(); return; }
      if (!arr.length) {
        main.innerHTML = '<div class="mbx-empty">' + EMPTY_SVG + "<b>" + ({ in: "还没有收到信", out: "还没有写过信", team: "团队信箱是空的", review: "没有要处理的信" }[box] || "") + "</b>" +
          (box === "in" || box === "out" ? '<span>有建议、想举报、想参与开源，都可以直接写信给捞捞团队</span><button type="button" class="mbx-btn pri" data-a="compose-team">' + ic("compose") + '写信给捞捞团队</button>' : "") + "</div>";
        return;
      }
      main.innerHTML = '<ul class="mbx-list">' + arr.map(function (l) {
        var other = box === "out" ? "给 " + who(l.to) : who(l.from);
        var peer = box === "out" ? l.to : l.from, team = peer && peer.team, kind = l.to_team || l.kind !== "user" ? l.kind : "user";
        var av = team ? "捞" : kind !== "user" ? KIND_ICON[kind] : ((peer && peer.name) || "?").slice(0, 1);
        return '<li><button type="button" class="mbx-item' + (box === "in" && !l.read ? " unread" : "") + '" data-open="' + l.id + '">' +
          '<span class="mbx-av k-' + esc(team ? "team" : kind) + '" aria-hidden="true">' + (!team && kind !== "user" ? av : esc(av)) + "</span>" +
          '<span class="mbx-it"><span class="mbx-l1"><b>' + esc(other) + "</b>" + badge(l) + '<time>' + esc(when(l.at)) + "</time></span>" +
          '<span class="mbx-sub">' + esc(l.subject) + "</span><span class=\"mbx-snip\">" + esc(l.snippet || "") + "</span></span></button></li>";
      }).join("") + "</ul>" + (S.more ? '<button type="button" class="mbx-btn mbx-more" data-a="more">加载更多</button>' : "");
    }
    function skeleton() { return '<div class="mbx-skel" aria-label="加载中">' + [1, 2, 3, 4].map(function () { return "<i></i>"; }).join("") + "</div>"; }
    async function showTab(tab) {
      S.tab = tab; S.cur = null; tabsHtml();
      if (tab === "settings") return drawSettings(true);
      if (tab === "compose") return drawCompose();
      drawList();
      try { await loadList(tab); } catch (e) { main.innerHTML = '<div class="mbx-empty bad">' + esc(errMsg(e)) + "</div>"; return; }
      if (S.tab === tab && !S.cur) drawList();
    }

    // ---------- 看信 ----------
    async function openLetter(id) {
      main.innerHTML = skeleton();
      var r;
      try { r = await rpc("letter_get", { p_id: +id }); } catch (e) { main.innerHTML = '<div class="mbx-empty bad">' + esc(errMsg(e)) + "</div>"; return; }
      S.cur = r; drawLetter(); loadUnread();
    }
    function letterBlock(l, main_) {
      var f = l.from || {}, av = f.team ? "捞" : (f.name || "?").slice(0, 1);
      return '<article class="mbx-letter' + (main_ ? " cur" : "") + '"><header><span class="mbx-av sm' + (f.team ? " k-team" : "") + '" aria-hidden="true">' + esc(av) + '</span>' +
        '<span class="mbx-from"><b>' + esc(who(l.from)) + '</b><span class="mbx-to">写给 ' + esc(who(l.to)) + '</span></span><time>' + esc(when(l.at)) + "</time></header>" +
        (badge(l) ? '<div class="mbx-chips">' + badge(l) + "</div>" : "") +
        (main_ ? "" : '<div class="mbx-sub">' + esc(l.subject) + "</div>") +
        '<div class="mbx-body">' + esc(l.body || "") + "</div>" + (l.report_reason && S.admin ? '<p class="mbx-reason">举报理由：' + esc(l.report_reason) + "</p>" : "") + "</article>";
    }
    function drawLetter() {
      var r = S.cur, l = r.letter, adm = r.admin, mine = S.tab === "out", acts = [];
      var incoming = !mine && !l.to_team && l.to && !l.to.team && l.from && l.from.account;
      if (l.status !== "removed" && (S.tab === "in" || S.tab === "out" || (S.tab === "team") || (adm && l.to_team))) acts.push('<button type="button" class="mbx-btn pri" data-a="reply">回复</button>');
      if (S.tab === "in" && !l.reported) acts.push('<button type="button" class="mbx-btn" data-a="report">举报</button>');
      if (S.tab === "in" && incoming && !(l.from && l.from.team)) acts.push('<button type="button" class="mbx-btn" data-a="block">拉黑对方</button>');
      if (S.tab === "in" || S.tab === "out") acts.push('<button type="button" class="mbx-btn danger" data-a="del">删除</button>');
      if (adm && l.to_team) acts.push('<button type="button" class="mbx-btn" data-a="' + (l.team_done ? "undone" : "done") + '">' + (l.team_done ? "改回未处理" : "标记已处理") + "</button>");
      if (adm && l.status === "held") acts.push('<button type="button" class="mbx-btn pri" data-a="approve">审核通过</button>');
      if (adm && (l.status === "held" || l.reported) && l.status !== "removed") acts.push('<button type="button" class="mbx-btn danger" data-a="remove">删除违规信</button>');
      if (adm && l.reported) acts.push('<button type="button" class="mbx-btn" data-a="dismiss">举报不成立</button>');
      var older = (r.thread || []).filter(function (x) { return x.id < l.id; }), newer = (r.thread || []).filter(function (x) { return x.id > l.id; });
      head(S.tab, l.subject || "（无标题）", (l.to_team || l.kind !== "user" ? (KIND[l.kind] || "") + " · " : "") + when(l.at),
        '<button type="button" class="mbx-btn" data-a="back">' + ic("back") + '返回</button>');
      main.innerHTML = (older.length ? '<div class="mbx-thread">' + older.map(function (x) { return letterBlock(x, false); }).join("") + "</div>" : "") + letterBlock(l, true) +
        (newer.length ? '<div class="mbx-thread">' + newer.map(function (x) { return letterBlock(x, false); }).join("") + "</div>" : "") +
        '<div class="mbx-acts mbx-bar">' + acts.join("") + "</div>" +
        (S.tab === "in" && !l.to_team ? '<p class="mbx-fine">遇到骚扰、诈骗、违法内容，点「举报」，管理员会处理；「拉黑」后对方就不能再给你写信。</p>' : "");
    }

    // ---------- 写信 ----------
    function drawCompose(c) {
      c = S.compose = Object.assign({ to: "team", kind: "suggest", subject: "", body: "", account: "" }, S.compose || {}, c || {});
      S.tab = "compose"; tabsHtml();
      // 7.7.1 用户之间写信默认不开放（管理员开了才有「写给同学 / 老师」，而且每封先审后发）
      var userOn = S.admin || !!(S.unread && S.unread.u);
      if (!userOn && !c.reply) c.to = "team";
      var team = c.to === "team" && !c.reply;
      head("compose", c.reply ? "回信" : team ? "写信给捞捞团队" : "写信给同学 / 老师", c.reply ? "回复：" + (c.replyLabel || "") : team ? "团队管理员会阅读并回复你，一般 3 个工作日内" : "每封信先审后发，审核通过后对方才收到",
        '<button type="button" class="mbx-btn" data-a="cancel">取消</button>');
      var tips = team ? {
        report: ["写清楚在哪里：哪个班级、哪个账号或哪个页面", "说明发生了什么、大概什么时间", "把关键文字抄下来（不要发别人的隐私信息）"],
        suggest: ["一封信说一件事，方便我们跟进", "说说你在做什么时遇到的问题", "有截图的话，把看到的文字写下来"],
        opensource: ["你会什么：代码、设计、文档、测试、推广…", "想做什么、每周大概有多少时间", "怎么联系你（GitHub 或邮箱）"],
        security: ["请不要公开发布漏洞细节", "写清楚复现步骤和可能的影响", "只写复现需要的最少信息，不要附上真实用户数据"],
        other: ["想说什么都可以", "需要回复的话，记得绑定邮箱接收提醒"],
      }[c.kind] : ["只能写给同班同学和老师", "对方账号是 TA 登录用的账号，不是昵称", "请勿发送违法违规、骚扰他人的内容"];
      main.innerHTML = '<form class="mbx-form" novalidate><div class="mbx-cmain">' +
        (c.reply ? "" : (userOn ? '<div class="mbx-step"><span class="mbx-lbl">写给谁</span><div class="mbx-to2" role="radiogroup" aria-label="写给谁">' +
          '<label class="mbx-card' + (team ? " on" : "") + '"><input type="radio" name="to" value="team"' + (team ? " checked" : "") + '><span class="ic">' + ic("team") + '</span><b>捞捞团队</b><small>举报、建议、开源合作、安全问题</small></label>' +
          '<label class="mbx-card' + (team ? "" : " on") + '"><input type="radio" name="to" value="user"' + (team ? "" : " checked") + '><span class="ic">' + ic("users") + '</span><b>同班同学 / 老师</b><small>每封信先审后发</small></label></div></div>' : "") +
          (team ? '<div class="mbx-step"><span class="mbx-lbl">选择类型</span><div class="mbx-kinds" role="radiogroup" aria-label="类型">' + TEAM_KINDS.map(function (k) {
              return '<label class="mbx-kind k-' + k + (c.kind === k ? " on" : "") + '"><input type="radio" name="kind" value="' + k + '"' + (c.kind === k ? " checked" : "") + '><span class="ic">' + KIND_ICON[k] + "</span><b>" + KIND[k] + "</b><small>" + KIND_DESC[k] + "</small></label>";
            }).join("") + '</div><p class="mbx-callout k-' + c.kind + '">' + esc(KIND_TIP[c.kind] || "") + "</p></div>"
            : '<div class="mbx-step"><label class="mbx-f"><span class="mbx-lbl">收信人</span><input name="account" maxlength="40" autocomplete="off" placeholder="对方登录用的账号，在 TA 的个人主页能看到" value="' + esc(c.account) + '"></label></div>')) +
        '<div class="mbx-step"><label class="mbx-f"><span class="mbx-lbl">标题</span><input name="subject" maxlength="80" placeholder="一句话说明（可以不填）" value="' + esc(c.subject) + '"></label></div>' +
        '<div class="mbx-step"><span class="mbx-lbl">内容</span><div class="mbx-editor"><textarea name="body" maxlength="5000" rows="10" required aria-label="内容" placeholder="' + (team ? "写下你想说的…" : "想对 TA 说什么？") + '">' + esc(c.body) + '</textarea>' +
          '<div class="mbx-ebar"><span>Ctrl + Enter 发送</span><small class="mbx-count"></small></div></div></div>' +
        '<div class="mbx-send"><span class="mbx-lock">' + ic("lock") + '加密传输 · 加密保存 · 至少留存 180 天</span><button type="button" class="mbx-btn" data-a="cancel">取消</button><button type="submit" class="mbx-btn pri big">发送</button></div>' +
        '</div><aside class="mbx-cside"><h4>' + ic("tips") + (team ? "怎么写更容易被处理" : "写信须知") + "</h4><ul>" + tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
        '<div class="mbx-legal"><b>合规说明</b><p>信件全程加密传输（HTTPS），在服务器上加密保存。为遵守《网络安全法》等法律法规，用户之间的信先审后发、被举报的信由管理员处理，信件记录至少保存 180 天。请勿发送违法违规、侵犯他人权益或骚扰他人的内容。</p></div></aside></form>';
      var f = main.querySelector("form"), ta = f.body, cnt = f.querySelector(".mbx-count");
      var upd = function () { cnt.textContent = ta.value.length + " / 5000"; cnt.classList.toggle("warn", ta.value.length > 4500); };
      ta.addEventListener("input", upd); upd();
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(f); } });
      f.addEventListener("change", function (e) {
        if (e.target.name === "to" || e.target.name === "kind") { keep(f); drawCompose({ to: f.to ? f.to.value : c.to, kind: f.kind ? f.kind.value : c.kind }); var fo = main.querySelector('input[name="' + e.target.name + '"]:checked'); if (fo) fo.focus(); }
      });
      f.addEventListener("submit", function (e) { e.preventDefault(); send(f); });
      if (c.reply) setTimeout(function () { try { ta.focus(); } catch (e) {} }, 30);
    }
    function keep(f) {
      var c = S.compose;
      if (f.subject) c.subject = f.subject.value; if (f.body) c.body = f.body.value; if (f.account) c.account = f.account.value;
    }
    async function send(f) {
      if (S.busy) return;
      keep(f); var c = S.compose;
      if ((c.body || "").trim().length < 2) { toast("内容太短了", true); return; }
      if (!c.reply && c.to !== "team" && !(c.account || "").trim()) { toast("请填写对方的账号", true); return; }
      S.busy = true; var btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = "发送中…";
      try {
        var r = await rpc("letter_send", { p_to: c.reply ? null : c.to === "team" ? "team" : c.account.trim(), p_kind: c.to === "team" ? c.kind : "user",
          p_subject: c.subject || "", p_body: c.body, p_reply: c.reply || null });
        S.compose = null;
        toast(r && r.msg ? r.msg : "已发送" + (c.to === "team" && !c.reply ? "，我们会尽快回复你" : ""));
        S.lists = {}; showTab("out");
      } catch (e) { toast(errMsg(e), true); btn.disabled = false; btn.textContent = "发送"; }
      S.busy = false;
    }

    // ---------- 设置 ----------
    async function drawSettings(reload) {
      head("settings");
      if (reload || !S.settings) {
        main.innerHTML = skeleton();
        try { S.settings = await rpc("letter_settings", {}); S.admin = !!S.settings.admin; tabsHtml(); } catch (e) { main.innerHTML = '<div class="mbx-empty bad">' + esc(errMsg(e)) + "</div>"; return; }
        if (S.admin && !S.words) { try { S.words = await rpc("letter_words", {}); } catch (e) {} }
      }
      var s = S.settings, acc = s.accept;
      var userOn = !!s.user_letters || S.admin;
      var opt = function (v, t, d) { return '<label class="mbx-opt"><input type="radio" name="accept" value="' + v + '"' + (acc === v ? " checked" : "") + "><span><b>" + t + "</b><small>" + d + "</small></span></label>"; };
      main.innerHTML = (userOn ? '<section class="mbx-sec"><h3>' + ic("users") + '谁可以给我写信</h3>' +
        opt("class", "同班同学和老师", "只有和你在同一个班的人能给你写信，每封信都经过管理员审核") + opt("none", "不接收", "只收捞捞团队的回复和别人对你来信的回复") +
        '<p class="mbx-fine">写信给捞捞团队不受这个限制。</p></section>' : '<section class="mbx-sec"><h3>' + ic("mail") + '信箱的用途</h3><p class="mbx-fine">目前信箱只用于和捞捞团队联系（举报、建议、开源合作、安全问题），用户之间暂不开放写信。</p></section>') +
        '<section class="mbx-sec"><h3>' + ic("bell") + '新信提醒</h3>' +
        (s.email ? '<p>收到新信时发提醒到 <b>' + esc(s.email) + "</b>（邮件里不含信的内容）</p>" +
          '<label class="mbx-opt"><input type="checkbox" name="notify"' + (s.notify ? " checked" : "") + "><span><b>发邮件提醒我</b></span></label>"
          : '<p class="mbx-fine">' + (s.pending_email ? "邮箱 " + esc(s.pending_email) + " 还没验证。" : "还没有绑定自己的邮箱。") + "绑定后，收到新信、作业快截止等会发邮件提醒你。</p>") +
        (opts.openBindEmail ? '<button type="button" class="mbx-btn" data-a="bindmail">' + (s.email ? "更换邮箱" : "绑定我的邮箱") + "</button>" : "") +
        (s.mail_ready ? "" : '<p class="mbx-fine">（管理员还没开通邮件发送，暂时收不到邮件提醒）</p>') + "</section>" +
        '<section class="mbx-sec"><h3>' + ic("ban") + '黑名单</h3>' + ((s.blocks || []).length ? '<ul class="mbx-blocks">' + s.blocks.map(function (b) {
          return '<li><span>' + esc(b.name) + '<small>' + esc(b.account) + '</small></span><button type="button" class="mbx-btn" data-unblock="' + esc(b.account) + '">取消拉黑</button></li>';
        }).join("") + "</ul>" : '<p class="mbx-fine">没有拉黑任何人。在收到的信里点「拉黑对方」，对方就不能再给你写信。</p>') + "</section>" +
        (S.admin ? '<section class="mbx-sec adm"><h3>' + ic("tools") + '管理员</h3>' +
          '<label class="mbx-opt"><input type="checkbox" name="userletters"' + (s.user_letters ? " checked" : "") + "><span><b>允许同班同学、老师之间写信</b><small>默认关闭。开启后每封信都要你在「待审核」里通过才送达（先审后发）；随时可以关掉，写信给团队不受影响</small></span></label>" +
          '<h4>班级墙和评论</h4><label class="mbx-f"><select name="wallmode">' +
            [["review", "先审后发（推荐）：学生发帖要老师审核通过才显示，学生暂不能评论"], ["off", "只有老师能发帖和评论，学生只能看"], ["open", "直接发布：发了马上显示，事后举报处理"]]
              .map(function (o) { return '<option value="' + o[0] + '"' + ((s.wall_mode || "review") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<p class="mbx-fine">对全站所有班级生效。敏感词表对班级墙同样有效：「拦截」级发不出去，「审核」级和带网址的帖子一律先审后发。</p>' +
          '<h4>敏感词</h4><p class="mbx-fine">「拦截」：用户私信里出现就发不出去；「审核」：先进待审核，你确认后对方才收到。写给团队的信只标出来、不拦截。匹配时忽略空格和标点。</p>' +
          '<form class="mbx-wordadd"><input name="w" maxlength="40" placeholder="添加敏感词"><select name="lv"><option value="hold">审核</option><option value="block">拦截</option></select><button type="submit" class="mbx-btn">添加</button></form>' +
          '<ul class="mbx-words">' + (S.words || []).map(function (w) { return '<li class="lv-' + w.level + '">' + esc(w.word) + '<small>' + (w.level === "block" ? "拦截" : "审核") + '</small><button type="button" data-delword="' + esc(w.word) + '" aria-label="删除 ' + esc(w.word) + '">×</button></li>'; }).join("") + "</ul></section>" : "");
      var wf = main.querySelector(".mbx-wordadd");
      if (wf) wf.addEventListener("submit", async function (e) {
        e.preventDefault(); var w = wf.w.value.trim(); if (!w) return;
        try { S.words = await rpc("letter_words", { p_word: w, p_level: wf.lv.value }); drawSettings(); toast("已添加"); } catch (er) { toast(errMsg(er), true); }
      });
    }
    main.addEventListener("change", async function (e) {
      var t = e.target; if (S.tab !== "settings") return;
      try {
        if (t.name === "accept") { S.settings = await rpc("letter_settings_set", { p_accept: t.value, p_notify: null }); toast("已保存"); }
        else if (t.name === "notify") { S.settings = await rpc("letter_settings_set", { p_accept: null, p_notify: t.checked }); toast("已保存"); }
        else if (t.name === "wallmode") { await rpc("wall_mode_set", { p_mode: t.value }); S.settings.wall_mode = t.value; toast("班级墙模式已保存"); }
        else if (t.name === "userletters") { S.settings = await rpc("letter_admin_switch", { p_on: t.checked }); toast(t.checked ? "已开启：同班同学、老师之间可以写信（先审后发）" : "已关闭用户之间写信"); }
      } catch (er) { toast(errMsg(er), true); drawSettings(true); }
    });

    // ---------- 点击 ----------
    el.addEventListener("click", async function (e) {
      var tb = e.target.closest("[data-mtab]");
      if (tb && tabsEl.contains(tb)) { showTab(tb.dataset.mtab); return; }
      var o = e.target.closest("[data-open]"); if (o) { openLetter(o.dataset.open); return; }
      var ub = e.target.closest("[data-unblock]");
      if (ub) { try { S.settings = await rpc("letter_block", { p_account: ub.dataset.unblock, p_on: false }); drawSettings(); toast("已取消拉黑"); } catch (er) { toast(errMsg(er), true); } return; }
      var dw = e.target.closest("[data-delword]");
      if (dw) { try { S.words = await rpc("letter_words", { p_word: dw.dataset.delword, p_level: null }); drawSettings(); } catch (er) { toast(errMsg(er), true); } return; }
      var b = e.target.closest("[data-a]"); if (!b) return;
      var a = b.dataset.a, cur = S.cur && S.cur.letter;
      if (a === "compose") { S.compose = null; drawCompose(); return; }
      if (a === "compose-team") { S.compose = null; drawCompose({ to: "team", kind: "suggest" }); return; }
      if (a === "cancel") { S.compose = null; showTab("in"); return; }
      if (a === "back") { if (S.compose && S.compose.reply) { S.compose = null; } showTab(S.tab === "compose" ? "in" : S.tab); return; }
      if (a === "reload") { S.lists = {}; loadUnread(); showTab(S.tab); return; }
      if (a === "more") { await loadList(S.tab, true); drawList(); return; }
      if (a === "bindmail") { if (opts.openBindEmail) opts.openBindEmail(); return; }
      if (!cur) return;
      try {
        if (a === "reply") {
          var back = S.tab;
          drawCompose({ reply: cur.id, replyLabel: (back === "out" ? who(cur.to) : who(cur.from)) + " · " + cur.subject, subject: /^回复[:：]/.test(cur.subject) ? cur.subject : "回复：" + cur.subject, body: "", to: "user" });
          S.tab = back; tabsHtml();
          return;
        }
        if (a === "report") {
          var why = await ask("举报这封信？管理员会看到信的内容并处理。", "举报理由（比如：骚扰、诈骗、广告、违法内容）");
          if (why == null) return;
          await rpc("letter_report", { p_id: cur.id, p_reason: why }); toast("已举报，管理员会尽快处理"); openLetter(cur.id); return;
        }
        if (a === "block") {
          if (!(await ask("拉黑 " + who(cur.from) + "？拉黑后 TA 不能再给你写信，可以在「设置」里取消。"))) return;
          await rpc("letter_block", { p_account: cur.from.account, p_on: true }); S.settings = null; toast("已拉黑"); return;
        }
        if (a === "del") {
          if (!(await ask("从你的信箱里删除这封信？"))) return;
          await rpc("letter_delete", { p_id: cur.id }); toast("已删除"); S.lists = {}; showTab(S.tab); return;
        }
        if (["done", "undone", "approve", "remove", "dismiss"].indexOf(a) >= 0) {
          if (a === "remove" && !(await ask("确定这封信违规？删除后双方都看不到（数据库里按规定留存 180 天）。"))) return;
          await rpc("letter_admin_act", { p_id: cur.id, p_act: a });
          toast({ done: "已标记处理", undone: "已改回未处理", approve: "已通过，对方会收到这封信", remove: "已删除", dismiss: "已标记举报不成立" }[a]);
          S.lists = {}; loadUnread(); openLetter(cur.id); return;
        }
      } catch (er) { toast(errMsg(er), true); }
    });

    var api = {
      open: function (o) {
        o = o || {};
        loadUnread();
        if (o.tab === "compose") { S.compose = null; drawCompose({ to: o.to || "team", kind: TEAM_KINDS.indexOf(o.kind) >= 0 ? o.kind : "suggest", subject: o.subject || "", body: o.body || "", account: o.to && o.to !== "team" ? o.to : "" }); }
        else showTab(o.tab || (S.tab === "compose" ? "in" : S.tab || "in"));
      },
      refresh: function () { S.lists = {}; if (S.tab !== "compose") showTab(S.tab); loadUnread(); },
      unread: loadUnread,
    };
    tabsHtml();
    return api;
  }
  window.MailboxUI = { mount: mount, KIND: KIND, icon: ic };
})();
