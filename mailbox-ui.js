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
    el.innerHTML = '<div class="mbx-top"><div class="mbx-tabs" role="tablist"></div><button type="button" class="mbx-btn pri" data-a="compose">✉️ 写信</button></div>' +
      '<div class="mbx-main" aria-live="polite"></div><div class="mbx-toast" role="status"></div>';
    var tabsEl = el.querySelector(".mbx-tabs"), main = el.querySelector(".mbx-main"), toastEl = el.querySelector(".mbx-toast"), toastT = 0;
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
        return '<button type="button" role="tab" data-mtab="' + x[0] + '" aria-selected="' + (S.tab === x[0]) + '" class="' + (S.tab === x[0] ? "on" : "") + '">' + x[1] +
          (x[2] ? '<em>' + (x[2] > 99 ? "99+" : x[2]) + "</em>" : "") + "</button>";
      }).join("");
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
      if (!arr) { main.innerHTML = '<div class="mbx-empty">加载中…</div>'; return; }
      var head = box === "team" ? '<p class="mbx-tip">用户写给捞捞团队的信（举报、建议、开源合作、安全问题）。处理完点「标记已处理」。</p>'
        : box === "review" ? '<p class="mbx-tip">命中敏感词、带网址的用户私信要你确认后对方才收到；用户举报的信也在这里。</p>' : "";
      if (!arr.length) {
        main.innerHTML = head + '<div class="mbx-empty">' + ({ in: "还没有收到信", out: "还没有写过信", team: "团队信箱是空的", review: "没有要处理的信" }[box] || "") +
          (box === "in" || box === "out" ? '<br><button type="button" class="mbx-btn" data-a="compose-team">写信给捞捞团队</button>' : "") + "</div>";
        return;
      }
      main.innerHTML = head + '<ul class="mbx-list">' + arr.map(function (l) {
        var other = box === "out" ? "给 " + who(l.to) : who(l.from);
        return '<li><button type="button" class="mbx-item' + (box === "in" && !l.read ? " unread" : "") + '" data-open="' + l.id + '">' +
          '<span class="mbx-av" aria-hidden="true">' + esc(((box === "out" ? (l.to && l.to.team ? "捞" : l.to && l.to.name) : (l.from && l.from.team ? "捞" : l.from && l.from.name)) || "?").slice(0, 1)) + "</span>" +
          '<span class="mbx-it"><span class="mbx-l1"><b>' + esc(other) + "</b>" + badge(l) + '<time>' + esc(when(l.at)) + "</time></span>" +
          '<span class="mbx-sub">' + esc(l.subject) + "</span><span class=\"mbx-snip\">" + esc(l.snippet || "") + "</span></span></button></li>";
      }).join("") + "</ul>" + (S.more ? '<button type="button" class="mbx-btn mbx-more" data-a="more">加载更多</button>' : "");
    }
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
      main.innerHTML = '<div class="mbx-empty">打开中…</div>';
      var r;
      try { r = await rpc("letter_get", { p_id: +id }); } catch (e) { main.innerHTML = '<div class="mbx-empty bad">' + esc(errMsg(e)) + "</div>"; return; }
      S.cur = r; drawLetter(); loadUnread();
    }
    function letterBlock(l, main_) {
      return '<article class="mbx-letter' + (main_ ? " cur" : "") + '"><header><b>' + esc(who(l.from)) + '</b><span class="mbx-to">写给 ' + esc(who(l.to)) + "</span>" + badge(l) +
        '<time>' + esc(when(l.at)) + "</time></header>" + (main_ ? '<h3>' + esc(l.subject) + "</h3>" : '<div class="mbx-sub">' + esc(l.subject) + "</div>") +
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
      main.innerHTML = '<button type="button" class="mbx-back" data-a="back">‹ 返回</button>' +
        older.map(function (x) { return letterBlock(x, false); }).join("") + letterBlock(l, true) + newer.map(function (x) { return letterBlock(x, false); }).join("") +
        '<div class="mbx-acts">' + acts.join("") + "</div>" +
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
      main.innerHTML = '<form class="mbx-form" novalidate>' + (c.reply ? '<button type="button" class="mbx-back" data-a="back">‹ 返回</button><p class="mbx-tip">回复：' + esc(c.replyLabel || "") + "</p>" :
        (userOn ? '<div class="mbx-seg" role="radiogroup" aria-label="写给谁"><label><input type="radio" name="to" value="team"' + (team ? " checked" : "") + '> 写给捞捞团队</label>' +
        '<label><input type="radio" name="to" value="user"' + (team ? "" : " checked") + '> 写给同班同学 / 老师</label></div>' : '<p class="mbx-tip"><b>写给捞捞团队</b></p>') +
        (team ? '<label class="mbx-f">类型<select name="kind">' + TEAM_KINDS.map(function (k) { return '<option value="' + k + '"' + (c.kind === k ? " selected" : "") + ">" + KIND[k] + "</option>"; }).join("") + "</select></label>" +
          '<p class="mbx-tip">' + esc(KIND_TIP[c.kind] || "") + "</p>"
          : '<label class="mbx-f">对方账号<input name="account" maxlength="40" autocomplete="off" placeholder="同班同学或老师登录用的账号（不是昵称），在 TA 的个人主页能看到" value="' + esc(c.account) + '"></label>' +
            '<p class="mbx-tip">只能写给同班同学和老师。为了防止骚扰和违规信息，每封信都要先经过管理员审核，通过后对方才会收到。</p>')) +
        '<label class="mbx-f">标题<input name="subject" maxlength="80" placeholder="一句话说明（可以不填）" value="' + esc(c.subject) + '"></label>' +
        '<label class="mbx-f">内容<textarea name="body" maxlength="5000" rows="8" required placeholder="' + (team ? "写下你想说的…" : "想对 TA 说什么？") + '">' + esc(c.body) + "</textarea><small class=\"mbx-count\"></small></label>" +
        '<div class="mbx-acts"><button type="submit" class="mbx-btn pri">发送</button><button type="button" class="mbx-btn" data-a="cancel">取消</button></div>' +
        '<p class="mbx-fine">🔒 信件全程加密传输（HTTPS），在服务器上加密保存。为遵守《网络安全法》等法律法规，用户之间的信先审后发、被举报的信由管理员处理，信件记录至少保存 180 天。' +
        "请勿发送违法违规、侵犯他人权益或骚扰他人的内容。</p></form>";
      var f = main.querySelector("form"), ta = f.body, cnt = f.querySelector(".mbx-count");
      var upd = function () { cnt.textContent = ta.value.length + " / 5000"; };
      ta.addEventListener("input", upd); upd();
      f.addEventListener("change", function (e) {
        if (e.target.name === "to" || e.target.name === "kind") { keep(f); drawCompose({ to: f.to ? f.to.value : c.to, kind: f.kind ? f.kind.value : c.kind }); }
      });
      f.addEventListener("submit", function (e) { e.preventDefault(); send(f); });
      setTimeout(function () { try { (c.reply || team ? ta : f.account).focus(); } catch (e) {} }, 30);
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
      if (reload || !S.settings) {
        main.innerHTML = '<div class="mbx-empty">加载中…</div>';
        try { S.settings = await rpc("letter_settings", {}); S.admin = !!S.settings.admin; tabsHtml(); } catch (e) { main.innerHTML = '<div class="mbx-empty bad">' + esc(errMsg(e)) + "</div>"; return; }
        if (S.admin && !S.words) { try { S.words = await rpc("letter_words", {}); } catch (e) {} }
      }
      var s = S.settings, acc = s.accept;
      var userOn = !!s.user_letters || S.admin;
      var opt = function (v, t, d) { return '<label class="mbx-opt"><input type="radio" name="accept" value="' + v + '"' + (acc === v ? " checked" : "") + "><span><b>" + t + "</b><small>" + d + "</small></span></label>"; };
      main.innerHTML = (userOn ? '<section class="mbx-sec"><h3>谁可以给我写信</h3>' +
        opt("class", "同班同学和老师", "只有和你在同一个班的人能给你写信，每封信都经过管理员审核") + opt("none", "不接收", "只收捞捞团队的回复和别人对你来信的回复") +
        '<p class="mbx-fine">写信给捞捞团队不受这个限制。</p></section>' : '<section class="mbx-sec"><h3>信箱</h3><p class="mbx-fine">目前信箱只用于和捞捞团队联系（举报、建议、开源合作、安全问题），用户之间暂不开放写信。</p></section>') +
        '<section class="mbx-sec"><h3>新信提醒</h3>' +
        (s.email ? '<p>收到新信时发提醒到 <b>' + esc(s.email) + "</b>（邮件里不含信的内容）</p>" +
          '<label class="mbx-opt"><input type="checkbox" name="notify"' + (s.notify ? " checked" : "") + "><span><b>发邮件提醒我</b></span></label>"
          : '<p class="mbx-fine">' + (s.pending_email ? "邮箱 " + esc(s.pending_email) + " 还没验证。" : "还没有绑定自己的邮箱。") + "绑定后，收到新信、作业快截止等会发邮件提醒你。</p>") +
        (opts.openBindEmail ? '<button type="button" class="mbx-btn" data-a="bindmail">' + (s.email ? "更换邮箱" : "绑定我的邮箱") + "</button>" : "") +
        (s.mail_ready ? "" : '<p class="mbx-fine">（管理员还没开通邮件发送，暂时收不到邮件提醒）</p>') + "</section>" +
        '<section class="mbx-sec"><h3>黑名单</h3>' + ((s.blocks || []).length ? '<ul class="mbx-blocks">' + s.blocks.map(function (b) {
          return '<li><span>' + esc(b.name) + '<small>' + esc(b.account) + '</small></span><button type="button" class="mbx-btn" data-unblock="' + esc(b.account) + '">取消拉黑</button></li>';
        }).join("") + "</ul>" : '<p class="mbx-fine">没有拉黑任何人。在收到的信里点「拉黑对方」，对方就不能再给你写信。</p>') + "</section>" +
        (S.admin ? '<section class="mbx-sec adm"><h3>管理员</h3>' +
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
  window.MailboxUI = { mount: mount, KIND: KIND };
})();
