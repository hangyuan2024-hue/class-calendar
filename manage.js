// 7.37 管理中心（网站）：左边一张干净的列表（站长后台 / 学校 / 院系 / 我的班级），右边是选中那一项的详情
//   学校、院系：管理（码、院系或班级、管理员、邀请）· 统计 · 作业审核 · 作息 · 功能（面板来自 school.js）
//   班级：班级码、属于哪个院系（没加入的填院系码 / 学校码加入）、院系邀请、作业审核（看照片和文件、通过 / 退回）
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rpc = (fn, a) => CCAuth.rpc(fn, a || {});
  let toastT = 0;
  const toast = (m, err) => { const t = $("toast"); t.textContent = m; t.className = "show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 2800); };
  const fail = (e) => toast((e && e.message) || "没成功", true);
  const O = () => window.CCOrg || {};
  const COLORS = ["#5b7cfa", "#22b8cf", "#f59f00", "#e64980", "#20c997", "#7950f2", "#fd7e14", "#12b886"];
  const colorOf = (t) => COLORS[[...String(t || "")].reduce((a, c) => a + c.codePointAt(0), 0) % COLORS.length];
  const first = (t) => esc([...String(t || "班")][0]);
  let T = null, me = null, sel = null, tab = 0;

  const allDepts = () => (T.schools || []).flatMap((s) => (s.depts || []).map((d) => Object.assign({ viaSchool: true, schoolName: s.name }, d))).concat(T.depts || []);
  const clsTitle = (c) => esc(c.name) + (c.nick ? "「" + esc(c.nick) + "」" : "");

  function sideHtml() {
    const inv = (T.classes || []).reduce((a, c) => a + (c.invites || []).length, 0), p = [];
    if (inv) p.push(`<div class="bar" data-inv>有 ${inv} 个院系邀请你的班加入 · 处理 ›</div>`);
    const li = (k, id, ic, color, t, s, right) => `<div class="li${sel && sel.k === k && sel.id === id ? " on" : ""}" data-k="${k}" data-id="${id}"><span class="ic" style="background:${color}">${ic}</span><div class="tx"><div class="t">${t}</div><div class="s">${s}</div></div>${right || ""}</div>`;
    if (T.site_admin) p.push(`<div class="list"><a class="li" href="admin.html" style="color:inherit;text-decoration:none"><span class="ic" style="background:#1f2937">🛡</span><div class="tx"><div class="t">站长后台</div><div class="s">开通学校、审核、全站设置、用户</div></div><span class="s">›</span></a></div>`);
    if ((T.schools || []).length) p.push(`<div class="grp-t">学校</div><div class="list">${T.schools.map((s) => li("school", s.id, "🏫", "#e7f0ff", esc(s.name), (s.depts || []).length + " 个院系 · " + (s.depts || []).reduce((a, d) => a + (d.classes || []).length, 0) + " 个班")).join("")}</div>`);
    const ds = allDepts();
    if (ds.length) p.push(`<div class="grp-t">院系</div><div class="list">${ds.map((d) => li("dept", d.id, "🏛", "#e3f8ef", esc(d.name), esc((d.schoolName || (d.school && d.school.name) || "还没并进学校")) + " · " + (d.classes || []).length + " 个班")).join("")}</div>`);
    p.push(`<div class="grp-t">我的班级${T.can_dept || T.site_admin ? `<button class="add" data-new title="新建">＋</button>` : ""}</div><div class="list">${(T.classes || []).map((c) => li("class", c.id, first(c.nick || c.name), colorOf(c.name), clsTitle(c),
      (c.my_role === "monitor" ? "班委 · " : "") + c.total + " 人" + (c.dept ? " · " + esc(c.dept.name) + (c.major ? " · " + esc(c.major) : "") : ""), c.pending ? `<span class="dot">${c.pending} 待批</span>` : "")).join("")
      || `<div class="li" style="cursor:default"><div class="tx"><div class="s">还没有管理的班级${T.can_dept ? "，点上面 ＋ 新建" : ""}</div></div></div>`}</div>`);
    p.push(`<div class="grp-t"><a href="class.html" style="color:var(--sub)">加入别人的班级 ›</a></div>`);
    return p.join("");
  }

  function render() {
    const wrap = $("root");
    if (!wrap.querySelector(".mg")) wrap.innerHTML = `<div class="mg"><div class="side" id="side"></div><div class="pane-wrap" id="pane"></div></div>`;
    $("side").innerHTML = sideHtml();
    wrap.querySelector(".mg").classList.toggle("detail", !!sel);
    $("side").querySelectorAll(".li[data-k]").forEach((el) => (el.onclick = () => { sel = { k: el.dataset.k, id: el.dataset.id }; tab = 0; render(); window.scrollTo(0, 0); }));
    const inv = $("side").querySelector("[data-inv]"); if (inv) inv.onclick = answerInvites;
    const nw = $("side").querySelector("[data-new]"); if (nw) nw.onclick = () => { sel = { k: "new" }; render(); };
    renderPane();
  }

  async function answerInvites() {
    for (const c of T.classes || []) for (const v of c.invites || []) {
      const ok = confirm("「" + (v.school ? v.school + " · " : "") + v.dept + "」邀请「" + c.name + "」加入。\n同意后，院系管理员能管理这个班（发布事项、看统计、管签到和成员）。\n\n点「确定」同意，点「取消」拒绝。");
      try { await rpc("class_invite_answer", { p_cid: c.id, p_did: v.dept_id, p_ok: ok }); } catch (e) { fail(e); }
    }
    load();
  }

  // ---------- 右边：详情 ----------
  function head(title, sub) { return `<div class="ph"><button class="back small" data-back>‹</button><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ""}</div></div>`; }
  function tabsHtml(names) { return `<div class="tabs">${names.map((t, i) => `<button class="small${i === tab ? " on" : ""}" data-tab="${i}">${t}</button>`).join("")}</div><div id="tp"></div>`; }
  function bindPane(pane, show) {
    pane.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = +b.dataset.tab; pane.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", +x.dataset.tab === tab)); show(tab); }));
    const bk = pane.querySelector("[data-back]"); if (bk) bk.onclick = () => { sel = null; render(); };
    show(tab);
  }
  const act = (root, q, fn) => root.querySelectorAll(q).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { fail(e); } b.disabled = false; }));
  const val = (root, q) => { const el = root.querySelector(q); return el ? el.value.trim() : ""; };

  function renderPane() {
    const pane = $("pane");
    if (!sel) { pane.innerHTML = `<section class="card"><div class="empty" style="padding:30px 10px;text-align:center">在左边选一个学校、院系或班级</div></section>`; return; }
    if (sel.k === "new") return newPane(pane);
    if (sel.k === "school") {
      const s = (T.schools || []).find((x) => x.id === sel.id); if (!s) { sel = null; return renderPane(); }
      pane.innerHTML = head("🏫 " + esc(s.name), s.role === "owner" ? "学校主管理员" : "学校管理员") + tabsHtml(["管理", "统计", "请假", "作业审核", "作息", "功能"]);
      bindPane(pane, (i) => { const tp = $("tp");
        if (i === 0) schoolMgr(tp, s); else if (i === 1) O().showStats(tp, "school", s.id, 7); else if (i === 2) O().showLeave(tp, "school", s.id);
        else if (i === 3) { tp.innerHTML = `<section class="card"><div class="desc">作业审核按院系设置：选一个院系，在它的「作业审核」里给每个班单独打开。</div>${(s.depts || []).map((d) => `<div class="hwi" data-go="${d.id}">🏛 ${esc(d.name)}<span class="spacer"></span>›</div>`).join("")}</section>`;
          tp.querySelectorAll("[data-go]").forEach((x) => (x.onclick = () => { sel = { k: "dept", id: x.dataset.go }; tab = 3; render(); })); }
        else if (i === 4) O().showSched(tp, "school", s.id); else O().showFeat(tp, "school", s.id); });
      return;
    }
    if (sel.k === "dept") {
      const d = allDepts().find((x) => x.id === sel.id); if (!d) { sel = null; return renderPane(); }
      pane.innerHTML = head("🏛 " + esc(d.name), esc(d.schoolName || (d.school && d.school.name) || "还没并进学校")) + tabsHtml(["管理", "统计", "请假", "作业审核", "作息", "功能"]);
      bindPane(pane, (i) => { const tp = $("tp");
        if (i === 0) deptMgr(tp, d); else if (i === 1) O().showStats(tp, "dept", d.id, 7); else if (i === 2) O().showLeave(tp, "dept", d.id); else if (i === 3) O().showHw(tp, d.id);
        else if (i === 4) O().showSched(tp, "dept", d.id, d.schoolName); else O().showFeat(tp, "dept", d.id); });
      return;
    }
    const c = (T.classes || []).find((x) => x.id === sel.id) || allDepts().flatMap((d) => d.classes || []).find((x) => x.id === sel.id);
    if (!c) { sel = null; return renderPane(); }
    pane.innerHTML = head(clsTitle(c), (c.teacher ? esc(c.teacher) + " · " : "") + c.total + " 人") + tabsHtml(["班级", "学情", "课堂互动", "作业审核"]);
    bindPane(pane, (i) => { const tp = $("tp"); clearTimeout(actT); if (i === 0) classInfo(tp, c); else if (i === 1) learning(tp, c, 30); else if (i === 2) classAct(tp, c); else hwReview(tp, c); });
  }

  function codeBox(label, code, hint) {
    return `<div class="kv"><div style="flex:1"><div class="pill">${label}</div><div class="code">${esc(code)}</div></div><button class="small" data-copy="${esc(code)}">复制</button></div>${hint ? `<div class="desc">${hint}</div>` : ""}`;
  }
  function bindCopy(root) { root.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { try { navigator.clipboard.writeText(b.dataset.copy); } catch (e) {} toast("已复制 " + b.dataset.copy); })); }

  function schoolMgr(tp, s) {
    const owner = s.role === "owner";
    tp.innerHTML = codeBox("学校码", s.code, "班主任在自己的班上填学校码就能加进来；院系主管理员填学校码把院系并进来。")
      + `<section class="card"><h3 style="margin-top:0">院系（${(s.depts || []).length}）</h3>
        ${(s.depts || []).map((d) => `<div class="hwi" data-go="${d.id}">🏛 <b>${esc(d.name)}</b><span class="pill">${(d.classes || []).length} 个班 · ${(d.admins || []).map((a) => esc(a.name)).join("、") || "还没有院系管理员"}</span><span class="spacer"></span>›</div>`).join("") || `<div class="empty">还没有院系</div>`}
        <div class="row" style="margin-top:10px"><input placeholder="新院系名称" data-nd size="16"><input placeholder="院系管理员账号（可不填）" data-nda size="18"><button class="primary small" data-ndgo>建院系</button></div>
        <div class="row" style="margin-top:8px"><input placeholder="已有院系的院系码" data-lk size="14"><button class="small" data-lkgo>并进来</button></div></section>
      <section class="card"><h3 style="margin-top:0">学校管理员</h3><div class="desc">${(s.admins || []).map((a) => esc(a.name) + (a.role === "owner" ? "（主）" : "")).join("、")}</div>
        ${owner ? `<div class="row"><input placeholder="账号或邮箱" data-aadd size="18"><button class="small" data-aaddgo>加为学校管理员</button><span class="spacer"></span><button class="small" data-reset>换一个学校码</button></div>` : ""}</section>`;
    bindCopy(tp);
    tp.querySelectorAll("[data-go]").forEach((x) => (x.onclick = () => { sel = { k: "dept", id: x.dataset.go }; tab = 0; render(); }));
    act(tp, "[data-ndgo]", async () => { await rpc("school_dept_create", { sid: s.id, p_name: val(tp, "[data-nd]"), p_admin: val(tp, "[data-nda]") || null }); toast("院系建好了"); load(); });
    act(tp, "[data-lkgo]", async () => { const r = await rpc("school_dept_link", { sid: s.id, p_dept_code: val(tp, "[data-lk]") }); toast(r.already ? "已经在学校里了" : "「" + r.name + "」并进来了"); load(); });
    act(tp, "[data-aaddgo]", async () => { const r = await rpc("school_admin_add", { sid: s.id, p_account: val(tp, "[data-aadd]") }); toast("已加 " + r.name); load(); });
    act(tp, "[data-reset]", async () => { if (!confirm("换一个学校码？旧的码马上失效。")) return; await rpc("school_code_reset", { sid: s.id }); load(); });
  }
  function deptMgr(tp, d) {
    const owner = d.role === "owner" || d.viaSchool;
    tp.innerHTML = codeBox("院系码", d.code, "班主任在自己的班上填院系码就能加进来。")
      + `<section class="card"><h3 style="margin-top:0">专业（${(d.majors || []).length}）</h3>
        <div class="chips">${(d.majors || []).map((m) => `<span class="chip">${esc(m.name)}<button data-mdel="${m.id}" title="删掉">✕</button></span>`).join("") || `<span class="pill">还没有分专业（可以不分）</span>`}</div>
        <div class="row" style="margin-top:8px"><input placeholder="专业名称，如 软件工程" data-mn size="16"><button class="small" data-mgo>加专业</button></div></section>
      <section class="card"><h3 style="margin-top:0">班级（${(d.classes || []).length}）</h3>
        ${(d.classes || []).map((c) => `<div class="hwi" data-cls="${c.id}"><span style="width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;background:${colorOf(c.name)}">${first(c.nick || c.name)}</span><b>${clsTitle(c)}</b><span class="pill">${esc(c.teacher || "")} · ${c.total} 人${c.pending ? " · " + c.pending + " 人等批准" : ""}</span><span class="spacer"></span>
          ${(d.majors || []).length ? `<select data-cm="${c.id}"><option value="">未分专业</option>${d.majors.map((m) => `<option value="${m.id}"${c.major_id === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select>` : ""}›</div>`).join("") || `<div class="empty">还没有班级</div>`}
        ${(d.invites || []).length ? `<div class="pill">已邀请：${d.invites.map(esc).join("、")}（等班主任同意）</div>` : ""}
        <div class="row" style="margin-top:10px"><input placeholder="班级码" data-ic size="10"><button class="primary small" data-igo>邀请班级加入</button></div></section>
      <section class="card"><h3 style="margin-top:0">院系管理员</h3><div class="desc">${(d.admins || []).map((a) => esc(a.name) + (a.role === "owner" ? "（主）" : "")).join("、") || "还没有"}</div>
        ${owner ? `<div class="row"><input placeholder="账号或邮箱" data-da size="16"><button class="small" data-dago>设为院系管理员</button></div>` : ""}
        ${!d.school && !d.viaSchool && d.role === "owner" ? `<div class="row" style="margin-top:8px"><input placeholder="学校码" data-jc size="10"><button class="small" data-jgo>并进学校</button></div>` : ""}
        ${d.viaSchool ? `<div class="row" style="margin-top:8px"><button class="small danger" data-unl>移出学校</button></div>` : ""}</section>`;
    bindCopy(tp);
    tp.querySelectorAll("[data-cls]").forEach((x) => (x.onclick = () => { sel = { k: "class", id: x.dataset.cls }; tab = 0; render(); }));
    act(tp, "[data-mgo]", async () => { await rpc("major_add", { p_did: d.id, p_name: val(tp, "[data-mn]") }); toast("加好了"); load(); });
    act(tp, "[data-mdel]", async (b) => { if (!confirm("删掉这个专业？里面的班级不受影响，只是变成未分专业。")) return; await rpc("major_del", { p_mid: b.dataset.mdel }); load(); });
    tp.querySelectorAll("[data-cm]").forEach((sel0) => sel0.addEventListener("click", (e) => e.stopPropagation()));
    tp.querySelectorAll("[data-cm]").forEach((sel0) => (sel0.onchange = async () => { try { await rpc("class_set_major", { p_cid: sel0.dataset.cm, p_mid: sel0.value || null }); toast("分好了"); load(); } catch (e) { fail(e); } }));
    act(tp, "[data-igo]", async () => { const r = await rpc("dept_class_invite", { p_did: d.id, p_class_code: val(tp, "[data-ic]") }); toast(r.linked ? "「" + r.class + "」已加入" : r.already ? "已经在这个院系里了" : "邀请已发给「" + r.class + "」的班主任"); load(); });
    act(tp, "[data-dago]", async () => { const a = val(tp, "[data-da]"); const r = await rpc(d.viaSchool ? "school_dept_admin_add" : "dept_admin_add", { did: d.id, p_account: a }); toast("已设 " + ((r && r.name) || a)); load(); });
    act(tp, "[data-jgo]", async () => { const r = await rpc("dept_join_school", { did: d.id, p_school_code: val(tp, "[data-jc]") }); toast("已并进「" + r.name + "」"); load(); });
    act(tp, "[data-unl]", async () => { if (!confirm("把这个院系移出学校？院系和里面的班不会删。")) return; await rpc("school_dept_unlink", { did: d.id }); load(); });
  }
  function classInfo(tp, c) {
    const mine = !!c.mine;
    tp.innerHTML = codeBox("班级码", c.code, "把班级码发给同学，在「加入班级」里填上就能加入。")
      + `<section class="card"><h3 style="margin-top:0">所属院系 / 学校</h3>
        ${c.dept ? `<div class="row"><b>${esc((c.dept.school ? c.dept.school + " · " : "") + c.dept.name)}</b>${(c.dept.majors || []).length ? `<select data-mym>${[`<option value="">未分专业</option>`].concat(c.dept.majors.map((m) => `<option value="${m.id}"${c.major_id === m.id ? " selected" : ""}>${esc(m.name)}</option>`)).join("")}</select>` : ""}${mine ? `<span class="spacer"></span><button class="small" data-leave>移出</button>` : ""}</div>`
          : `<div class="desc">还没加入。填院系码直接加入；填学校码再选院系。</div>${mine ? `<div class="row"><input placeholder="院系码或学校码" data-jo size="14"><button class="primary small" data-jogo>加入</button></div>` : `<div class="desc">只有班主任能把班加进院系。</div>`}`}
        ${(c.invites || []).map((v) => `<div class="bar" style="cursor:default;margin-top:10px">${esc((v.school ? v.school + " · " : "") + v.dept)} 邀请这个班加入 <button class="small" data-inv="${v.dept_id}|0">拒绝</button> <button class="small primary" data-inv="${v.dept_id}|1">同意</button></div>`).join("")}</section>
      <section class="card"><div class="row"><a class="btn" href="class.html">成员、班委、功能开关 ›</a>${c.pending ? `<span class="dot">${c.pending} 人等批准</span>` : ""}</div></section>`;
    bindCopy(tp);
    act(tp, "[data-jogo]", async () => {
      const code = val(tp, "[data-jo]");
      let r = await rpc("class_org_join", { p_cid: c.id, p_code: code });
      if (r && r.need_dept) {
        if (!(r.depts || []).length) { alert("「" + r.school + "」还没有建院系，请学校管理员先建院系。"); return; }
        const pick = prompt("「" + r.school + "」的院系：\n" + r.depts.map((d, i) => (i + 1) + ". " + d.name).join("\n") + "\n\n填序号：", "1");
        const d = r.depts[(+pick || 0) - 1]; if (!d) return;
        r = await rpc("class_org_join", { p_cid: c.id, p_code: code, p_did: d.id });
      }
      toast(r.already ? "已经在「" + r.name + "」里了" : "已加入「" + r.name + "」"); load();
    });
    const mym = tp.querySelector("[data-mym]"); if (mym) mym.onchange = async () => { try { await rpc("class_set_major", { p_cid: c.id, p_mid: mym.value || null }); toast("专业已选好"); load(); } catch (e) { fail(e); } };
    act(tp, "[data-leave]", async () => { if (!confirm("把这个班移出院系？班级本身不受影响。")) return; await rpc("dept_class_unlink", { cid: c.id }); load(); });
    act(tp, "[data-inv]", async (b) => { const [did, ok] = b.dataset.inv.split("|");
      if (ok === "1" && !confirm("同意后，院系管理员能管理这个班（发布事项、看统计、管签到和成员）。同意吗？")) return;
      await rpc("class_invite_answer", { p_cid: c.id, p_did: did, p_ok: ok === "1" }); toast(ok === "1" ? "已加入" : "已拒绝"); load(); });
  }

  // ---------- 作业审核（网页版）----------
  const ST = { pending: ["待审核", "st-p"], approved: ["已通过", "st-a"], rejected: ["已退回", "st-r"] };
  let fileMap = {};
  async function hwReview(tp, c, item) {
    tp.innerHTML = `<section class="card"><div class="empty">加载中…</div></section>`;
    try {
      if (!item) {
        const r = await rpc("hw_review_overview", { p_cid: c.id });
        tp.innerHTML = `<section class="card"><div class="desc">${r.mode === "photo" ? "这个班交作业要拍照" : r.mode === "file" ? "这个班交作业要交文件" : "这个班没有打开「作业要交证明」（院系管理员在院系的「作业审核」里打开）"} · ${r.members} 位同学</div>
          ${(r.items || []).map((x) => `<div class="hwi" data-item="${x.id}"><b>${esc(x.title)}</b><span class="pill">交了 ${x.sent}/${r.members} · 通过 ${x.approved}</span>${x.pending ? `<span class="dot">${x.pending} 待审</span>` : ""}<span class="spacer"></span>›</div>`).join("") || `<div class="empty">最近 60 天没有布置作业</div>`}</section>`;
        tp.querySelectorAll("[data-item]").forEach((x) => (x.onclick = () => hwReview(tp, c, +x.dataset.item)));
        return;
      }
      const r = await rpc("hw_review_list", { p_item: item });
      const pend = (r.rows || []).filter((x) => x.status === "pending");
      fileMap = {};
      (r.rows || []).forEach((x) => (x.files || []).forEach((f) => { fileMap[f.id] = f; }));
      tp.innerHTML = `<section class="card"><div class="row"><button class="small" data-up>‹ 全部作业</button><b>${esc(r.title)}</b><span class="spacer"></span>${pend.length > 1 ? `<button class="primary small" data-all>全部通过（${pend.length}）</button>` : ""}</div>
        ${(r.rows || []).map((x) => `<div class="sub-r"><div class="row"><b>${esc(x.name)}</b><span class="${ST[x.status][1]}">${ST[x.status][0]}</span>${x.late ? `<span class="st-r">迟交</span>` : ""}${x.note ? `<span class="pill">「${esc(x.note)}」</span>` : ""}<span class="spacer"></span>
            <button class="small" data-no="${x.id}">${x.status === "rejected" ? "改退回原因" : "退回"}</button>${x.status !== "approved" ? `<button class="small primary" data-ok="${x.id}">通过</button>` : ""}</div>
          ${x.review_note ? `<div class="pill">退回原因：${esc(x.review_note)}</div>` : ""}
          <div class="thumbs">${(x.files || []).map((f) => f.thumb ? `<img src="data:image/jpeg;base64,${f.thumb}" data-f="${f.id}" title="${esc(f.name)}" alt="">` : `<div class="f" data-f="${f.id}">📄 ${esc(f.name)}</div>`).join("") || `<span class="pill">文件已过期删除</span>`}</div></div>`).join("") || `<div class="empty">还没有同学交</div>`}
        ${(r.missing || []).length ? `<details style="margin-top:10px"><summary class="pill">还没交 ${r.missing.length} 人</summary><div class="desc">${r.missing.map(esc).join("、")}</div></details>` : ""}</section>`;
      tp.querySelector("[data-up]").onclick = () => hwReview(tp, c);
      const review = async (ids, ok, note) => { await rpc("hw_review", { p_ids: ids, p_ok: ok, p_note: note }); toast(ok ? "已通过" : "已退回，同学会收到提醒"); hwReview(tp, c, item); };
      act(tp, "[data-ok]", (b) => review([+b.dataset.ok], true, null));
      act(tp, "[data-no]", async (b) => { const n = prompt("退回原因（同学会在微信里收到）", "照片看不清，请重新拍"); if (!n) return; await review([+b.dataset.no], false, n); });
      act(tp, "[data-all]", async () => { if (!confirm("把 " + pend.length + " 份待审核的全部通过？")) return; await review(pend.map((x) => x.id), true, null); });
      tp.querySelectorAll("[data-f]").forEach((el) => (el.onclick = () => openFile(fileMap[el.dataset.f])));
    } catch (e) { tp.innerHTML = `<section class="card"><div class="empty">${/hw_review|PGRST202|Could not find/.test(e.message) ? "作业审核暂未开通（要先执行 7.35 SQL）" : esc(e.message)}</div></section>`; }
  }
  // ---------- 7.40 学情 + 随机点名（参照学习通）----------
  async function learning(tp, c, days) {
    tp.innerHTML = `<section class="card"><div class="empty">加载中…</div></section>`;
    let r; try { r = await rpc("class_learning", { p_cid: c.id, p_days: days }); }
    catch (e) { tp.innerHTML = `<section class="card"><div class="empty">${/class_learning|PGRST202|Could not find/.test(e.message) ? "学情暂未开通（要先执行 7.40 SQL）" : esc(e.message)}</div></section>`; return; }
    const ago = (t) => { if (!t) return "没用过"; const d = Math.floor((Date.now() - Date.parse(t)) / 864e5); return d <= 0 ? "今天" : d === 1 ? "昨天" : d + " 天前"; };
    const rows = r.rows || [], warn = rows.filter((x) => x.warn), hasScore = rows.some((x) => x.score != null), W = r.weights;
    const WK = [["hw", "作业"], ["ck", "签到"], ["rush", "抢答"], ["peer", "互评"], ["growth", "成长值"]];
    tp.innerHTML = `<section class="card"><div class="row">${[7, 30, 90].map((d) => `<button class="small${d === days ? " primary" : ""}" data-days="${d}">最近 ${d} 天</button>`).join("")}<span class="spacer"></span>
        <button class="small" data-report>📋 课堂报告</button><button class="small" data-roll>🎲 随机点名</button><b data-pick style="min-width:80px;text-align:center"></b></div>
      <div data-rep></div>
      ${W ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin:6px 0"><span class="pill">平时成绩 =</span>${WK.map(([k, t]) => `<label class="pill">${t} <input data-w="${k}" type="number" min="0" max="100" step="5" value="${W[k] || 0}" style="width:52px">%</label>`).join("")}<button class="small" data-wsave>保存权重</button></div>` : ""}
      <div class="stats"><div class="stat"><b>${rows.length}</b><span>同学</span></div><div class="stat"><b style="color:${warn.length ? "var(--orange)" : "inherit"}">${warn.length}</b><span>需要关注</span></div><div class="stat"><b>${r.hw}</b><span>到期作业</span></div><div class="stat"><b>${r.ck}</b><span>签到</span></div></div>
      <div class="tbl-wrap"><table class="st"><thead><tr><th>同学</th><th>作业完成</th><th>签到</th><th>请假</th><th>最近用过</th><th>成长值</th>${hasScore ? "<th>抢答</th><th>互评</th><th>平时成绩</th>" : ""}</tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(x.name)}${x.role === "monitor" ? ` <span class="badge">班委</span>` : x.role === "creator" ? ` <span class="badge">班主任</span>` : ""}${x.warn ? ` <span class="badge wait">需要关注</span>` : ""}</td>
        <td style="color:${x.hw_rate != null && x.hw_rate < 60 ? "var(--red)" : "inherit"}">${x.hw_rate == null ? "—" : x.hw_rate + "%"}</td><td style="color:${x.ck_rate != null && x.ck_rate < 80 ? "var(--red)" : "inherit"}">${x.ck_rate == null ? "—" : x.ck_rate + "%"}</td>
        <td>${x.leaves || 0}</td><td>${ago(x.seen)}</td><td>${x.points || 0}</td>${hasScore ? `<td>${x.rush_n || 0}</td><td>${x.peer_avg ? x.peer_avg + " ★" : "—"}</td><td style="font-weight:700;color:${x.score < 60 ? "var(--red)" : "inherit"}">${x.score == null ? "—" : Math.round(x.score)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="9" class="empty">班里还没有同学</td></tr>`}</tbody></table></div>
      <div class="pill" style="margin-top:6px">作业按这段时间里已经截止的算，交了或打勾都算完成；签到按已经结束的算。作业低于 60%、签到低于 80%、或 7 天没打开，标「需要关注」。</div></section>`;
    tp.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => learning(tp, c, +b.dataset.days)));
    const ws = tp.querySelector("[data-wsave]");
    if (ws) ws.onclick = async () => {
      const v = {}; tp.querySelectorAll("[data-w]").forEach((el) => (v[el.dataset.w] = Math.max(0, +el.value || 0)));
      const sum = v.hw + v.ck + v.rush + v.peer + v.growth; if (sum !== 100) { toast("各项加起来要等于 100%，现在是 " + sum + "%"); return; }
      try { await rpc("grade_cfg_set", { p_cid: c.id, p_hw: v.hw, p_ck: v.ck, p_rush: v.rush, p_peer: v.peer, p_growth: v.growth }); toast("已保存"); learning(tp, c, days); } catch (e) { toast(e.message); }
    };
    tp.querySelector("[data-report]").onclick = () => report(tp.querySelector("[data-rep]"), c, "");
    tp.querySelector("[data-roll]").onclick = () => {
      if (!rows.length) return; const out = tp.querySelector("[data-pick]"); let n = 0; const total = 14 + Math.floor(Math.random() * 6);
      const step = () => { out.textContent = rows[Math.floor(Math.random() * rows.length)].name; if (++n < total) setTimeout(step, 40 + n * 12); };
      step();
    };
  }
  // ---------- 7.41 课堂报告 ----------
  async function report(box, c, day) {
    let r; try { r = await rpc("class_report", { p_cid: c.id, p_day: day || null }); } catch (e) { box.innerHTML = `<div class="empty">${/class_report|PGRST202|Could not find/.test(e.message) ? "课堂报告暂未开通（要先执行 7.41 SQL）" : esc(e.message)}</div>`; return; }
    const L = [];
    (r.checkins || []).forEach((x) => L.push(`签到「${x.title || "签到"}」：${x.signed}/${r.people} 人${x.leave ? "，请假 " + x.leave : ""}`));
    (r.rush || []).forEach((x) => L.push(`抢答「${x.title}」：${x.n} 人抢，第一名 ${x.first || "—"}`));
    (r.hw_due || []).forEach((x) => L.push(`作业「${x.title}」到期：${x.done}/${r.people} 人完成`));
    (r.notices || []).forEach((x) => L.push(`${x.type || "通知"}「${x.title}」：${x.read}/${r.people} 人已读`));
    if (r.leaves) L.push(`这天请假 ${r.leaves} 人`);
    const text = `【课堂报告 ${r.day}】全班 ${r.people} 人\n` + (L.length ? L.join("\n") : "这一天没有签到、抢答和到期作业");
    box.innerHTML = `<div class="card" style="margin:8px 0;padding:12px"><div class="row"><b>课堂报告</b><input type="date" data-rd value="${esc(r.day)}" style="margin-left:8px"><span class="spacer"></span><button class="small" data-rc>复制发群</button><button class="small" data-rx>收起</button></div>
      ${L.map((x) => `<div class="desc" style="padding:4px 0;border-bottom:1px solid var(--line)">${esc(x)}</div>`).join("") || `<div class="empty">这一天没有签到、抢答和到期作业</div>`}</div>`;
    box.querySelector("[data-rd]").onchange = (e) => report(box, c, e.target.value);
    box.querySelector("[data-rc]").onclick = () => navigator.clipboard.writeText(text).then(() => toast("已复制，发到班群就行"), () => toast("复制失败"));
    box.querySelector("[data-rx]").onclick = () => (box.innerHTML = "");
  }
  // ---------- 7.41 课堂互动：抢答（可以投屏看名次、加分）、小组互评（发起、看结果）----------
  var actT = 0;
  async function classAct(tp, c) {
    clearTimeout(actT);
    let rs, peers;
    try { [rs, peers] = await Promise.all([rpc("rush_state", { p_cid: c.id }), rpc("peer_todo", { p_cid: c.id })]); }
    catch (e) { tp.innerHTML = `<section class="card"><div class="empty">${/rush_|peer_|PGRST202|Could not find/.test(e.message) ? "课堂互动暂未开通（要先执行 7.41 SQL）" : esc(e.message)}</div></section>`; return; }
    if (!tp.isConnected) return;
    const R = rs && !rs.none ? rs : null, open = R && R.open && Date.parse(R.ends_at) > Date.now(), staff = !!(rs && rs.staff);
    const left = open ? Math.ceil((Date.parse(R.ends_at) - Date.now()) / 1000) : 0;
    tp.innerHTML = `<section class="card"><h3 style="margin:0 0 8px">⚡ 抢答</h3>
      ${open ? `<div class="row"><b style="font-size:20px">${esc(R.title)}</b><span class="pill">还剩 ${left} 秒 · 前 ${R.top_n} 名</span><span class="spacer"></span>${staff ? `<button class="small" data-rstop="${R.id}">提前结束</button>` : ""}</div>`
        : staff ? `<div class="row" style="flex-wrap:wrap;gap:6px"><input data-rt placeholder="题目（选填）" maxlength="40" style="flex:1;min-width:160px"><select data-rs><option value="30">30 秒</option><option value="60" selected>1 分钟</option><option value="120">2 分钟</option><option value="300">5 分钟</option></select>
          <select data-rn><option value="1">前 1 名</option><option value="3" selected>前 3 名</option><option value="5">前 5 名</option><option value="10">前 10 名</option></select><button class="primary small" data-rgo>开始抢答</button></div><div class="desc">发起后同学手机上会弹出「抢答开始」，在小程序里点「抢」。</div>` : `<div class="empty">现在没有抢答</div>`}
      ${R && (R.rows || []).length ? `<div class="desc" style="margin-top:8px">${open ? "名次" : "上一次：" + esc(R.title)}${staff ? " · 点「加分」给成长值" : ""}</div>
        <div class="tbl-wrap"><table class="st"><tbody>${R.rows.map((x, i) => `<tr><td style="width:40px;font-weight:800;color:${i < R.top_n ? "var(--accent)" : "inherit"}">${i + 1}</td><td>${esc(x.name)}</td><td>${(x.ms / 1000).toFixed(1)} 秒</td><td>${x.points ? `<b style="color:var(--orange)">+${x.points}</b>` : ""}</td>
          <td>${staff ? `<select data-aw="${esc(x.uid)}"><option value="">加分</option>${[0, 1, 2, 3, 5, 10].map((n) => `<option value="${n}">${n ? "+" + n : "不加"}</option>`).join("")}</select>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </section>
      <section class="card"><div class="row"><h3 style="margin:0">👥 小组互评</h3><span class="spacer"></span>${staff ? `<select data-pk><option value="in">组内互评</option><option value="cross">组间互评</option></select><input data-pt placeholder="互评名称" maxlength="40" style="width:140px"><select data-pd><option value="1">1 天</option><option value="3" selected>3 天</option><option value="7">7 天</option></select><button class="small primary" data-pgo>发起</button>` : ""}</div>
        <div class="desc">按班级分组来：组内互评是给同组的组员打分，组间互评是给别的小组打分，1~5 星 + 一句话。同学在小程序「成长 → 课堂互动」里评。</div>
        ${(peers || []).map((p) => `<div class="kv" style="margin-top:6px"><div style="flex:1"><b>${esc(p.title)}</b> <span class="pill">${p.kind === "cross" ? "组间" : "组内"}</span> <span class="desc">${p.open ? new Date(p.ends_at).toLocaleDateString() + " 截止" : "已结束"}</span></div>${staff ? `<button class="small" data-pr="${p.id}">看结果</button>` : ""}</div><div data-prbox="${p.id}"></div>`).join("") || `<div class="empty">最近没有小组互评</div>`}
      </section>`;
    const q = (k) => tp.querySelector(k);
    if (q("[data-rgo]")) q("[data-rgo]").onclick = async () => { try { await rpc("rush_start", { p_cid: c.id, p_title: q("[data-rt]").value || null, p_secs: +q("[data-rs]").value, p_top: +q("[data-rn]").value }); classAct(tp, c); } catch (e) { toast(e.message); } };
    if (q("[data-rstop]")) q("[data-rstop]").onclick = async () => { try { await rpc("rush_close", { p_id: R.id }); classAct(tp, c); } catch (e) { toast(e.message); } };
    tp.querySelectorAll("[data-aw]").forEach((el) => (el.onchange = async () => { if (el.value === "") return; try { await rpc("rush_award", { p_id: R.id, p_uid: el.dataset.aw, p_points: +el.value }); classAct(tp, c); } catch (e) { toast(e.message); } }));
    if (q("[data-pgo]")) q("[data-pgo]").onclick = async () => { try { await rpc("peer_start", { p_cid: c.id, p_title: q("[data-pt]").value || "小组互评", p_kind: q("[data-pk]").value, p_days: +q("[data-pd]").value }); toast("已发起"); classAct(tp, c); } catch (e) { toast(e.message); } };
    tp.querySelectorAll("[data-pr]").forEach((b) => (b.onclick = async () => {
      const box = tp.querySelector(`[data-prbox="${b.dataset.pr}"]`);
      try { const r = await rpc("peer_result", { p_rid: +b.dataset.pr });
        box.innerHTML = `<div class="tbl-wrap"><table class="st"><thead><tr><th>${r.kind === "cross" ? "小组" : "同学"}</th><th>平均</th><th>几人评</th><th>评语</th></tr></thead><tbody>${(r.rows || []).map((x) => `<tr><td>${esc(x.name || "（已退出）")}</td><td><b>${x.avg}</b> ★</td><td>${x.n}</td><td class="desc">${esc((x.comments || []).filter(Boolean).join("；"))}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">还没有人评</td></tr>`}</tbody></table></div><div class="desc">${r.raters} 人参与</div>`;
      } catch (e) { toast(e.message); }
    }));
    // 进行中：1.5 秒刷一次名次（正在输入、或者打开着互评结果时先不刷）
    const tick = () => { if (!tp.isConnected) return; if (!tp.querySelector("input:focus, select:focus") && ![...tp.querySelectorAll("[data-prbox]")].some((x) => x.innerHTML)) classAct(tp, c); else actT = setTimeout(tick, 1500); };
    if (open) actT = setTimeout(tick, 1500);   // 进行中：1.5 秒刷一次名次
  }
  async function openFile(f) {
    if (!f) return;
    const w = window.open("", "_blank");
    try {
      const parts = [];
      for (let i = 0; i < (f.parts || 1); i++) {
        const r = await rpc("hw_file_get", { fid: f.id, n: i });
        const bin = atob(String((r && r.data) || "").replace(/[^A-Za-z0-9+/=]/g, "")), u = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
        parts.push(u);
      }
      const url = URL.createObjectURL(new Blob(parts, { type: f.mime || "application/octet-stream" }));
      if (w) w.location = url; else location.href = url;
    } catch (e) { if (w) w.close(); fail(e); }
  }

  // ---------- 新建 ----------
  function newPane(pane) {
    const ap = (T.applies || []).filter((a) => a.status === "pending" || Date.now() - Date.parse(a.at) < 7 * 864e5);
    pane.innerHTML = head("新建") + `
      <section class="card"><h3 style="margin-top:0">新建班级</h3><div class="row"><input placeholder="班级名称，如 计科2501" data-nc size="18"><button class="primary small" data-ncgo>建班</button></div></section>
      ${T.can_dept ? `<section class="card"><h3 style="margin-top:0">新建院系</h3><div class="desc">学校还没开通也能先建，以后再并进学校。</div><div class="row"><input placeholder="院系名称，如 计算机学院" data-ndn size="18"><button class="small" data-ndngo>建院系</button></div></section>` : ""}
      <section class="card"><h3 style="margin-top:0">${T.site_admin ? "开通学校" : "申请开通学校"}</h3>
        <div class="row"><input placeholder="学校全称，如 西安交通大学（不要写简称）" data-ns size="30" maxlength="40"></div>
        <div data-sugg></div>
        <div class="row" style="margin-top:8px">${T.site_admin ? `<input placeholder="主管理员账号或邮箱（不填就是你）" data-nso size="24">` : `<input placeholder="联系方式（手机号或邮箱）" data-nsc size="18"><input placeholder="说明（可不填）" data-nsn size="18">`}
          <button class="primary small" data-nsgo>${T.site_admin ? "开通" : "提交申请"}</button></div>
        ${ap.map((a) => `<div class="pill" style="margin-top:6px">开通申请「${esc(a.name)}」：${a.status === "pending" ? "审核中" : a.status === "approved" ? "已开通 ✓" : "没通过" + (a.note ? "：" + esc(a.note) : "")}</div>`).join("")}</section>`;
    pane.querySelector("[data-back]").onclick = () => { sel = null; render(); };
    act(pane, "[data-ncgo]", async () => { const n = val(pane, "[data-nc]"); if (!n) throw new Error("先写班级名称"); const r = await rpc("create_class", { cname: n }); alert("「" + (r.name || n) + "」建好了，班级码 " + r.code); sel = { k: "class", id: r.id }; load(); });
    act(pane, "[data-ndngo]", async () => { const r = await rpc("dept_create", { p_name: val(pane, "[data-ndn]"), p_org: null }); toast("院系建好了"); sel = { k: "dept", id: r.id }; load(); });
    let t = 0, sugg = [];
    const ns = pane.querySelector("[data-ns]");
    ns.oninput = () => { clearTimeout(t); const q = ns.value.trim(); const box = pane.querySelector("[data-sugg]"); if (q.length < 2) { box.innerHTML = ""; sugg = []; return; }
      t = setTimeout(async () => { try { sugg = (await rpc("school_suggest", { p_q: q })) || []; } catch (e) { sugg = []; }
        if (ns.value.trim() !== q) return;
        box.innerHTML = sugg.length ? `<div class="sugg">已经开通的学校：${sugg.map((s) => `<div class="${s.same ? "same" : ""}">${esc(s.name)} · ${s.depts} 个院系${(s.admins || []).length ? " · 管理员 " + esc(s.admins.join("、")) : ""}${s.same ? "（已开通，请向管理员要学校码）" : ""}</div>`).join("")}</div>`
          : `<div class="pill" style="margin-top:6px">没有找到同名的学校，可以开通 ✓</div>`; }, 350); };
    act(pane, "[data-nsgo]", async () => {
      const name = ns.value.trim();
      if (name.length < 2) throw new Error("请填写学校全称");
      if (sugg.some((s) => s.same)) throw new Error("「" + name + "」已经开通了，请联系它的管理员要学校码");
      if (T.site_admin) { const r = await rpc("school_create", { p_name: name, p_owner: val(pane, "[data-nso]") || me.account }); alert("「" + r.name + "」开通好了，学校码 " + r.code); sel = { k: "school", id: r.id }; }
      else { await rpc("school_apply", { p_name: name, p_contact: val(pane, "[data-nsc]"), p_note: val(pane, "[data-nsn]") || null }); alert("申请已提交，站长审核通过后你就是这个学校的管理员。"); }
      load();
    });
  }

  async function load() {
    try { T = await rpc("org_tree"); }
    catch (e) { $("root").innerHTML = `<section class="card"><h2>管理中心暂未开通</h2><div class="desc">${/org_tree|PGRST202|Could not find/.test(e.message) ? "请联系网站管理员" : esc(e.message)}</div></section>`; return; }
    if (!sel && innerWidth > 760) {   // 电脑上：默认选第一项
      const s0 = (T.schools || [])[0], d0 = allDepts()[0], c0 = (T.classes || [])[0];
      sel = s0 ? { k: "school", id: s0.id } : d0 ? { k: "dept", id: d0.id } : c0 ? { k: "class", id: c0.id } : (T.can_dept || T.site_admin) ? { k: "new" } : null;
    }
    render();
  }

  (async () => {
    const s = await CCAuth.session();
    if (!s) { location.href = "login.html?next=manage.html"; return; }
    me = await CCAuth.me().catch(() => null);
    if (!me) { location.href = "login.html?next=manage.html"; return; }
    $("who").textContent = me.display_name || me.account || "";
    load();
  })();
})();
