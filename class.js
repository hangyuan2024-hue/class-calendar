const { rest, rpc, esc, PERM_NAMES } = CCAuth;
const $ = (id) => document.getElementById(id);
let me = null, mine = [];

function toast(msg, err) {
  const t = $("toast"); t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ""), 2600);
}
async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); return true; } catch (e) { toast(e.message, true); return false; } finally { if (btn) btn.disabled = false; }
}
const fmt = (t) => t ? new Date(t).toLocaleDateString("zh-CN") : "";
const permList = (c) => Object.keys(PERM_NAMES).filter((k) => c[k]).map((k) => PERM_NAMES[k]);

async function load() {
  mine = await rpc("my_classes");
  await Promise.all(mine.filter((c) => c.is_teacher || c.status === "approved").map((c) => loadGroups(c.id)));
  // 组长、班委要从班级名单里选人拉进组
  await Promise.all(mine.filter((c) => !c.is_teacher && (groups[c.id] || []).some((g) => g.lead) || c.member_role === "monitor")
    .map(async (c) => { try { rosters[c.id] = await rpc("class_roster", { cid: c.id }); } catch (e) { /* 没有看名单的权限 */ } }));
  renderMine();
  if (me.role === "teacher" || me.role === "admin") await renderTeaching();
  if (location.hash === "#features" && !load._scrolled) { load._scrolled = true; const h = document.querySelector("[id^=feat_]"); if (h) h.scrollIntoView(); }
  if (me.role === "admin") renderAdmin().catch((e) => toast(e.message, true));
}

// ---------- 学生视角 ----------
function renderMine() {
  const list = mine.filter((c) => !c.is_teacher);
  $("myList").className = list.length ? "" : "empty";
  $("myList").innerHTML = list.length ? list.map((c) => {
    const pending = c.status === "pending";
    const mon = c.member_role === "monitor";
    return `<div class="item"><div class="grow">
        <div><strong>${esc(c.name)}</strong>
          ${pending ? `<span class="badge wait">等待老师批准</span>` : `<span class="badge ok">已入班</span>`}
          ${mon ? `<span class="badge mon">班委</span>` : ""}</div>
        <div class="meta">老师：${esc(c.teacher_name || "")}${mon ? " · 我的权限：" + (permList(c).join("、") || "暂无") : ""}</div>
        <div class="roster" id="roster_${esc(c.id)}"></div>
        ${pending ? "" : `<div class="gtitle">分组 <span class="meta">${mon ? "可以建组、调整组员、设组长" : "选你上的课 / 所在小组加入，组里的事项和消息只有组员能看到"}</span></div>${groupsHtml(c.id, mon, null)}`}</div>
      ${mon && c.can_view_members ? `<button class="small" data-act="roster" data-id="${esc(c.id)}">成员名单</button>` : ""}
      <button class="small danger" data-act="leave" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${pending ? "撤回申请" : "退出班级"}</button>
    </div>`;
  }).join("") : "还没有加入任何班级。";
}

$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  guard($("joinBtn"), async () => {
    const code = $("joinCode").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("班级码是 6 位字母或数字");
    const r = await rpc("join_class", { ccode: code });
    toast(r.status === "approved" ? `你已经在「${r.class_name}」里了` : `已申请加入「${r.class_name}」，等老师批准`);
    $("joinCode").value = "";
    await load();
  });
};

// ---------- 分组（老师、班委、组长、同学都用这一块）----------
const groups = {}, mce = {};
async function loadGroups(cid) { try { groups[cid] = await rpc("class_groups_get", { cid }); } catch (e) { groups[cid] = null; } }
// staff：老师 / 班委，能建组、删组、设组长；roster：本班名单（用来拉人进组）
function groupsHtml(cid, staff, roster) {
  const gs = groups[cid];
  if (gs === null) return `<div class="empty">分组功能还没装好，请管理员在扣子终端运行一次 setup_miniapp.py</div>`;
  if (!gs) return "";
  const pool = roster || rosters[cid] || [];
  const one = (g) => {
    const canMove = staff || g.lead;
    const add = canMove ? pool.filter((m) => m.status === "approved" && !g.members.some((x) => x.user_id === m.user_id)) : [];
    const d = `data-cid="${esc(cid)}" data-gid="${g.id}"`;
    return `<div class="grp">
      <div class="row"><strong>${esc(g.name)}</strong><span class="badge">${g.members.length} 人</span>
        ${g.lead ? `<span class="badge mon">我是组长</span>` : g.mine ? `<span class="badge ok">已加入</span>` : ""}
        ${g.note ? `<span class="meta">${esc(g.note)}</span>` : ""}<span class="spacer"></span>
        ${g.mine ? `<button class="small" data-act="g-leave" ${d} data-name="${esc(g.name)}">退出</button>` : staff && me.role !== "student" ? "" : `<button class="small primary" data-act="g-join" ${d}>加入</button>`}
        ${staff ? `<button class="small" data-act="g-edit" ${d} data-name="${esc(g.name)}" data-note="${esc(g.note || "")}">改名</button>
          <button class="small danger" data-act="g-del" ${d} data-name="${esc(g.name)}">删除</button>` : ""}</div>
      <div class="chips">${g.members.length ? g.members.map((m) => `<span class="chip${m.leader ? " lead" : ""}">${esc(m.name)}${m.leader ? "<b>组长</b>" : ""}
          ${staff ? `<button data-act="g-lead" ${d} data-uid="${esc(m.user_id)}" data-on="${m.leader ? "" : "1"}" title="${m.leader ? "取消组长" : "设为组长"}">${m.leader ? "取消组长" : "设组长"}</button>` : ""}
          ${staff || (g.lead && !m.leader) ? `<button data-act="g-kick" ${d} data-uid="${esc(m.user_id)}" data-name="${esc(m.name)}" title="移出本组">×</button>` : ""}</span>`).join("")
        : `<span class="meta">还没有人加入</span>`}
        ${add.length ? `<select data-gadd ${d}><option value="">＋ 拉同学进组</option>${add.map((m) => `<option value="${esc(m.user_id)}">${esc(m.name)}</option>`).join("")}</select>` : ""}</div>
    </div>`;
  };
  return `<div class="groups">${gs.length ? gs.map(one).join("") : `<div class="meta">还没有分组。</div>`}
    ${staff ? `<button class="small" data-act="g-new" data-cid="${esc(cid)}">＋ 新建分组</button>` : ""}</div>`;
}
document.addEventListener("change", (e) => {
  const s = e.target.closest("select[data-gadd]");
  if (s && s.value) guard(s, async () => {
    await rpc("class_group_member_set", { gid: +s.dataset.gid, uid: s.value, p_in: true, p_leader: false });
    toast("已加入分组"); await load();
  });
  const m = e.target.closest("input[data-mce]");
  if (m) guard(m, async () => {
    await rpc("class_set_members_can_edit", { cid: m.dataset.mce, p_on: m.checked });
    mce[m.dataset.mce] = m.checked;
    toast(m.checked ? "已打开：同学们都能添加、修改事项" : "已关闭：只有你、班委和组长能改事项");
  }).then((ok) => { if (!ok) m.checked = !m.checked; });
});

// ---------- 老师视角 ----------
const rosters = {}, classFeats = {};
async function renderTeaching() {
  const list = mine.filter((c) => c.is_teacher);
  const open = new Set([...document.querySelectorAll("details.cls[open]")].map((d) => d.dataset.id));
  if (!open.size && list.length === 1) open.add(list[0].id);
  for (const c of list) { try { rosters[c.id] = await rpc("class_roster", { cid: c.id }); } catch (e) { rosters[c.id] = []; } }
  for (const c of list) { try { classFeats[c.id] = await rpc("class_features_get", { cid: c.id }); } catch (e) { classFeats[c.id] = null; } }
  if (location.hash === "#features" && list.length) open.add(list[0].id);
  try { for (const x of await rest(`classes?select=id,members_can_edit&teacher_id=eq.${me.id}`)) mce[x.id] = !!x.members_can_edit; } catch (e) { /* 服务器还没更新 */ }
  $("teachList").innerHTML = list.length ? list.map((c) => {
    const r = rosters[c.id] || [];
    const pend = r.filter((m) => m.status === "pending"), ok = r.filter((m) => m.status === "approved");
    return `<details class="cls" data-id="${esc(c.id)}" ${open.has(c.id) ? "open" : ""}>
      <summary>${esc(c.name)} <span class="badge">${ok.length} 人</span>${pend.length ? `<span class="badge wait">${pend.length} 人待批准</span>` : ""}</summary>
      <div class="codebox"><span class="meta">班级码</span><span class="code">${esc(c.code)}</span>
        <button class="small" data-act="copy" data-code="${esc(c.code)}" data-name="${esc(c.name)}">复制邀请语</button>
        <button class="small" data-act="regen" data-id="${esc(c.id)}">重置班级码</button>
        <button class="small" data-act="rename" data-id="${esc(c.id)}" data-name="${esc(c.name)}">改名</button></div>
      ${pend.length ? `<h3>待批准</h3>` + pend.map((m) => `<div class="item"><div class="grow">${esc(m.name)} <span class="meta">${esc(m.account)} · ${fmt(m.joined_at)} 申请</span></div>
          <button class="small primary" data-act="approve" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}">批准</button>
          <button class="small danger" data-act="reject" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}">拒绝</button></div>`).join("") : ""}
      <h3>成员</h3>
      ${ok.length ? ok.map((m) => `<div class="item" data-cid="${esc(c.id)}" data-uid="${esc(m.user_id)}"><div class="grow"><a class="ulink" href="index.html#u=${esc(m.user_id)}&c=${esc(c.id)}" title="打开 TA 的个人主页">${esc(m.name)}</a> <span class="meta">${esc(m.account)}</span></div>
          <select data-act="role"><option value="student" ${m.member_role === "student" ? "selected" : ""}>学生</option>
            <option value="monitor" ${m.member_role === "monitor" ? "selected" : ""}>班委</option></select>
          <span class="perms ${m.member_role === "monitor" ? "" : "hidden"}">${Object.entries(PERM_NAMES).map(([k, v]) =>
            `<label><input type="checkbox" data-perm="${k}" ${m[k] ? "checked" : ""}> ${v}</label>`).join("")}</span>
          <button class="small danger" data-act="remove" data-name="${esc(m.name)}">移出</button></div>`).join("")
        : `<div class="empty">还没有成员。把班级码发到班群里吧。</div>`}
      <h3>分组 <span class="meta" style="font-weight:400">班里再分组，比如「高数 5 班」「第 3 小组」。发给某个组的事项和班级墙消息，只有组员（和你、班委）能看到。</span></h3>
      ${groupsHtml(c.id, true, r)}
      ${c.id in mce ? `<label class="mce"><input type="checkbox" data-mce="${esc(c.id)}" ${mce[c.id] ? "checked" : ""}> 全班同学都能添加、修改事项 <span class="meta">（每次修改都会记下是谁改的，只能删自己加的）</span></label>` : ""}
      <h3 id="feat_${esc(c.id)}">功能开关 <span class="meta" style="font-weight:400">本班学生、班委能用哪些功能，改完对方刷新页面就生效。你自己不受影响。</span></h3>
      ${featTable(c.id)}
    </details>`;
  }).join("") : `<div class="empty" style="margin-top:10px">还没有班级，先创建一个。</div>`;
}

function featTable(cid) {
  const fs = classFeats[cid];
  if (!fs) return `<div class="empty">功能开关还没装好，请管理员在扣子终端运行一次 setupaccounts.py</div>`;
  return `<div style="overflow-x:auto"><table class="feat" data-cid="${esc(cid)}"><thead><tr><th>功能</th><th>学生</th><th>班委</th></tr></thead><tbody>
    ${fs.map((f) => `<tr data-key="${esc(f.key)}"><td><b>${esc(f.name)}</b>${f.site_on ? "" : `<span class="badge wait">全站已暂停${f.site_note ? "：" + esc(f.site_note) : ""}</span>`}
        <div class="meta">${esc(f.descr)}</div></td>
      <td>${f.student_ok ? `<input type="checkbox" data-who="student" ${f.student ? "checked" : ""} aria-label="学生可用">${f.site_off_student ? `<div class="meta">管理员已对学生关闭</div>` : ""}` : `<span class="meta">—</span>`}</td>
      <td><input type="checkbox" data-who="monitor" ${f.monitor ? "checked" : ""} aria-label="班委可用"></td></tr>`).join("")}
  </tbody></table></div>`;
}
document.addEventListener("change", (e) => {
  const c = e.target.closest("table.feat input[data-who]"); if (!c) return;
  const row = c.closest("tr"), cid = c.closest("table").dataset.cid, f = (classFeats[cid] || []).find((x) => x.key === row.dataset.key);
  const stu = row.querySelector('[data-who="student"]'), mon = row.querySelector('[data-who="monitor"]');
  guard(c, async () => {
    await rpc("class_set_feature", { cid, k: row.dataset.key, stu: stu ? stu.checked : null, mon: mon.checked });
    if (f) { f.student = stu ? stu.checked : null; f.monitor = mon.checked; }
    toast(`「${f ? f.name : row.dataset.key}」：学生${stu ? (stu.checked ? "可用" : "关闭") : "—"}，班委${mon.checked ? "可用" : "关闭"}`);
  }).then((ok) => { if (!ok) { c.checked = !c.checked; } });
});

$("createForm").onsubmit = (e) => {
  e.preventDefault();
  guard($("createBtn"), async () => {
    const r = await rpc("create_class", { cname: $("newName").value });
    $("newName").value = ""; toast(`已创建，班级码 ${r.code}`);
    await load();
    const d = document.querySelector(`details.cls[data-id="${r.id}"]`); if (d) d.open = true;
  });
};

async function saveMember(row) {
  const role = row.querySelector("select[data-act=role]").value;
  const p = (k) => !!(row.querySelector(`input[data-perm=${k}]`) || {}).checked;
  row.querySelector(".perms").classList.toggle("hidden", role !== "monitor");
  const ok = await guard(null, () => rpc("set_member", { cid: row.dataset.cid, uid: row.dataset.uid, mrole: role,
    p_ingest: p("can_ingest"), p_edit: p("can_edit"), p_delete: p("can_delete"), p_view: p("can_view_members") }));
  if (ok) toast(role === "monitor" ? "班委权限已更新" : "已设为普通学生"); else await load();
}
$("teachList").addEventListener("change", (e) => {
  const row = e.target.closest(".item[data-uid]"); if (!row) return;
  if (e.target.matches("select[data-act=role]") && e.target.value === "monitor" && !row.querySelector("input[data-perm]:checked")) {
    // 新任命的班委默认开「增改事项」
    row.querySelector("input[data-perm=can_edit]").checked = true;
  }
  saveMember(row);
});

// ---------- 管理员 ----------
async function renderAdmin() {
  const cls = await rest("classes?select=id,name,code,teacher_id,created_at&order=created_at.asc");
  const ppl = await rest("profiles?select=id,account,display_name");
  const name = (id) => { const p = ppl.find((x) => x.id === id); return p ? `${p.display_name}（${p.account}）` : "未知"; };
  $("adminList").className = cls.length ? "" : "empty";
  $("adminList").innerHTML = cls.length ? cls.map((c) => `<div class="item"><div class="grow"><strong>${esc(c.name)}</strong>
      <div class="meta">老师 ${esc(name(c.teacher_id))} · 班级码 ${esc(c.code)} · 创建于 ${fmt(c.created_at)}</div></div>
      <button class="small" data-act="transfer" data-id="${esc(c.id)}">转交老师</button></div>`).join("") : "还没有班级。";
}

// ---------- 按钮 ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "copy") {
    const text = `请用捞捞课程表加入「${b.dataset.name}」：打开 ${location.origin}${location.pathname.replace(/[^/]*$/, "")}login.html 注册（选“学生”，填真实姓名），然后在「我的班级」输入班级码 ${b.dataset.code} 申请加入。`;
    navigator.clipboard.writeText(text).then(() => toast("已复制，发到班群即可"), () => prompt("复制下面这段发到班群：", text));
    return;
  }
  guard(b, async () => {
    if (act === "leave") { if (!confirm(`确定退出「${b.dataset.name}」？`)) return;
      await rest(`class_members?class_id=eq.${b.dataset.id}&user_id=eq.${me.id}`, { method: "DELETE" }); toast("已退出"); }
    if (act === "roster") {
      const box = $("roster_" + b.dataset.id);
      if (box.innerHTML) { box.innerHTML = ""; return; }
      const r = await rpc("class_roster", { cid: b.dataset.id });
      box.innerHTML = `<div class="meta" style="margin-top:6px">${r.map((m) => esc(m.name) + (m.member_role === "monitor" ? "（班委）" : "")).join("、")}</div>`;
      return;
    }
    if (act === "regen") { if (!confirm("重置后旧班级码立即失效，已入班的同学不受影响。继续？")) return;
      await rpc("regenerate_class_code", { cid: b.dataset.id }); toast("班级码已重置"); }
    if (act === "rename") { const n = prompt("新的班级名称：", b.dataset.name); if (!n || !n.trim()) return;
      const r = await rest(`classes?id=eq.${b.dataset.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: n.trim().slice(0, 40) }) });
      if (!r || !r.length) throw new Error("没有权限修改"); toast("已改名"); }
    if (act === "approve") { await rpc("review_member", { cid: b.dataset.cid, uid: b.dataset.uid, approve: true }); toast("已批准"); }
    if (act === "reject") { if (!confirm("拒绝这个申请？")) return;
      await rpc("review_member", { cid: b.dataset.cid, uid: b.dataset.uid, approve: false }); toast("已拒绝"); }
    if (act === "remove") { const row = b.closest(".item"); if (!confirm(`把 ${b.dataset.name} 移出班级？`)) return;
      await rest(`class_members?class_id=eq.${row.dataset.cid}&user_id=eq.${row.dataset.uid}`, { method: "DELETE" }); toast("已移出"); }
    if (act === "g-new" || act === "g-edit") {
      const n = prompt(act === "g-new" ? "分组名称（比如 高数5班、大物2班、第3小组）：" : "新的组名：", b.dataset.name || ""); if (!n || !n.trim()) return;
      const note = prompt("说明（可不填，比如 上课时间、老师）：", b.dataset.note || ""); if (note === null) return;
      await rpc("class_group_save", { cid: b.dataset.cid, gid: b.dataset.gid ? +b.dataset.gid : null, p_name: n.trim(), p_note: note.trim() });
      toast(act === "g-new" ? "分组已建好，同学们可以在「我的班级」里自己加入" : "已改名"); }
    if (act === "g-del") { if (!confirm(`删除分组「${b.dataset.name}」？发给这个组的事项和班级墙消息也会一起删除。`)) return;
      await rpc("class_group_delete", { gid: +b.dataset.gid }); toast("已删除"); }
    if (act === "g-join") { await rpc("class_group_join", { gid: +b.dataset.gid }); toast("已加入，组里的事项和消息会出现在你的日历和班级墙"); }
    if (act === "g-leave") { if (!confirm(`退出「${b.dataset.name}」？之后就看不到这个组的事项和消息了。`)) return;
      await rpc("class_group_leave", { gid: +b.dataset.gid }); toast("已退出"); }
    if (act === "g-lead") { await rpc("class_group_member_set", { gid: +b.dataset.gid, uid: b.dataset.uid, p_in: true, p_leader: !!b.dataset.on });
      toast(b.dataset.on ? "已设为组长" : "已取消组长"); }
    if (act === "g-kick") { if (!confirm(`把 ${b.dataset.name} 移出这个组？`)) return;
      await rpc("class_group_member_set", { gid: +b.dataset.gid, uid: b.dataset.uid, p_in: false, p_leader: false }); toast("已移出"); }
    if (act === "transfer") { const acct = prompt("转交给哪个老师账号？（对方需要先注册为老师）"); if (!acct) return;
      await rpc("transfer_class", { cid: b.dataset.id, acct: acct.trim() }); toast("已转交"); }
    await load();
  });
});

$("logout").onclick = async () => { await CCAuth.signOut(); location.href = "login.html"; };
(async () => {
  const s = await CCAuth.session();
  if (!s) { location.href = "login.html?next=class.html"; return; }
  me = await CCAuth.me();
  if (!me) { await CCAuth.signOut(); location.href = "login.html?next=class.html"; return; }
  $("who").textContent = `${me.display_name}（${CCAuth.ROLE_NAMES[me.role] || me.role}）`;
  const teacher = me.role === "teacher" || me.role === "admin";
  $("teachCard").classList.toggle("hidden", !teacher);
  $("adminCard").classList.toggle("hidden", me.role !== "admin");
  $("devLink").classList.toggle("hidden", !(me.perms && me.perms.length));
  if (me.role === "teacher") { $("joinCard").classList.add("hidden"); $("myCard").classList.add("hidden"); }
  try { await load(); } catch (e) { toast(e.message, true); }
})();
