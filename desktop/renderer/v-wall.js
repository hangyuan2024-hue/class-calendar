// 班级墙：发言、写文章、发通知；按组分频道；评论和回复；置顶、编辑、删除；举报和老师处理举报
"use strict";
const WALL_COLS = "id,class_id,author_id,author_name,author_role,title,body,is_notice,pinned_at,hidden,report_count,reviewed,created_at,edited_at";
App.views.wall = {
  title: "班级墙", icon: "wall", posts: null, cid: null, loadedAt: 0, comments: {}, reported: new Set(), reports: [], filter: "all", chan: "", open: new Set(), reply: {}, unfold: new Set(), article: false,
  count() { const ps = this.list(); const n = ps.filter((p) => Date.parse(p.created_at) > this.seenAt() && (!App.S.me || p.author_id !== App.S.me.id)).length; return { n }; },
  seenAt() { try { let v = +localStorage.getItem("wallSeen"); if (!v) { v = Date.now(); localStorage.setItem("wallSeen", v); } return v; } catch (e) { return Date.now(); } },
  list() { const S = App.S; if (this.posts && this.cid === S.cid) return this.posts; return (S.wall && S.wall.cid === S.cid && S.wall.posts) || (S.wall && S.wall.posts) || []; },
  mod() { const c = App.cls(); return !!c && (c.is_teacher || App.isAdmin()); },
  canPin() { const c = App.cls(); return !!c && (c.is_teacher || c.member_role === "monitor" || App.isAdmin()); },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>班级墙</h1><div class="sub" id="wlSub"></div></div><span class="grow"></span>
        <button class="btn" data-go-people>${icon("people")}成员</button>
        <button class="btn" id="wlSync">${icon("sync")}刷新</button></div>
      <div class="vbody"><div class="wl-col">
        <form class="card wl-new" id="wlForm">
          <input class="wl-title hidden" name="t" maxlength="60" placeholder="文章标题">
          <textarea name="b" rows="3" maxlength="5000" placeholder="想和班里说点什么…　Ctrl+Enter 发布"></textarea>
          <div class="row wl-tools"><button type="button" class="btn ghost sm" id="wlArt">写成文章</button>
            <select class="input wl-to hidden" name="to" id="wlTo"></select>
            <label class="row wl-notice hidden" id="wlNotice"><input type="checkbox" name="n">作为通知发布</label>
            <span class="grow"></span><small class="muted" id="wlLen"></small><button class="btn primary" id="wlPost">${icon("send")}发布</button></div>
        </form>
        <div id="wlReports"></div>
        <div class="wl-chan hidden" id="wlChan"></div>
        <div class="seg wl-filter" id="wlFilter"><button data-f="all" class="on">全部</button><button data-f="notice">通知</button><button data-f="mine">我发的</button></div>
        <div id="wlList"></div>
        <div class="muted wl-foot">班级墙只有本班同学和老师能看到。发言请友善，不当内容可以举报，老师会处理。</div>
      </div></div>`;
    const f = $("#wlForm", el);
    f.b.oninput = () => { const n = f.b.value.trim().length; $("#wlLen", el).textContent = n ? `${n} / 5000` : ""; };
    f.b.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } };
    f.to.onchange = () => this.composer();
    $("#wlArt", el).onclick = () => { this.article = !this.article; f.t.classList.toggle("hidden", !this.article); $("#wlArt", el).textContent = this.article ? "不要标题" : "写成文章"; f.b.rows = this.article ? 8 : 3; if (this.article) f.t.focus(); else f.t.value = ""; };
    f.onsubmit = async (e) => {
      e.preventDefault(); if (!f.b.value.trim()) return f.b.focus();
      const btn = $("#wlPost", el); btn.disabled = true;
      try {
        await call("wall:post", f.t.value.trim(), f.b.value.trim(), f.n.checked, f.to.value || null);
        f.b.value = ""; f.t.value = ""; f.n.checked = false; f.b.oninput(); if (this.article) $("#wlArt", el).click();
        this.filter = "all"; toast("已发布"); await this.load(true);
      } catch (e) {} finally { btn.disabled = false; }
    };
    $("#wlSync", el).onclick = () => this.load(true).then(() => toast("已刷新"));
    el.querySelector("[data-go-people]").onclick = () => App.go("people");
    $("#wlFilter", el).onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; this.filter = b.dataset.f; this.draw(); };
    $("#wlChan", el).onclick = (e) => { const b = e.target.closest("[data-ch]"); if (!b) return; this.chan = b.dataset.ch; if (this.chan && this.chan !== "class") f.to.value = this.chan; this.draw(); this.composer(); };
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("keydown", (e) => { const i = e.target.closest("[data-cin]"); if (i && e.key === "Enter" && !e.isComposing) { e.preventDefault(); this.sendComment(+i.dataset.cin); } });
    el.addEventListener("input", (e) => { const i = e.target.closest("[data-cin]"); if (i) this.draft = { ...(this.draft || {}), [i.dataset.cin]: i.value }; });
  },
  show() {
    try { localStorage.setItem("wallSeen", Date.now()); } catch (e) {}
    if (this.cid !== App.S.cid || Date.now() - this.loadedAt > 60000) this.load();
    setTimeout(() => navCounts(), 50);
  },
  // 进到班级墙时拿全（打开软件时只顺带拿了最新 60 条）+ 评论 + 我举报过的 + 待处理的举报
  async load(force) {
    const S = App.S, cid = S.cid; if (!cid) { this.posts = []; this.draw(); return; }
    if (!force && this.busy) return; this.busy = true;
    try {
      const [posts, mine] = await Promise.all([
        apiGet(`wall_posts?select=${WALL_COLS}${S.groupsOk ? ",group_id" : ""}&class_id=eq.${cid}&order=created_at.desc&limit=300`),
        api("wall_my_reports", { cid }, true).catch(() => []),
      ]);
      if (App.S.cid !== cid) return;
      this.posts = (posts || []).map((p) => ({ ...p, title: p.title || "" })); this.cid = cid; this.loadedAt = Date.now();
      this.reported = new Set((mine || []).map(String));
      this.reports = this.mod() ? (await api("wall_report_list", { cid }, true).catch(() => [])) || [] : [];
      try { const cs = await api("wall_comments_get", { cid }, true); this.comments = {}; for (const c of cs || []) (this.comments[c.post_id] ||= []).push(c); } catch (e) { this.comments = {}; }
    } catch (e) { toast("班级墙加载失败：" + cleanErr(e), { bad: true }); }
    finally { this.busy = false; }
    this.draw();
  },
  update() { if (this.cid && this.cid !== App.S.cid) { this.posts = null; this.cid = null; if (App.view === "wall") this.load(); } this.draw(); },
  composer() {
    const el = this.el, S = App.S, f = $("#wlForm", el), c = App.cls();
    f.classList.toggle("hidden", !S.cid);
    const groups = S.groupsOk ? (S.groups || []).filter((g) => g.mine || App.isStaff()) : [];
    const was = f.to.value;
    f.to.innerHTML = `<option value="">发给全班</option>` + groups.map((g) => `<option value="${g.id}">只发给「${esc(g.name)}」</option>`).join("");
    f.to.value = groups.some((g) => String(g.id) === was) ? was : "";
    f.to.classList.toggle("hidden", !groups.length);
    const g = App.group(f.to.value);
    $("#wlNotice", el).classList.toggle("hidden", !(this.canPin() || (g && g.lead)));
    f.b.placeholder = c && !c.is_teacher && c.member_role !== "monitor" ? "想对全班说点什么？　Ctrl+Enter 发布" : "发通知、发文章，或者随便聊聊　Ctrl+Enter 发布";
  },
  draw() {
    const el = this.el; if (!el) return;
    const S = App.S, me = S.me || {}, all = this.list();
    $("#wlSub", el).textContent = App.className() ? `${App.className()} · ${all.filter((p) => !p.hidden).length} 条` : "还没加入班级";
    this.composer();
    // 频道
    const chans = S.groupsOk ? (S.groups || []).filter((g) => g.mine || App.isStaff()) : [];
    if (this.chan && this.chan !== "class" && !chans.some((g) => String(g.id) === this.chan)) this.chan = "";
    $("#wlChan", el).classList.toggle("hidden", !chans.length);
    $("#wlChan", el).innerHTML = [["", "全部"], ["class", "📣 全班"]].concat(chans.map((g) => [String(g.id), "👥 " + g.name]))
      .map(([v, t]) => `<button data-ch="${esc(v)}" class="${v === this.chan ? "on" : ""}">${esc(t)}${v && v !== "class" ? `<small>${all.filter((p) => String(p.group_id) === v).length || ""}</small>` : ""}</button>`).join("");
    $$("#wlFilter button", el).forEach((b) => b.classList.toggle("on", b.dataset.f === this.filter));
    // 举报（老师）
    $("#wlReports", el).innerHTML = this.mod() && this.reports.length ? `<div class="card wl-rep"><div class="card-h">🚩 待处理的举报（${this.reports.length}）</div>
      ${this.reports.map((x) => `<div class="rep"><b>${esc(x.author_name)}</b> 发的${x.title ? "「" + esc(x.title) + "」" : "内容"}${x.hidden ? "（已隐藏）" : ""}<div class="ex">${esc(x.body)}</div>
        <ul>${(x.reports || []).map((y) => `<li>${esc(y.by || "同学")}：${esc(y.reason)}</li>`).join("")}</ul>
        <div class="row"><button class="btn sm" data-w="goto" data-id="${x.id}">查看原文</button>${x.hidden ? "" : `<button class="btn sm danger" data-w="hide" data-id="${x.id}">隐藏这条</button>`}<button class="btn sm" data-w="dismiss" data-id="${x.id}">没问题，保留</button></div></div>`).join("")}</div>` : "";
    let list = all.slice();
    if (this.chan === "class") list = list.filter((p) => !p.group_id); else if (this.chan) list = list.filter((p) => String(p.group_id) === this.chan);
    if (this.filter === "notice") list = list.filter((p) => p.is_notice);
    if (this.filter === "mine") list = list.filter((p) => p.author_id === me.id);
    if (!this.mod()) list = list.filter((p) => !p.hidden || p.author_id === me.id);
    const pinned = list.filter((p) => p.pinned_at && !p.hidden).sort((a, b) => String(b.pinned_at).localeCompare(String(a.pinned_at)));
    const rest = list.filter((p) => !(p.pinned_at && !p.hidden)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    $("#wlList", el).innerHTML = pinned.concat(rest).map((p) => this.postHtml(p)).join("")
      || `<div class="empty"><b>💬</b>${!S.cid ? "加入班级后能看到班级墙" : this.filter === "notice" ? "还没有通知" : this.filter === "mine" ? "你还没发过内容" : "班级墙还是空的，发第一条吧"}</div>`;
  },
  postHtml(p) {
    const me = App.S.me || {}, mine = p.author_id === me.id, mod = this.mod();
    const folded = p.report_count >= 3 && !p.reviewed && !mine && !mod && !this.unfold.has(p.id);
    const role = ROLE_CN[p.author_role] && p.author_role !== "student" ? `<span class="tag" style="--c:${p.author_role === "teacher" ? "var(--t-会议)" : "var(--brand)"}">${ROLE_CN[p.author_role]}</span>` : "";
    const g = App.group(p.group_id);
    const flags = [p.pinned_at && !p.hidden ? `<span class="tag" style="--c:var(--warn)">📌 置顶</span>` : "", p.is_notice ? `<span class="tag" style="--c:var(--bad)">📢 通知</span>` : "",
      p.group_id ? `<span class="tag" style="--c:var(--ok)">👥 ${esc(g ? g.name : "分组")}</span>` : "", p.hidden ? `<span class="tag" style="--c:var(--muted)">已隐藏，只有你${mod ? "们" : ""}能看到</span>` : "",
      mod && p.report_count > 0 ? `<span class="tag" style="--c:var(--bad)">${p.report_count} 人举报</span>` : ""].join("");
    const ops = [];
    const cs = this.comments[p.id] || [];
    if (!(p.hidden && !mod)) ops.push(`<button class="btn ghost sm" data-c="toggle" data-id="${p.id}">💬 ${cs.length ? cs.length + " 条评论" : "评论"}</button>`);
    if (this.canPin() && !p.hidden) ops.push(`<button class="btn ghost sm" data-w="pin" data-id="${p.id}">${p.pinned_at ? "取消置顶" : "📌 置顶"}</button>`);
    if (mine) ops.push(`<button class="btn ghost sm" data-w="edit" data-id="${p.id}">编辑</button>`);
    if (mine || mod) ops.push(`<button class="btn ghost sm danger" data-w="del" data-id="${p.id}">删除</button>`);
    if (mod) ops.push(p.hidden ? `<button class="btn ghost sm" data-w="unhide" data-id="${p.id}">恢复显示</button>` : `<button class="btn ghost sm danger" data-w="hide" data-id="${p.id}">隐藏</button>`);
    if (!mine && !mod) ops.push(this.reported.has(String(p.id)) ? `<button class="btn ghost sm" disabled>已举报</button>` : `<button class="btn ghost sm" data-w="report" data-id="${p.id}">举报</button>`);
    return `<article class="card wl-p${p.pinned_at && !p.hidden ? " pin" : ""}${p.is_notice ? " notice" : ""}${p.hidden ? " hid" : ""}" id="post-${p.id}">
      <header>${avHtml(p.author_name, "sm", p.author_id)}<b class="ulink" data-user="${esc(p.author_id || "")}">${esc(p.author_name || "同学")}</b>${role}<small class="muted" title="${esc(new Date(p.created_at).toLocaleString("zh-CN"))}">${ago(p.created_at)}${p.edited_at ? " · 编辑过" : ""}</small><span class="grow"></span>${flags}</header>
      ${folded ? `<div class="wl-fold">这条内容被多位同学举报，正在等老师处理。<button class="btn sm" data-w="unfold" data-id="${p.id}">仍要查看</button></div>`
        : `${p.title ? `<h3 class="selectable">${esc(p.title)}</h3>` : ""}<div class="wl-b selectable">${esc(p.body)}</div>`}
      <div class="wl-ops">${ops.join("")}</div>
      ${folded ? "" : this.commentsHtml(p)}</article>`;
  },
  commentsHtml(p) {
    if (p.hidden && !this.mod()) return "";
    const me = App.S.me || {}, cs = this.comments[p.id] || [], open = this.open.has(p.id), shown = open ? cs : cs.slice(-2), rp = this.reply[p.id];
    if (!shown.length && !open) return "";
    const one = (c) => {
      const mine = c.author_id === me.id, canDel = mine || p.author_id === me.id || this.mod();
      return `<div class="cm">${avHtml(c.author_name, "xs", c.author_id)}<div><div><b class="ulink" data-user="${esc(c.author_id || "")}">${esc(c.author_name)}</b>${c.author_role && c.author_role !== "student" && ROLE_CN[c.author_role] ? ` <span class="tag">${ROLE_CN[c.author_role]}</span>` : ""}${c.reply_name ? ` <span class="muted">回复</span> <b>${esc(c.reply_name)}</b>` : ""}</div>
        <div class="selectable">${esc(c.body)}</div><div class="cm-f"><span>${ago(c.created_at)}</span>${mine ? "" : `<a data-c="reply" data-id="${p.id}" data-name="${esc(c.author_name)}">回复</a>`}${canDel ? `<a class="danger" data-c="del" data-cid="${c.id}" data-id="${p.id}">删除</a>` : ""}</div></div></div>`;
    };
    return `<div class="wl-cm">${!open && cs.length > 2 ? `<a class="cm-more" data-c="toggle" data-id="${p.id}">查看全部 ${cs.length} 条评论</a>` : ""}${shown.map(one).join("")}
      ${open ? `<div class="cm-in">${rp ? `<span class="tag">回复 ${esc(rp)} <a data-c="unreply" data-id="${p.id}">✕</a></span>` : ""}<input class="input" data-cin="${p.id}" maxlength="500" placeholder="${rp ? "回复 " + esc(rp) + "…" : "说点什么…（Enter 发送）"}" value="${esc((this.draft || {})[p.id] || "")}"><button class="btn primary sm" data-c="send" data-id="${p.id}">发送</button></div>` : ""}</div>`;
  },
  async sendComment(pid) {
    const inp = $(`[data-cin="${pid}"]`, this.el); if (!inp) return;
    const body = inp.value.trim(); if (!body) return inp.focus();
    inp.disabled = true;
    try {
      const c = await api("wall_comment_add", { pid, p_body: body, p_reply: this.reply[pid] || null });
      (this.comments[pid] ||= []).push(c); delete (this.draft || {})[pid]; delete this.reply[pid];
      this.draw(); const n = $(`[data-cin="${pid}"]`, this.el); if (n) n.focus();
    } catch (e) { inp.disabled = false; }
  },
  async click(e) {
    const u = e.target.closest("[data-user]"); if (u && u.dataset.user) { App.go("people", { uid: u.dataset.user }); return; }
    const c = e.target.closest("[data-c]");
    if (c) {
      const pid = +c.dataset.id, act = c.dataset.c;
      if (act === "toggle") { if (this.open.has(pid) && !c.classList.contains("cm-more") && (this.comments[pid] || []).length) this.open.delete(pid); else this.open.add(pid); this.draw(); const n = $(`[data-cin="${pid}"]`, this.el); if (n) n.focus(); }
      if (act === "reply") { this.open.add(pid); this.reply[pid] = c.dataset.name; this.draw(); const n = $(`[data-cin="${pid}"]`, this.el); if (n) n.focus(); }
      if (act === "unreply") { delete this.reply[pid]; this.draw(); }
      if (act === "send") this.sendComment(pid);
      if (act === "del" && await confirmBox("删除这条评论？", "", "删除", true)) {
        try { await api("wall_comment_delete", { cmid: +c.dataset.cid }); this.comments[pid] = (this.comments[pid] || []).filter((x) => x.id !== +c.dataset.cid); this.draw(); } catch (err) {}
      }
      return;
    }
    const b = e.target.closest("[data-w]"); if (!b) return;
    const id = +b.dataset.id, act = b.dataset.w, p = this.list().find((x) => x.id === id);
    try {
      if (act === "unfold") { this.unfold.add(id); this.draw(); return; }
      if (act === "goto") { this.filter = "all"; this.chan = ""; this.unfold.add(id); this.draw(); const n = $("#post-" + id, this.el); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      if (act === "report") return this.report(p);
      if (act === "edit") {
        const v = await formBox("编辑", [{ name: "t", label: "标题（留空就是普通消息）", value: p.title || "", max: 60 }, { name: "b", label: "内容", type: "textarea", rows: 6, value: p.body, max: 5000 }], "保存", { check: (o) => (!o.b ? "内容不能是空的" : "") });
        if (!v) return;
        await api("wall_edit", { pid: id, p_title: v.t, p_body: v.b });
      }
      if (act === "del") { if (!(await confirmBox("删除这条内容？", "删除后不能恢复。", "删除", true))) return; await api("wall_delete", { pid: id }); }
      if (act === "pin") await api("wall_pin", { pid: id, on_top: !(p && p.pinned_at) });
      if (act === "hide") { if (!(await confirmBox("隐藏这条？", "隐藏后全班都看不到，作者自己还能看到。", "隐藏", true))) return; await api("wall_moderate", { pid: id, action: "hide" }); }
      if (act === "unhide") await api("wall_moderate", { pid: id, action: "unhide" });
      if (act === "dismiss") await api("wall_moderate", { pid: id, action: "dismiss" });
      await this.load(true);
    } catch (err) {}
  },
  async report(p) {
    const reasons = ["骂人、人身攻击", "广告、刷屏", "不实信息", "色情低俗", "其他"];
    const v = await formBox("举报这条内容", [
      { name: "r", label: "原因", type: "select", value: reasons[0], options: reasons.map((x) => [x, x]) },
      { name: "n", label: "补充说明（可不填）", type: "textarea", rows: 2, max: 200 },
    ], "提交举报", { desc: `${p.author_name}：${(p.title || p.body).slice(0, 40)}　只有老师能看到是谁举报的。` });
    if (!v) return;
    try { await api("wall_report", { pid: p.id, p_reason: v.r + (v.n ? "：" + v.n : "") }); this.reported.add(String(p.id)); this.draw(); toast("已提交举报，老师会尽快处理"); } catch (e) {}
  },
};
