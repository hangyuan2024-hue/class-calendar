// 7.36 管理中心（网站）：班级、院系、学校放在一个页面（数据库 org_tree）
//   我的班（属于哪个院系 / 学校，没加入的填院系码 / 学校码加入，院系邀请在这里同意）
//   我管的学校、院系（码、下面的班、建院系、邀请班级、设管理员；统计 / 作息 / 功能 / 作业审核就在卡片里展开，用 school.js 的面板）
//   开通学校：边打字边提示已经开通的同名学校。站长：顶上「站长后台」入口
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rpc = (fn, a) => CCAuth.rpc(fn, a || {});
  let toastT = 0;
  const toast = (m, err) => { const t = $("toast"); t.textContent = m; t.className = "show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 2800); };
  const fail = (e) => toast((e && e.message) || "没成功", true);
  const O = () => window.CCOrg || {};
  let T = null, me = null, opened = {};

  const clsMeta = (c) => [c.teacher, c.total + " 人", c.pending ? c.pending + " 人等批准" : "", c.hw_mode ? "作业要" + (c.hw_mode === "photo" ? "拍照" : "交文件") : ""].filter(Boolean).join(" · ");
  const admins = (l) => (l || []).map((a) => esc(a.name) + (a.role === "owner" ? "（主）" : "")).join("、") || "还没有";
  const orgTabs = (scope, id, extra) => `<div class="tabs" data-otabs="${scope}|${id}">${["统计", "作息", "功能", "作业审核"].concat(extra ? [extra] : []).map((t, i) => `<button class="small" data-ot="${i}">${t}</button>`).join("")}</div><div class="pane" data-pane="${id}"></div>`;

  function classRows(list, opts) {
    return list.map((c) => `<div class="cls-row"><div class="grow"><b>${esc(c.name)}${c.nick ? "「" + esc(c.nick) + "」" : ""}</b> <span class="badge">${esc(c.code)}</span><div class="meta">${esc(clsMeta(c))}</div></div>
      <a class="btn small" href="class.html#c=${c.id}">成员 · 设置</a>${c.hw_mode ? `<button class="small" data-hwgo="${c.id}">作业审核</button>` : ""}</div>`).join("") || `<div class="empty">还没有班级</div>`;
  }

  function schoolCard(s) {
    const owner = s.role === "owner";
    return `<section class="card" data-sid="${s.id}"><h2>🏫 ${esc(s.name)} <span class="badge mon">${owner ? "学校主管理员" : "学校管理员"}</span></h2>
      <div class="codebox"><span class="pill">学校码</span><span class="code">${esc(s.code)}</span><span class="pill">班主任在自己的班上填学校码就能加进来；院系主管理员填学校码把院系并进来</span>${owner ? `<button class="small" data-reset="${s.id}">换一个</button>` : ""}</div>
      <div class="desc">管理员：${admins(s.admins)}</div>
      ${orgTabs("school", s.id, "管理员")}
      <h3>院系（${(s.depts || []).length}）</h3>
      <div class="row"><input placeholder="新院系名称，如 计算机学院" data-nd="${s.id}" size="18"><input placeholder="院系管理员账号或邮箱（可不填）" data-nda="${s.id}" size="20"><button class="primary small" data-ndgo="${s.id}">建院系</button>
        <input placeholder="已有院系的院系码" data-lk="${s.id}" size="12"><button class="small" data-lkgo="${s.id}">并进来</button></div>
      ${(s.depts || []).map((d) => `<details class="dp"${opened[d.id] ? " open" : ""} data-dp="${d.id}"><summary>${esc(d.name)} <span class="badge">院系码 ${esc(d.code)}</span><span class="pill">${(d.classes || []).length} 个班 · 管理员 ${admins(d.admins)}</span></summary>
        ${(d.invites || []).length ? `<div class="pill">已邀请：${d.invites.map(esc).join("、")}（等班主任同意）</div>` : ""}
        ${classRows(d.classes || [])}
        <div class="row" style="margin-top:8px"><input placeholder="班级码" data-ic="${d.id}" size="8"><button class="small" data-igo="${d.id}">邀请班级加入</button>
          <input placeholder="账号或邮箱" data-da="${d.id}" size="14"><button class="small" data-dago="${d.id}" data-school="1">设院系管理员</button>
          <button class="small danger" data-unl="${d.id}">移出学校</button></div>
        ${orgTabs("dept", d.id)}</details>`).join("")}
    </section>`;
  }
  function deptCard(d) {
    return `<section class="card" data-did="${d.id}"><h2>🏛 ${esc(d.name)} <span class="badge">${d.school ? esc(d.school.name) : "还没并进学校"}</span></h2>
      <div class="codebox"><span class="pill">院系码</span><span class="code">${esc(d.code)}</span><span class="pill">班主任在自己的班上填院系码就能加进来</span></div>
      <div class="desc">管理员：${admins(d.admins)}</div>
      ${!d.school && d.role === "owner" ? `<div class="row"><input placeholder="学校码" data-jc="${d.id}" size="10"><button class="small" data-jgo="${d.id}">并进学校</button></div>` : ""}
      ${(d.invites || []).length ? `<div class="pill">已邀请：${d.invites.map(esc).join("、")}（等班主任同意）</div>` : ""}
      ${classRows(d.classes || [])}
      <div class="row" style="margin-top:8px"><input placeholder="班级码" data-ic="${d.id}" size="8"><button class="small" data-igo="${d.id}">邀请班级加入</button>
        ${d.role === "owner" ? `<input placeholder="账号或邮箱" data-da="${d.id}" size="14"><button class="small" data-dago="${d.id}">加院系管理员</button>` : ""}</div>
      ${orgTabs("dept", d.id)}</section>`;
  }
  function myClassCard(c) {
    return `<div class="cls-row" data-cid="${c.id}"><div class="grow"><b>${esc(c.name)}${c.nick ? "「" + esc(c.nick) + "」" : ""}</b> <span class="badge">${c.my_role === "monitor" ? "我是班委" : "班主任"}</span> <span class="badge">班级码 ${esc(c.code)}</span>
        <div class="meta">${esc(clsMeta(c))}</div>
        ${(c.invites || []).map((v) => `<div class="inv">${esc((v.school ? v.school + " · " : "") + v.dept)} 邀请这个班加入${v.by ? "（" + esc(v.by) + "）" : ""}<span class="spacer"></span>
          <button class="small" data-inv="${c.id}|${v.dept_id}|0">拒绝</button><button class="small primary" data-inv="${c.id}|${v.dept_id}|1" data-n="${esc(v.dept)}">同意</button></div>`).join("")}
        <div class="org-line">${c.dept ? `所属：${esc((c.dept.school ? c.dept.school + " · " : "") + c.dept.name)}${c.mine ? ` <button class="small" data-leave="${c.id}">移出</button>` : ""}`
          : `还没加入院系 / 学校${c.mine ? ` <input placeholder="院系码或学校码" data-jo="${c.id}" size="12"><button class="small primary" data-jogo="${c.id}">加入</button>` : ""}`}</div></div>
      <a class="btn small" href="class.html#c=${c.id}">成员 · 功能 · 设置</a>${c.hw_mode ? `<button class="small" data-hwgo="${c.id}">作业审核</button>` : ""}</div>`;
  }
  function moreCard() {
    if (!(T.can_dept || T.site_admin)) return `<section class="card"><h2>还没有管理的班级</h2><div class="desc">老师建班后把你设成班委，这里就会出现。想加入班级请点右上角「加入班级」。</div></section>`;
    const ap = (T.applies || []).filter((a) => a.status === "pending" || Date.now() - Date.parse(a.at) < 7 * 864e5);
    return `<section class="card"><h2>➕ 新建</h2>
      <h3>新建班级</h3><div class="row"><input placeholder="班级名称，如 计科2501" id="ncName" size="18"><button class="primary" id="ncGo">建班</button></div>
      ${T.can_dept ? `<h3>新建院系（学校还没开通也能先建，以后再并进学校）</h3><div class="row"><input placeholder="院系名称，如 计算机学院" id="ndName" size="18"><button id="ndGo">建院系</button></div>` : ""}
      <h3>${T.site_admin ? "开通学校" : "申请开通学校"}</h3>
      <div class="row"><input placeholder="学校全称，如 西安交通大学（不要写简称）" id="nsName" size="28" maxlength="40">
        ${T.site_admin ? `<input placeholder="主管理员账号或邮箱（不填就是你）" id="nsOwner" size="20">` : `<input placeholder="联系方式（手机号或邮箱）" id="nsContact" size="18"><input placeholder="说明（可不填）" id="nsNote" size="18">`}
        <button class="primary" id="nsGo">${T.site_admin ? "开通" : "提交申请"}</button></div>
      <div id="nsSugg"></div>
      ${ap.map((a) => `<div class="pill">开通申请「${esc(a.name)}」：${a.status === "pending" ? "审核中" : a.status === "approved" ? "已开通 ✓" : "没通过" + (a.note ? "：" + esc(a.note) : "")}</div>`).join("")}
    </section>`;
  }

  async function load() {
    try { T = await rpc("org_tree"); }
    catch (e) { $("root").innerHTML = `<section class="card"><h2>管理中心暂未开通</h2><div class="desc">${/org_tree|PGRST202|Could not find/.test(e.message) ? "请联系网站管理员" : esc(e.message)}</div></section>`; return; }
    const p = [];
    if (T.site_admin) p.push(`<a class="mg-site" href="admin.html"><span style="font-size:22px">🛡</span><span><b>站长后台</b><small>开通学校、审核申请、全站概况、高峰节流、用户与身份</small></span><span class="go">›</span></a>`);
    (T.schools || []).forEach((s) => p.push(schoolCard(s)));
    if ((T.depts || []).length) { p.push(`<div class="sec-t">🏛 我管理的院系</div>`); T.depts.forEach((d) => p.push(deptCard(d))); }
    p.push(`<div class="sec-t">👩‍🏫 我的班级</div><section class="card">${(T.classes || []).map(myClassCard).join("") || `<div class="empty">还没有自己的班。</div>`}</section>`);
    p.push(moreCard());
    $("root").innerHTML = p.join("");
    bind();
  }

  function bind() {
    const R = $("root"), val = (sel) => { const el = R.querySelector(sel); return el ? el.value.trim() : ""; };
    const act = (sel, fn) => R.querySelectorAll(sel).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { fail(e); } b.disabled = false; }));
    // 统计 / 作息 / 功能 / 作业审核 / 管理员
    R.querySelectorAll("[data-otabs]").forEach((box) => {
      const [scope, id] = box.dataset.otabs.split("|"), pane = R.querySelector(`[data-pane="${id}"]`);
      box.querySelectorAll("[data-ot]").forEach((b) => (b.onclick = () => {
        const i = +b.dataset.ot, on = b.classList.contains("on");
        box.querySelectorAll("[data-ot]").forEach((x) => x.classList.remove("on"));
        if (on) { pane.innerHTML = ""; return; }
        b.classList.add("on");
        if (i === 0) O().showStats(pane, scope, id, 7);
        else if (i === 1) O().showSched(pane, scope, id);
        else if (i === 2) O().showFeat(pane, scope, id);
        else if (i === 3) {
          if (scope === "dept") O().showHw(pane, id);
          else { const s = T.schools.find((x) => x.id === id); pane.innerHTML = `<div class="desc">在下面的院系里展开「作业审核」，给每个班单独打开。</div>` + (s.depts || []).map((d) => `<div class="row" style="margin:6px 0"><b>${esc(d.name)}</b><button class="small" data-hwd="${d.id}">设置</button></div><div data-hwbox="${d.id}"></div>`).join("");
            pane.querySelectorAll("[data-hwd]").forEach((x) => (x.onclick = () => O().showHw(pane.querySelector(`[data-hwbox="${x.dataset.hwd}"]`), x.dataset.hwd))); }
        } else adminPane(pane, T.schools.find((x) => x.id === id));
      }));
    });
    R.querySelectorAll("details.dp").forEach((d) => d.addEventListener("toggle", () => { opened[d.dataset.dp] = d.open; }));
    // 学校
    act("[data-reset]", async (b) => { if (!confirm("换一个学校码？旧的码马上失效。")) return; await rpc("school_code_reset", { sid: b.dataset.reset }); load(); });
    act("[data-ndgo]", async (b) => { const sid = b.dataset.ndgo; await rpc("school_dept_create", { sid, p_name: val(`[data-nd="${sid}"]`), p_admin: val(`[data-nda="${sid}"]`) || null }); toast("院系建好了"); load(); });
    act("[data-lkgo]", async (b) => { const sid = b.dataset.lkgo; const r = await rpc("school_dept_link", { sid, p_dept_code: val(`[data-lk="${sid}"]`) }); toast(r.already ? "已经在学校里了" : "「" + r.name + "」并进来了"); load(); });
    act("[data-unl]", async (b) => { if (!confirm("把这个院系移出学校？院系和里面的班不会删。")) return; await rpc("school_dept_unlink", { did: b.dataset.unl }); load(); });
    // 院系
    act("[data-igo]", async (b) => { const did = b.dataset.igo; const r = await rpc("dept_class_invite", { p_did: did, p_class_code: val(`[data-ic="${did}"]`) });
      toast(r.linked ? "「" + r.class + "」已加入" : r.already ? "已经在这个院系里了" : "邀请已发给「" + r.class + "」的班主任，同意后就加进来"); load(); });
    act("[data-dago]", async (b) => { const did = b.dataset.dago, a = val(`[data-da="${did}"]`); const r = await rpc(b.dataset.school ? "school_dept_admin_add" : "dept_admin_add", { did, p_account: a }); toast("已设 " + ((r && r.name) || a)); load(); });
    act("[data-jgo]", async (b) => { const did = b.dataset.jgo; const r = await rpc("dept_join_school", { did, p_school_code: val(`[data-jc="${did}"]`) }); toast("已并进「" + r.name + "」"); load(); });
    // 我的班
    act("[data-jogo]", async (b) => {
      const cid = b.dataset.jogo, code = val(`[data-jo="${cid}"]`);
      let r = await rpc("class_org_join", { p_cid: cid, p_code: code });
      if (r && r.need_dept) {
        if (!(r.depts || []).length) { alert("「" + r.school + "」还没有建院系，请学校管理员先建院系。"); return; }
        const pick = prompt("「" + r.school + "」的院系：\n" + r.depts.map((d, i) => (i + 1) + ". " + d.name).join("\n") + "\n\n填序号：", "1");
        const d = r.depts[(+pick || 0) - 1]; if (!d) return;
        r = await rpc("class_org_join", { p_cid: cid, p_code: code, p_did: d.id });
      }
      toast(r.already ? "已经在「" + r.name + "」里了" : "已加入「" + r.name + "」"); load();
    });
    act("[data-leave]", async (b) => { if (!confirm("把这个班移出院系？班级本身不受影响。")) return; await rpc("dept_class_unlink", { cid: b.dataset.leave }); load(); });
    act("[data-inv]", async (b) => { const [cid, did, ok] = b.dataset.inv.split("|");
      if (ok === "1" && !confirm("同意后，「" + b.dataset.n + "」的管理员能管理这个班（发布事项、看统计、管签到和成员）。同意吗？")) return;
      await rpc("class_invite_answer", { p_cid: cid, p_did: did, p_ok: ok === "1" }); toast(ok === "1" ? "已加入" : "已拒绝"); load(); });
    act("[data-hwgo]", async () => { alert("作业审核（看照片、通过、退回）请在微信小程序「作业 → 作业审核」里操作，手机上看照片更方便。"); });
    // 新建
    const ncGo = $("ncGo"); if (ncGo) act("#ncGo", async () => { const n = val("#ncName"); if (!n) throw new Error("先写班级名称"); const r = await rpc("create_class", { cname: n }); alert("「" + (r.name || n) + "」建好了，班级码 " + r.code); load(); });
    const ndGo = $("ndGo"); if (ndGo) act("#ndGo", async () => { await rpc("dept_create", { p_name: val("#ndName"), p_org: null }); toast("院系建好了"); load(); });
    const ns = $("nsName");
    if (ns) {
      let t = 0, sugg = [];
      ns.oninput = () => { clearTimeout(t); const q = ns.value.trim(); if (q.length < 2) { $("nsSugg").innerHTML = ""; sugg = []; return; }
        t = setTimeout(async () => { try { sugg = (await rpc("school_suggest", { p_q: q })) || []; } catch (e) { sugg = []; }
          if (ns.value.trim() !== q) return;
          $("nsSugg").innerHTML = sugg.length ? `<div class="sugg">已经开通的学校：${sugg.map((s) => `<div class="${s.same ? "same" : ""}">${esc(s.name)} · ${s.depts} 个院系${(s.admins || []).length ? " · 管理员 " + esc(s.admins.join("、")) : ""}${s.same ? "（已开通，请向管理员要学校码，不用再开通）" : ""}</div>`).join("")}</div>`
            : `<div class="pill" style="margin-top:6px">没有找到同名的学校，可以开通 ✓</div>`; }, 350); };
      act("#nsGo", async () => {
        const name = ns.value.trim();
        if (name.length < 2) throw new Error("请填写学校全称，比如「西安交通大学」");
        if (sugg.some((s) => s.same)) throw new Error("「" + name + "」已经开通了，请联系它的管理员要学校码");
        if (T.site_admin) { const r = await rpc("school_create", { p_name: name, p_owner: val("#nsOwner") || me.account }); alert("「" + r.name + "」开通好了，学校码 " + r.code + "，主管理员 " + r.owner); }
        else { await rpc("school_apply", { p_name: name, p_contact: val("#nsContact"), p_note: val("#nsNote") || null }); alert("申请已提交，站长审核通过后你就是这个学校的管理员。"); }
        load();
      });
    }
  }
  function adminPane(pane, s) {
    pane.innerHTML = `<div class="chips">${(s.admins || []).map((a) => `<span class="chip${a.role === "owner" ? " lead" : ""}">${esc(a.name)} <span class="pill">${esc(a.account || "")}</span>${a.role === "owner" ? " <b>主</b>" : ""}${s.role === "owner" && a.role !== "owner" ? `<button data-arm="${a.user_id}">✕</button>` : ""}</span>`).join("")}</div>
      ${s.role === "owner" ? `<div class="row" style="margin-top:10px"><input placeholder="账号或邮箱" data-aadd size="18"><button class="primary small" data-aaddgo>加为学校管理员</button></div>` : ""}
      <div class="desc" style="margin-top:8px">学校管理员能管全校的院系、作息、功能、统计、作业审核，对每个院系都有院系管理员的权限。主管理员还能加减管理员、换学校码。</div>`;
    const go = pane.querySelector("[data-aaddgo]"); if (go) go.onclick = async () => { try { const r = await rpc("school_admin_add", { sid: s.id, p_account: pane.querySelector("[data-aadd]").value }); toast("已加 " + r.name); load(); } catch (e) { fail(e); } };
    pane.querySelectorAll("[data-arm]").forEach((b) => (b.onclick = async () => { if (!confirm("移除这位管理员？")) return; try { await rpc("school_admin_remove", { sid: s.id, uid: b.dataset.arm }); load(); } catch (e) { fail(e); } }));
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
