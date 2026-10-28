// 7.7 信箱（和网站共用 web/mailbox-ui.js）：站内信、给捞捞团队写信（举报、建议、开源共建、安全漏洞）
"use strict";
App.views.mail = {
  title: "信箱", icon: "mail", ui: null, unread: 0,
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>信箱</h1><div class="sub">写信给捞捞团队：举报、建议、开源合作、安全问题</div></div><span class="grow"></span></div>
      <div class="vbody"><div class="mail-wrap" id="mailRoot"></div></div>`;
    if (!window.MailboxUI) { $("#mailRoot", el).innerHTML = `<div class="empty">信箱模块没加载上，重新打开电脑版试试</div>`; return; }
    this.ui = window.MailboxUI.mount($("#mailRoot", el), {
      // 电脑版的报错带着「Error invoking remote method…」前缀：去掉再给信箱显示
      rpc: (fn, a) => window.cc.call("api:rpc", fn, a || {}).catch((e) => { throw new Error(cleanErr(e)); }),
      openBindEmail: () => { App.go("me"); setTimeout(() => { const n = document.getElementById("mlAddr") || document.querySelector('[data-a="ml-unbind"]'); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); if (n.focus) n.focus(); } }, 500); },
      onUnread: (u) => { this.setUnread(u); },
    });
  },
  setUnread(u) { const n = u ? (u.in || 0) + (u.team || 0) + (u.review || 0) : 0; if (n !== this.unread) { this.unread = n; try { navCounts(); } catch (e) {} } },
  async poll() {
    if (!App.S || !App.S.loggedIn || document.hidden) return;
    try { this.setUnread(await api("letter_unread", {}, true)); } catch (e) {}
  },
  show(arg) { if (!this.ui) return; if (arg && arg.tab) this.ui.open(arg); else this.ui.refresh(); },
  update() {},
  count() { return this.unread ? { n: this.unread, hot: true } : null; },
};
setTimeout(() => App.views.mail.poll(), 4000);
setInterval(() => App.views.mail.poll(), 60000);
