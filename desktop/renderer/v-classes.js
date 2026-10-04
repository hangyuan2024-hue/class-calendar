// 班级：加入班级（一个人可以加入好几个班）、退出；分组（高数5班、第3小组……）加入和退出；
// 老师：创建班级、班级码、批准入班、设班委和权限、移出、分组和组长、「全班都能维护事项」、功能开关、班级起名
"use strict";
const PERM_NAMES = { can_ingest: "AI 整理", can_edit: "增改事项", can_delete: "删除事项", can_view_members: "看成员名单" };
const NICK_A = ["星河", "元气", "追光", "代码", "晨曦", "破晓", "极客", "向阳", "逐梦", "萤火", "满格", "满分", "不熬夜", "早八", "像素", "电波", "宇宙", "捞捞", "奔跑", "银河"];
const NICK_B = ["小分队", "联盟", "研究所", "工作室", "战队", "俱乐部", "梦之队", "号", "补给站", "实验室", "特攻队", "大家庭"];
const MOTTOS = ["今日事，今日毕", "早八不迟到，作业不拖延", "一起把日子过成想要的样子", "代码写得好，bug 跑不了", "不负韶华，不负自己", "每一个 ddl 都会被我们温柔地拿下", "团结 · 认真 · 有趣", "向光而行，一起发光", "群消息不漏，作业不丢"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
App.views.classes = {
  title: "班级", icon: "classes", mine: null, groups: {}, rosters: {}, feats: {}, mce: {}, open: new Set(),
  count() { const n = (App.S.classes || []).filter((c) => c.status === "pending").length; return { n }; },
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>班级</h1><div class="sub">一个人可以加入好几个班（比如自己的行政班、高数5班、大物2班），在左下角切换</div></div><span class="grow"></span><button class="btn" id="clRe">${icon("sync")}刷新</button></div>
      <div class="vbody"><div class="cl-wrap" id="clBox"></div></div>`;
    $("#clRe", el).onclick = () => this.load().then(() => toast("已刷新"));
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("change", (e) => this.change(e));
    el.addEventListener("submit", (e) => this.submit(e));
    el.addEventListener("toggle", (e) => { const d = e.target; if (d.matches && d.matches("details.cl-t")) { if (d.open) this.open.add(d.dataset.id); else this.open.delete(d.dataset.id); } }, true);
  },
  show() { this.load(); },
  update() { if (!this.mine) return; this.draw(); },
  async load() {
    try {
      this.mine = await api("my_classes", {}, true);
      const ok = this.mine.filter((c) => c.is_teacher || c.status === "approved");
      await Promise.all(ok.map(async (c) => { try { this.groups[c.id] = await api("class_groups_get", { cid: c.id }, true); } catch (e) { this.groups[c.id] = notFound(e) ? null : []; } }));
      const teach = this.mine.filter((c) => c.is_teacher);
      const staffish = this.mine.filter((c) => c.is_teacher || c.member_role === "monitor" || (this.groups[c.id] || []).some((g) => g.lead));
      await Promise.all(staffish.map(async (c) => { try { this.rosters[c.id] = await api("class_roster", { cid: c.id }, true); } catch (e) { this.rosters[c.id] = null; } }));
      await Promise.all(teach.map(async (c) => { try { this.feats[c.id] = await api("class_features_get", { cid: c.id }, true); } catch (e) { this.feats[c.id] = null; } }));
      if (teach.length && App.S.me) { try { for (const x of await apiGet(`classes?select=id,members_can_edit&teacher_id=eq.${App.S.me.id}`)) this.mce[x.id] = !!x.members_can_edit; } catch (e) { /* 服务器还没更新 */ } }
      if (teach.length && !this.opened) { this.opened = true; this.open.add((teach.find((c) => c.id === App.S.cid) || teach[0]).id); }
    } catch (e) { $("#clBox", this.el).innerHTML = `<div class="empty">加载失败：${esc(cleanErr(e))}</div>`; return; }
    this.draw();
  },
  teacherRole() { const r = App.S.me && App.S.me.role; return r === "teacher" || r === "admin"; },
  draw() {
    const box = $("#clBox", this.el); if (!this.mine) { box.innerHTML = `<div class="empty">加载中…</div>`; return; }
    const joined = this.mine.filter((c) => !c.is_teacher), teach = this.mine.filter((c) => c.is_teacher);
    const joinCard = `<div class="card cl-join"><div class="card-h">加入班级</div><form class="row" data-f="join" style="padding:0 16px 14px"><input class="input cl-code" name="code" maxlength="6" placeholder="6 位班级码，如 K7M2QX" spellcheck="false" autocomplete="off"><button class="btn primary">申请加入</button><span class="muted" id="clLook"></span></form></div>`;
    const joinedSec = `<div class="sec-h"><b>我加入的班级</b><span>${joined.length} 个</span></div>
      ${joined.length ? joined.map((c) => this.joinedHtml(c)).join("") : `<div class="card empty">还没有加入班级。向老师要 6 位班级码，填在上面。</div>`}`;
    const isT = this.teacherRole() || teach.length;
    const teachSec = isT ? `<div class="sec-h"><b>我管理的班级</b><span>${teach.length} 个 · 每个班单独管理、单独发通知</span></div>
        ${teach.map((c) => this.teachHtml(c)).join("")}
        <div class="card cl-new"><form class="row" data-f="create" style="padding:14px 16px"><input class="input" name="name" maxlength="40" placeholder="${teach.length ? "再建一个班，" : ""}新班级名称，如 计科2501、高数5班" style="flex:1"><button class="btn primary">${icon("plus")}创建班级</button></form></div>` : "";
    // 老师：先看自己管理的班；没加入别人的班就不显示「我加入的班级」，加入框放到最后
    box.innerHTML = isT ? teachSec + (joined.length ? joinedSec : "") + `<div class="sec-h"><b>加入别的班</b><span>比如你也在别的老师的班里</span></div>` + joinCard
      : joinCard + joinedSec;
    this.lookup();
  },
  // 输入班级码时先查一下是哪个班
  lookup() {
    const f = $('[data-f="join"]', this.el); if (!f) return;
    const inp = f.code, tip = $("#clLook", this.el); let t = 0;
    inp.oninput = () => {
      inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      clearTimeout(t); tip.textContent = "";
      if (inp.value.length !== 6) return;
      t = setTimeout(async () => { try { const r = await api("class_lookup", { ccode: inp.value }, true); tip.textContent = r && r.name ? `「${r.name}」${r.teacher ? " · " + r.teacher + (/老师$/.test(r.teacher) ? "" : "老师") : ""} · ${r.members} 人${r.my_status === "approved" ? " · 你已经在班里了" : r.my_status === "pending" ? " · 已申请，等批准" : ""}` : "没有这个班级码"; } catch (e) { tip.textContent = ""; } }, 300);
    };
  },
  joinedHtml(c) {
    const pending = c.status === "pending", mon = c.member_role === "monitor", perms = Object.keys(PERM_NAMES).filter((k) => c[k]).map((k) => PERM_NAMES[k]);
    const cur = c.id === App.S.cid;
    return `<div class="card cl-item"><div class="cl-h"><div><b>${esc(c.name)}</b>${c.nickname ? `<span class="muted">「${esc(c.nickname)}」</span>` : ""}
        ${pending ? `<span class="tag" style="--c:var(--warn)">等待老师批准</span>` : `<span class="tag" style="--c:var(--ok)">已入班</span>`}${mon ? `<span class="tag" style="--c:var(--brand)">班委</span>` : ""}${cur ? `<span class="tag">当前</span>` : ""}
        <div class="muted">老师：${esc(c.teacher_name || "")}${mon ? " · 我的权限：" + (perms.join("、") || "暂无") : ""}</div></div><span class="grow"></span>
        ${!pending && !cur ? `<button class="btn sm" data-a="switch" data-id="${esc(c.id)}">切换到这个班</button>` : ""}
        ${!pending && (mon && c.can_edit) ? `<button class="btn sm" data-a="name" data-id="${esc(c.id)}">✨ 班级起名</button>` : ""}
        <button class="btn sm danger" data-a="leave" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${pending ? "撤回申请" : "退出班级"}</button></div>
      ${!pending && mon && c.can_view_members && this.rosters[c.id] ? `<details class="cl-ros"><summary>成员名单（${this.rosters[c.id].filter((m) => m.status === "approved").length} 人）</summary><div class="muted">${this.rosters[c.id].filter((m) => m.status === "approved").map((m) => esc(m.name) + (m.member_role === "monitor" ? "（班委）" : "")).join("、")}</div></details>` : ""}
      ${pending ? "" : `<div class="cl-gt">分组 <span class="muted">${mon ? "可以建组、调整组员、设组长" : "选你上的课 / 所在小组加入，组里的事项和消息只有组员能看到"}</span></div>${this.groupsHtml(c.id, mon)}`}</div>`;
  },
  teachHtml(c) {
    const r = this.rosters[c.id] || [], pend = r.filter((m) => m.status === "pending"), ok = r.filter((m) => m.status === "approved");
    const fs = this.feats[c.id];
    return `<details class="card cl-t" data-id="${esc(c.id)}"${this.open.has(c.id) ? " open" : ""}><summary><b>${esc(c.name)}</b>${c.nickname ? `<span class="muted">「${esc(c.nickname)}」</span>` : ""}<span class="tag">${ok.length} 人</span>${pend.length ? `<span class="tag" style="--c:var(--warn)">${pend.length} 人待批准</span>` : ""}${c.id === App.S.cid ? `<span class="tag" style="--c:var(--brand)">当前</span>` : ""}</summary>
      <div class="cl-code-box"><span class="muted">班级码</span><b class="mono">${esc(c.code || "")}</b>
        <button class="btn sm" data-a="copy" data-code="${esc(c.code || "")}" data-name="${esc(c.name)}">复制邀请语</button><button class="btn sm" data-a="regen" data-id="${esc(c.id)}">重置班级码</button>
        <button class="btn sm" data-a="name" data-id="${esc(c.id)}">✏️ 改名 / 起昵称</button><button class="btn sm" data-a="transfer" data-id="${esc(c.id)}" data-name="${esc(c.name)}">转交给别的老师</button>
        ${c.id !== App.S.cid ? `<button class="btn sm primary" data-a="switch" data-id="${esc(c.id)}">切换到这个班</button>` : ""}</div>
      ${pend.length ? `<h4>待批准</h4>${pend.map((m) => `<div class="cl-m"><b>${esc(m.name)}</b><span class="muted">${esc(m.account)} · ${m.joined_at ? new Date(m.joined_at).toLocaleDateString("zh-CN") : ""} 申请</span><span class="grow"></span>
          <button class="btn sm primary" data-a="approve" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}">批准</button><button class="btn sm danger" data-a="reject" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}">拒绝</button></div>`).join("")}` : ""}
      <h4>成员</h4>
      ${ok.length ? ok.map((m) => `<div class="cl-m" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}"><b class="ulink" data-user="${esc(m.user_id)}">${esc(m.name)}</b><span class="muted">${esc(m.account)}</span><span class="grow"></span>
          <select class="input sm" data-role><option value="student"${m.member_role === "student" ? " selected" : ""}>学生</option><option value="monitor"${m.member_role === "monitor" ? " selected" : ""}>班委</option></select>
          <span class="cl-perms${m.member_role === "monitor" ? "" : " hidden"}">${Object.entries(PERM_NAMES).map(([k, v]) => `<label><input type="checkbox" data-perm="${k}"${m[k] ? " checked" : ""}> ${v}</label>`).join("")}</span>
          <button class="btn ghost sm danger" data-a="remove" data-name="${esc(m.name)}">移出</button></div>`).join("") : `<div class="muted" style="padding:6px 0">还没有成员。把班级码发到班群里吧。</div>`}
      <h4>分组 <span class="muted">班里再分组，比如「高数 5 班」「第 3 小组」。发给某个组的事项和班级墙消息，只有组员（和你、班委）能看到。</span></h4>
      ${this.groupsHtml(c.id, true)}
      ${c.id in this.mce ? `<label class="cl-mce"><button class="switch${this.mce[c.id] ? " on" : ""}" data-mce="${esc(c.id)}"></button>全班同学都能添加、修改事项 <span class="muted">（每次修改都会记下是谁改的，同学只能删自己加的）</span></label>` : ""}
      <h4>功能开关 <span class="muted">本班学生、班委能用哪些功能，改完对方刷新就生效。你自己不受影响。</span></h4>
      ${fs ? `<table class="cl-feat" data-cid="${esc(c.id)}"><thead><tr><th>功能</th><th>学生</th><th>班委</th></tr></thead><tbody>${fs.map((f) => `<tr data-key="${esc(f.key)}"><td><b>${esc(f.name)}</b>${f.site_on ? "" : `<span class="tag" style="--c:var(--warn)">全站已暂停${f.site_note ? "：" + esc(f.site_note) : ""}</span>`}<div class="muted">${esc(f.descr || "")}</div></td>
          <td>${f.student_ok ? `<input type="checkbox" data-who="student"${f.student ? " checked" : ""}>${f.site_off_student ? `<div class="muted">管理员已对学生关闭</div>` : ""}` : `<span class="muted">—</span>`}</td><td><input type="checkbox" data-who="monitor"${f.monitor ? " checked" : ""}></td></tr>`).join("")}</tbody></table>`
        : `<div class="muted">功能开关还没装好（管理员需要在扣子终端运行一次 setupaccounts.py）</div>`}
    </details>`;
  },
  groupsHtml(cid, staff) {
    const gs = this.groups[cid];
    if (gs === null) return `<div class="muted cl-gn">分组功能还没装好，请管理员在扣子终端运行一次 setup_miniapp.py</div>`;
    if (!gs) return "";
    const pool = (this.rosters[cid] || []).filter((m) => m.status === "approved"), teacher = this.mine.find((c) => c.id === cid && c.is_teacher);
    return `<div class="cl-groups">${gs.map((g) => {
      const canMove = staff || g.lead, add = canMove ? pool.filter((m) => !(g.members || []).some((x) => x.user_id === m.user_id)) : [];
      const d = `data-cid="${esc(cid)}" data-gid="${g.id}"`;
      return `<div class="cl-g"><div class="row"><b>${esc(g.name)}</b><span class="tag">${(g.members || []).length} 人</span>${g.lead ? `<span class="tag" style="--c:var(--brand)">我是组长</span>` : g.mine ? `<span class="tag" style="--c:var(--ok)">已加入</span>` : ""}${g.note ? `<span class="muted">${esc(g.note)}</span>` : ""}<span class="grow"></span>
          ${g.mine ? `<button class="btn sm" data-a="g-leave" ${d} data-name="${esc(g.name)}">退出</button>` : teacher ? "" : `<button class="btn sm primary" data-a="g-join" ${d}>加入</button>`}
          ${staff ? `<button class="btn sm" data-a="g-edit" ${d} data-name="${esc(g.name)}" data-note="${esc(g.note || "")}">改名</button><button class="btn sm danger" data-a="g-del" ${d} data-name="${esc(g.name)}">删除</button>` : ""}</div>
        <div class="cl-chips">${(g.members || []).map((m) => `<span class="chip${m.leader ? " lead" : ""}">${esc(m.name)}${m.leader ? "<b>组长</b>" : ""}
            ${staff ? `<a data-a="g-lead" ${d} data-uid="${esc(m.user_id)}" data-on="${m.leader ? "" : "1"}">${m.leader ? "取消组长" : "设组长"}</a>` : ""}${staff || (g.lead && !m.leader) ? `<a data-a="g-kick" ${d} data-uid="${esc(m.user_id)}" data-name="${esc(m.name)}" title="移出本组">✕</a>` : ""}</span>`).join("") || `<span class="muted">还没有人加入</span>`}
          ${add.length ? `<select class="input sm" data-gadd ${d}><option value="">＋ 拉同学进组</option>${add.map((m) => `<option value="${esc(m.user_id)}">${esc(m.name)}</option>`).join("")}</select>` : ""}</div></div>`;
    }).join("") || `<div class="muted">还没有分组。</div>`}
      ${staff ? `<button class="btn sm" data-a="g-new" data-cid="${esc(cid)}">${icon("plus")}新建分组</button>` : ""}</div>`;
  },
  async submit(e) {
    const f = e.target.closest("form[data-f]"); if (!f) return;
    e.preventDefault();
    try {
      if (f.dataset.f === "join") {
        const code = f.code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return toast("班级码是 6 位字母或数字", { bad: true });
        const r = await api("join_class", { ccode: code });
        toast(r.status === "approved" ? `你已经在「${r.class_name}」里了` : `已申请加入「${r.class_name}」，等老师批准`);
      }
      if (f.dataset.f === "create") {
        const name = f.name.value.trim(); if (!name) return f.name.focus();
        const r = await api("create_class", { cname: name });
        this.open.add(r.id); toast(`已创建，班级码 ${r.code}`);
      }
      await this.load(); call("refresh");
    } catch (err) {}
  },
  async change(e) {
    const t = e.target;
    const ga = t.closest("select[data-gadd]");
    if (ga && ga.value) { try { await api("class_group_member_set", { gid: +ga.dataset.gid, uid: ga.value, p_in: true, p_leader: false }); toast("已加入分组"); await this.load(); call("class:reload"); } catch (err) {} return; }
    const fe = t.closest("table.cl-feat input[data-who]");
    if (fe) {
      const row = fe.closest("tr"), cid = fe.closest("table").dataset.cid, stu = row.querySelector('[data-who="student"]'), mon = row.querySelector('[data-who="monitor"]');
      try { await api("class_set_feature", { cid, k: row.dataset.key, stu: stu ? stu.checked : null, mon: mon.checked }); toast("已保存"); } catch (err) { fe.checked = !fe.checked; }
      return;
    }
    const row = t.closest(".cl-m[data-uid]");
    if (row && (t.matches("[data-role]") || t.matches("[data-perm]"))) {
      const role = row.querySelector("[data-role]").value, p = (k) => !!(row.querySelector(`[data-perm=${k}]`) || {}).checked;
      if (t.matches("[data-role]") && role === "monitor" && !row.querySelector("[data-perm]:checked")) row.querySelector("[data-perm=can_edit]").checked = true;   // 新任命的班委默认开「增改事项」
      row.querySelector(".cl-perms").classList.toggle("hidden", role !== "monitor");
      try { await api("set_member", { cid: row.dataset.cid, uid: row.dataset.uid, mrole: role, p_ingest: p("can_ingest"), p_edit: p("can_edit"), p_delete: p("can_delete"), p_view: p("can_view_members") }); toast(role === "monitor" ? "班委权限已更新" : "已设为普通学生"); }
      catch (err) { this.load(); }
    }
  },
  async click(e) {
    const u = e.target.closest("[data-user]"); if (u && u.dataset.user) { App.go("people", { uid: u.dataset.user }); return; }
    const sw = e.target.closest("[data-mce]");
    if (sw) {
      const cid = sw.dataset.mce, on = !sw.classList.contains("on");
      try { await api("class_set_members_can_edit", { cid, p_on: on }); this.mce[cid] = on; sw.classList.toggle("on", on); toast(on ? "已打开：同学们都能添加、修改事项" : "已关闭：只有你、班委和组长能改事项"); call("class:reload"); } catch (err) {}
      return;
    }
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, d = b.dataset;
    try {
      if (a === "switch") { await call("class:switch", d.id); toast("已切换"); return; }
      if (a === "copy") { const text = `请用捞捞课程表加入「${d.name}」：打开 https://www.laolaokechengbiao.cn/ 注册（选“学生”，填真实姓名），然后在「我的班级」输入班级码 ${d.code} 申请加入。电脑版在「班级」里输入班级码。`; await navigator.clipboard.writeText(text); toast("已复制，发到班群即可"); return; }
      if (a === "leave") { if (!(await confirmBox(`退出「${d.name}」？`, "退出后就看不到这个班的事项和班级墙了，以后可以用班级码重新申请。", "退出", true))) return; await window.cc.call("api:del", `class_members?class_id=eq.${d.id}&user_id=eq.${App.S.me.id}`); toast("已退出"); }
      if (a === "regen") { if (!(await confirmBox("重置班级码？", "重置后旧班级码立即失效，已入班的同学不受影响。", "重置"))) return; await api("regenerate_class_code", { cid: d.id }); toast("班级码已重置"); }
      if (a === "name") { await this.nameClass(d.id); }
      if (a === "transfer") { const v = await formBox(`把「${d.name}」转交给别的老师`, [{ name: "acct", label: "对方的账号（对方需要先注册为老师）", max: 40 }], "转交", { danger: true, check: (o) => (!o.acct ? "请填写账号" : "") }); if (!v) return; await api("transfer_class", { cid: d.id, acct: v.acct }); toast("已转交"); }
      if (a === "approve") { await api("review_member", { cid: d.cid, uid: d.uid, approve: true }); toast("已批准"); }
      if (a === "reject") { if (!(await confirmBox("拒绝这个申请？", "", "拒绝", true))) return; await api("review_member", { cid: d.cid, uid: d.uid, approve: false }); toast("已拒绝"); }
      if (a === "remove") { const row = b.closest(".cl-m"); if (!(await confirmBox(`把 ${d.name} 移出班级？`, "", "移出", true))) return; await window.cc.call("api:del", `class_members?class_id=eq.${row.dataset.cid}&user_id=eq.${row.dataset.uid}`); toast("已移出"); }
      if (a === "g-new" || a === "g-edit") {
        const v = await formBox(a === "g-new" ? "新建分组" : "修改分组", [{ name: "name", label: "分组名称", value: d.name || "", placeholder: "比如 高数5班、大物2班、第3小组", max: 30 }, { name: "note", label: "说明（可不填）", value: d.note || "", placeholder: "上课时间、老师……", max: 100 }], "保存", { check: (o) => (!o.name ? "请填写组名" : "") });
        if (!v) return;
        await api("class_group_save", { cid: d.cid, gid: d.gid ? +d.gid : null, p_name: v.name, p_note: v.note });
        toast(a === "g-new" ? "分组已建好，同学们可以在电脑版或网页的「班级」里自己加入" : "已改名");
      }
      if (a === "g-del") { if (!(await confirmBox(`删除分组「${d.name}」？`, "发给这个组的事项和班级墙消息也会一起删除。", "删除", true))) return; await api("class_group_delete", { gid: +d.gid }); toast("已删除"); }
      if (a === "g-join") { await api("class_group_join", { gid: +d.gid }); toast("已加入，组里的事项和消息会出现在你的日历和班级墙"); }
      if (a === "g-leave") { if (!(await confirmBox(`退出「${d.name}」？`, "之后就看不到这个组的事项和消息了。", "退出", true))) return; await api("class_group_leave", { gid: +d.gid }); toast("已退出"); }
      if (a === "g-lead") { await api("class_group_member_set", { gid: +d.gid, uid: d.uid, p_in: true, p_leader: !!d.on }); toast(d.on ? "已设为组长" : "已取消组长"); }
      if (a === "g-kick") { if (!(await confirmBox(`把 ${d.name} 移出这个组？`, "", "移出", true))) return; await api("class_group_member_set", { gid: +d.gid, uid: d.uid, p_in: false, p_leader: false }); toast("已移出"); }
      await this.load(); call("refresh");
    } catch (err) {}
  },
  // 班级起名：班级名字（老师）、昵称、口号
  async nameClass(cid) {
    const c = this.mine.find((x) => x.id === cid) || App.cls(); if (!c) return;
    const mgr = c.is_teacher || App.isAdmin();
    const fields = [{ name: "nick", label: "班级昵称（可不填）", value: c.nickname || "", max: 20, hint: "比如「" + pick(NICK_A) + pick(NICK_B) + "」" }, { name: "mot", label: "班级口号（可不填）", value: c.motto || "", max: 40, hint: "比如「" + pick(MOTTOS) + "」" }];
    if (mgr) fields.unshift({ name: "cname", label: "班级名称", value: c.name, max: 40 });
    const v = await formBox("给班级起名字", fields, "保存", { desc: mgr ? "" : "班级正式名称只有老师能改" });
    if (!v) return;
    const r = await api("set_class_identity", { cid, cname: mgr ? v.cname : "", nick: v.nick, mot: v.mot });
    toast(`已保存：${r.name}${r.nickname ? "「" + r.nickname + "」" : ""}`);
  },
};
