// 7.30 学校管理（网站）：网站管理员开通学校、审核申请；学校管理员管院系、管理员、作息、功能、统计；院系管理员管本系
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rpc = (fn, a) => CCAuth.rpc(fn, a || {});
  let toastT = 0;
  function toast(msg, err) { const t = $("toast"); t.textContent = msg; t.className = "show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), 2600); }
  const fail = (e) => toast((e && e.message) || "没成功", true);
  const pct = (v) => (v == null ? "—" : v + "%");
  const fmt = (t) => { if (!t) return ""; const d = new Date(t); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const SEASON = { winter: "冬春季", summer: "夏秋季" };
  let roles = null, schools = [], view = {};   // view[key] = 当前打开的标签

  async function load() {
    try { roles = await rpc("org_my_roles"); } catch (e) {
      $("root").innerHTML = `<section class="card"><h2>学校管理暂未开通</h2><div class="desc">${esc(e.message)}（请联系网站管理员）</div></section>`; return;
    }
    try { schools = roles.schools && roles.schools.length ? (await rpc("school_mine")) || [] : []; } catch (e) { schools = []; }
    render();
  }

  // ---------- 统计 ----------
  function statsHtml(r, kind) {
    const t = (r && r.total) || {};
    const rows = (r && r.rows) || [];
    return `<div class="stats">
      ${kind === "school" ? `<div class="stat"><b>${t.depts || 0}</b><span>院系</span></div>` : ""}
      <div class="stat"><b>${t.classes || 0}</b><span>班级</span></div>
      <div class="stat"><b>${t.members || 0}</b><span>学生</span></div>
      <div class="stat"><b>${t.active || 0}</b><span>${r.days} 天内用过</span></div>
      <div class="stat"><b>${t.items || 0}</b><span>发布的事项</span></div>
      <div class="stat"><b>${pct(t.hw_rate)}</b><span>作业完成率（${t.hw || 0} 项）</span></div>
      <div class="stat"><b>${pct(t.ck_rate)}</b><span>签到率（${t.checkins || 0} 次）</span></div>
      <div class="stat"><b>${t.leaves || 0}</b><span>请假（待批 ${t.leave_pending || 0}）</span></div></div>
      <div class="tbl-wrap"><table class="st"><thead><tr><th>${kind === "school" ? "院系" : "班级"}</th>${kind === "dept" ? "<th>班主任</th>" : "<th>班级</th>"}<th>学生</th><th>用过</th><th>事项</th><th>作业完成</th><th>签到率</th><th>请假</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(x.name)}</td>${kind === "dept" ? `<td>${esc(x.teacher || "")}</td>` : `<td>${x.classes || 0}</td>`}<td>${x.members || 0}</td><td>${x.active || 0}</td><td>${x.items || 0}</td><td>${pct(x.hw_rate)}</td><td>${pct(x.ck_rate)}</td><td>${x.leaves || 0}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">还没有数据</td></tr>`}
      </tbody></table></div><div class="pill">统计于 ${fmt(r.at)}（10 分钟内的结果会直接用，避免拖慢系统）</div>`;
  }
  async function showStats(box, kind, id, days, fresh) {
    box.innerHTML = `<div class="empty">正在统计…</div>`;
    try {
      const r = await rpc(kind === "school" ? "school_stats" : "dept_stats", kind === "school" ? { sid: id, p_days: days, p_fresh: !!fresh } : { did: id, p_days: days, p_fresh: !!fresh });
      box.innerHTML = `<div class="row"><select data-sdays>${[7, 30, 90].map((d) => `<option value="${d}"${d === days ? " selected" : ""}>最近 ${d} 天</option>`).join("")}</select><button class="small" data-sfresh>重新统计</button></div>` + statsHtml(r, kind);
      box.querySelector("[data-sdays]").onchange = (e) => showStats(box, kind, id, +e.target.value);
      box.querySelector("[data-sfresh]").onclick = () => showStats(box, kind, id, days, true);
    } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- 作息 ----------
  // 7.38 作息：一节一节选时间（第 1 节 08:00–08:45 …），保存后本校 / 本系同学的课程表自动用这套
  async function showSched(box, scope, id, parentName) {
    box.innerHTML = `<div class="empty">加载中…</div>`;
    let cur = null; try { cur = await rpc("org_schedule_get", { p_scope: scope, p_id: id }); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const d = (cur && cur.data) || {};
    const DEF = ["08:00-08:45", "08:55-09:40", "10:00-10:45", "10:55-11:40", "14:00-14:45", "14:55-15:40", "16:00-16:45", "16:55-17:40", "19:00-19:45", "19:55-20:40"];
    const S = { winter: (d.winter && d.winter.length ? d.winter : DEF).slice(), summer: (d.summer && d.summer.length ? d.summer : (d.winter && d.winter.length ? d.winter : DEF)).slice(), two: !!(d.summer && d.summer.length), se: "winter" };
    const addMin = (t, n) => { const m = (+t.slice(0, 2)) * 60 + (+t.slice(3)) + n; return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
    const draw = () => {
      const rows = S[S.se];
      box.innerHTML = `<div class="desc">${scope === "dept" ? `不设置就用${esc(parentName || "学校")}的作息；设置了就用院系的。` : "全校默认的作息；某个院系（比如在分校区）可以另设一套。"}保存后，同学的课程表会自动按这里的时间上下课（同学自己改过的不受影响）。</div>
        <label class="row"><input type="checkbox" data-two${S.two ? " checked" : ""}> 分冬春季、夏秋季两套（夏天下午上课晚一些的学校打开）</label>
        ${S.two ? `<div class="tabs"><button class="small${S.se === "winter" ? " on" : ""}" data-se="winter">冬春季</button><button class="small${S.se === "summer" ? " on" : ""}" data-se="summer">夏秋季</button></div>` : ""}
        <table class="feat" style="max-width:420px"><tbody>${rows.map((t, i) => `<tr><td style="width:70px;color:var(--sub)">第 ${i + 1} 节</td><td style="text-align:left;width:auto"><input type="time" data-s="${i}" value="${t.split("-")[0]}"> – <input type="time" data-e="${i}" value="${t.split("-")[1]}"></td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin:8px 0"><button class="small" data-add>＋ 加一节</button><button class="small" data-del>去掉最后一节</button></div>
        <div class="row">${S.two ? `<label>夏秋季从 <input data-k="summer_from" placeholder="05-01" value="${esc(d.summer_from || "05-01")}" size="6"></label><label>冬春季从 <input data-k="winter_from" placeholder="10-01" value="${esc(d.winter_from || "10-01")}" size="6"></label>` : ""}
          <label>开学第一周的周一 <input type="date" data-k="week1" value="${esc(d.week1 || "")}"></label>
          <label>学期 <input data-k="semester" placeholder="2026-2027 第一学期" value="${esc(d.semester || "")}" size="18"></label></div>
        <div class="row" style="margin-top:10px"><button class="primary" data-save>保存作息</button>${cur ? `<button class="danger" data-clear>${scope === "dept" ? "不另设，用学校的" : "清空"}</button>` : ""}<span class="pill">${cur ? "上次修改 " + fmt(cur.at) : "还没有设置"}</span></div>`;
      const keep = () => { ["summer_from", "winter_from", "week1", "semester"].forEach((k) => { const el = box.querySelector(`[data-k="${k}"]`); if (el) d[k] = el.value.trim(); }); };
      box.querySelectorAll("[data-s],[data-e]").forEach((el) => (el.onchange = () => {
        const i = +(el.dataset.s != null ? el.dataset.s : el.dataset.e), [s0, e0] = rows[i].split("-");
        let s1 = el.dataset.s != null ? el.value : s0, e1 = el.dataset.e != null ? el.value : e0;
        if (el.dataset.s != null && e1 <= s1) e1 = addMin(s1, 45);
        rows[i] = s1 + "-" + e1; keep(); draw();
      }));
      box.querySelector("[data-two]").onchange = (e) => { keep(); S.two = e.target.checked; if (!S.two) S.se = "winter"; draw(); };
      box.querySelectorAll("[data-se]").forEach((b) => (b.onclick = () => { keep(); S.se = b.dataset.se; draw(); }));
      box.querySelector("[data-add]").onclick = () => { if (rows.length >= 16) return toast("最多 16 节", true); const last = rows[rows.length - 1].split("-")[1], s1 = addMin(last, 10); rows.push(s1 + "-" + addMin(s1, 45)); keep(); draw(); };
      box.querySelector("[data-del]").onclick = () => { if (rows.length <= 4) return toast("至少 4 节", true); rows.pop(); keep(); draw(); };
      box.querySelector("[data-save]").onclick = async () => {
        keep();
        for (const se of S.two ? ["winter", "summer"] : ["winter"]) {
          const i = S[se].findIndex((t, j) => { const [a, b] = t.split("-"); return b <= a || (j > 0 && a < S[se][j - 1].split("-")[1]); });
          if (i >= 0) return toast((S.two ? (se === "winter" ? "冬春季" : "夏秋季") : "") + "第 " + (i + 1) + " 节时间不对：结束要晚于开始，也不能早于上一节下课", true);
        }
        const data = { winter: S.winter };
        if (S.two) { data.summer = S.summer; if (d.summer_from) data.summer_from = d.summer_from; if (d.winter_from) data.winter_from = d.winter_from; }
        if (d.week1) data.week1 = d.week1; if (d.semester) data.semester = d.semester;
        try { await rpc("org_schedule_set", { p_scope: scope, p_id: id, p_data: data }); toast("已保存，同学的课程表会自动用这套作息"); showSched(box, scope, id, parentName); } catch (e) { fail(e); }
      };
      const c = box.querySelector("[data-clear]");
      if (c) c.onclick = async () => { if (!confirm("确定？")) return; try { await rpc("org_schedule_set", { p_scope: scope, p_id: id, p_data: null }); toast("已清除"); showSched(box, scope, id, parentName); } catch (e) { fail(e); } };
    };
    draw();
  }

  // 7.38 请假：本校 / 本系最近 7 天的请假，点「去审批」打开那个班
  async function showLeave(box, scope, id) {
    box.innerHTML = `<div class="empty">加载中…</div>`;
    let r; try { r = await rpc("org_leaves", { p_scope: scope, p_id: id, p_days: 7 }); }
    catch (e) { box.innerHTML = `<div class="empty">${/org_leaves|PGRST202|Could not find/.test(e.message) ? "请假统计暂未开通（要先执行 7.38 SQL）" : esc(e.message)}</div>`; return; }
    const ST = { pending: ["待批", "wait"], approved: ["已批", "ok"], rejected: ["没批", ""] }, day = (t) => (t ? String(t).slice(5).replace("-", "/") : "");
    box.innerHTML = `<div class="stats"><div class="stat"><b>${r.today || 0}</b><span>今天请假</span></div><div class="stat"><b style="color:${r.pending ? "var(--orange)" : "inherit"}">${r.pending || 0}</b><span>等批准</span></div><div class="stat"><b>${r.total || 0}</b><span>7 天内</span></div></div>
      ${Object.keys(r.kinds || {}).length ? `<div class="pill">${Object.keys(r.kinds).map((k) => esc(k) + " " + r.kinds[k]).join(" · ")}</div>` : ""}
      <div class="tbl-wrap"><table class="st"><thead><tr><th>同学</th><th>班级</th><th>假别</th><th>日期</th><th>原因</th><th>状态</th></tr></thead><tbody>
      ${(r.rows || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.cls)}</td><td>${esc(x.kind)}</td><td>${day(x.from)}${x.to && x.to !== x.from ? "–" + day(x.to) : ""}</td><td style="text-align:left;white-space:normal">${esc(x.reason || "")}</td><td><span class="badge ${ST[x.status] ? ST[x.status][1] : ""}">${ST[x.status] ? ST[x.status][0] : esc(x.status)}</span></td></tr>`).join("") || `<tr><td colspan="6" class="empty">最近 7 天没有人请假</td></tr>`}</tbody></table></div>
      <div class="pill" style="margin-top:6px">批准、拒绝在班级的请假里操作（小程序「请假」页，或网页班级空间）</div>`;
  }

  // ---------- 功能 ----------
  async function showFeat(box, scope, id) {
    box.innerHTML = `<div class="empty">加载中…</div>`;
    let list; try { list = (await rpc("org_features_get", { p_scope: scope, p_id: id })) || []; } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    box.innerHTML = `<div class="desc">关掉后，${scope === "school" ? "全校" : "本院系"}所有班的老师、班委、学生都用不了这个功能（${scope === "school" ? "学校" : "院系"}管理员自己不受影响）。班级里还可以再单独关。</div>
      <table class="feat"><thead><tr><th>功能</th><th>开启</th></tr></thead><tbody>
      ${list.map((f) => `<tr><td><b>${esc(f.name)}</b><div class="pill">${esc(f.descr || "")}${f.site_off ? " · 全站已暂停" : ""}${f.school_off ? " · 学校已关闭" : ""}</div></td>
        <td><input type="checkbox" data-fk="${esc(f.key)}"${f.on ? " checked" : ""}${f.school_off ? " disabled" : ""}></td></tr>`).join("")}</tbody></table>`;
    box.querySelectorAll("[data-fk]").forEach((cb) => (cb.onchange = async () => {
      try { await rpc("org_feature_set", { p_scope: scope, p_id: id, p_key: cb.dataset.fk, p_on: cb.checked }); toast(cb.checked ? "已开启" : "已关闭"); }
      catch (e) { cb.checked = !cb.checked; fail(e); }
    }));
  }

  // ---------- 7.35 作业审核：给本系的班打开「作业要交证明」（默认关闭） ----------
  async function showHw(box, did) {
    box.innerHTML = `<div class="empty">加载中…</div>`;
    let list; try { list = (await rpc("dept_hw_proof", { p_did: did })) || []; }
    catch (e) { box.innerHTML = `<div class="empty">${/dept_hw_proof|PGRST202|Could not find/.test(e.message) ? "作业审核暂未开通，请联系管理员" : esc(e.message)}</div>`; return; }
    const M = [["off", "关闭"], ["photo", "只要照片"], ["file", "照片或文件（可混着交）"]];
    box.innerHTML = `<div class="desc">默认关闭。打开后，这个班的同学在小程序里给作业打勾时，要先拍照或交文件（照片、PDF、Word），班主任、加入这个班的老师和院系管理员在小程序「作业 → 作业审核」里通过或退回，通过了才算完成。</div>
      <table class="feat"><thead><tr><th>班级</th><th>要求</th><th>待审核</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td><select data-hw="${c.id}">${M.map(([k, t]) => `<option value="${k}"${c.mode === k ? " selected" : ""}>${t}</option>`).join("")}</select></td>
        <td>${c.mode === "off" && !c.pending ? "—" : c.pending + " 份"}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">这个院系还没有班级</td></tr>`}</tbody></table>`;
    box.querySelectorAll("[data-hw]").forEach((sel) => {
      const was = sel.value;
      sel.onchange = async () => {
        if (sel.value !== "off" && !confirm("打开后，这个班的同学交作业要先" + (sel.value === "photo" ? "拍照" : "交照片或文件（可以混着交）") + "，老师审核通过才算完成。确定打开？")) { sel.value = was; return; }
        try { await rpc("hw_proof_set", { p_cid: sel.dataset.hw, p_mode: sel.value }); toast(sel.value === "off" ? "已关闭" : "已打开"); }
        catch (e) { sel.value = was; fail(e); }
      };
    });
  }

  // ---------- 学校 ----------
  function schoolHtml(s) {
    const owner = s.role === "owner";
    return `<section class="card" data-sid="${s.id}"><h2>🏫 ${esc(s.name)} <span class="badge mon">${owner ? "主管理员" : "管理员"}</span></h2>
      <div class="codebox"><span class="pill">学校码</span><span class="code">${esc(s.code)}</span><span class="pill">院系的主管理员在「院系」里输入学校码，就能把已有院系并进来</span>${owner ? `<button class="small" data-reset>换一个</button>` : ""}</div>
      <div class="tabs">${["院系", "统计", "作息", "功能", "管理员"].map((t, i) => `<button class="small${(view[s.id] || 0) === i ? " on" : ""}" data-tab="${i}">${t}</button>`).join("")}</div>
      <div data-pane></div></section>`;
  }
  function deptRows(s) {
    return (s.depts || []).map((d) => `<div class="item"><div class="grow"><b>${esc(d.name)}</b> <span class="pill">院系码 ${esc(d.code)} · ${d.classes} 个班</span>
        <div class="chips">${(d.admins || []).map((a) => `<span class="chip${a.role === "owner" ? " lead" : ""}">${esc(a.name)}${a.role === "owner" ? " <b>主</b>" : ""}<button data-drm="${d.id}|${a.user_id}" title="移除">✕</button></span>`).join("") || `<span class="pill">还没有院系管理员</span>`}</div></div>
        <input placeholder="账号或邮箱" data-dadd-in="${d.id}" size="14"><button class="small" data-dadd="${d.id}">设为院系管理员</button>
        <button class="small" data-dstat="${d.id}">统计</button><button class="small" data-dhw="${d.id}">作业审核</button><button class="small danger" data-dunlink="${d.id}">移出学校</button>
        <div class="dbox" data-dbox="${d.id}" style="width:100%"></div></div>`).join("") || `<div class="empty">还没有院系。</div>`;
  }
  function bindSchool(sec, s) {
    const pane = sec.querySelector("[data-pane]");
    const tab = (i) => {
      view[s.id] = i; sec.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", +b.dataset.tab === i));
      if (i === 0) {
        pane.innerHTML = `<div class="row"><input placeholder="新院系名称，如 计算机学院" data-nd size="18"><input placeholder="院系管理员的账号或邮箱（可不填）" data-nda size="22"><button class="primary" data-ndgo>建院系</button></div>
          <div class="row" style="margin-top:8px"><input placeholder="已有院系的院系码" data-lk size="12"><button data-lkgo>把已有院系并进来</button></div>${deptRows(s)}`;
        pane.querySelector("[data-ndgo]").onclick = async () => { try { await rpc("school_dept_create", { sid: s.id, p_name: pane.querySelector("[data-nd]").value, p_admin: pane.querySelector("[data-nda]").value }); toast("院系建好了"); load(); } catch (e) { fail(e); } };
        pane.querySelector("[data-lkgo]").onclick = async () => { try { const r = await rpc("school_dept_link", { sid: s.id, p_dept_code: pane.querySelector("[data-lk]").value }); toast(r.already ? "已经在学校里了" : "「" + r.name + "」并进来了"); load(); } catch (e) { fail(e); } };
        pane.querySelectorAll("[data-dadd]").forEach((b) => (b.onclick = async () => { const did = b.dataset.dadd; try { const r = await rpc("school_dept_admin_add", { did, p_account: pane.querySelector(`[data-dadd-in="${did}"]`).value }); toast("已设 " + r.name + " 为院系管理员"); load(); } catch (e) { fail(e); } }));
        pane.querySelectorAll("[data-drm]").forEach((b) => (b.onclick = async () => { const [did, uid] = b.dataset.drm.split("|"); if (!confirm("移除这位院系管理员？")) return; try { await rpc("school_dept_admin_remove", { did, uid }); load(); } catch (e) { fail(e); } }));
        pane.querySelectorAll("[data-dunlink]").forEach((b) => (b.onclick = async () => { if (!confirm("把这个院系移出学校？院系和里面的班不会删，只是不再归学校管。")) return; try { await rpc("school_dept_unlink", { did: b.dataset.dunlink }); load(); } catch (e) { fail(e); } }));
        pane.querySelectorAll("[data-dstat]").forEach((b) => (b.onclick = () => showStats(pane.querySelector(`[data-dbox="${b.dataset.dstat}"]`), "dept", b.dataset.dstat, 7)));
        pane.querySelectorAll("[data-dhw]").forEach((b) => (b.onclick = () => showHw(pane.querySelector(`[data-dbox="${b.dataset.dhw}"]`), b.dataset.dhw)));
      } else if (i === 1) showStats(pane, "school", s.id, 7);
      else if (i === 2) showSched(pane, "school", s.id);
      else if (i === 3) showFeat(pane, "school", s.id);
      else {
        pane.innerHTML = `<div class="chips">${(s.admins || []).map((a) => `<span class="chip${a.role === "owner" ? " lead" : ""}">${esc(a.name)} <span class="pill">${esc(a.account || "")}</span>${a.role === "owner" ? " <b>主</b>" : ""}<button data-arm="${a.user_id}">✕</button></span>`).join("")}</div>
          ${s.role === "owner" ? `<div class="row" style="margin-top:10px"><input placeholder="账号或邮箱" data-aadd size="18"><button class="primary" data-aaddgo>加为学校管理员</button></div>` : ""}
          <div class="desc" style="margin-top:8px">学校管理员能管全校的院系、作息、功能、统计，对每个院系都有院系管理员的权限。主管理员还能加减管理员、换学校码。</div>`;
        const go = pane.querySelector("[data-aaddgo]"); if (go) go.onclick = async () => { try { const r = await rpc("school_admin_add", { sid: s.id, p_account: pane.querySelector("[data-aadd]").value }); toast("已加 " + r.name); load(); } catch (e) { fail(e); } };
        pane.querySelectorAll("[data-arm]").forEach((b) => (b.onclick = async () => { if (!confirm("移除这位管理员？")) return; try { await rpc("school_admin_remove", { sid: s.id, uid: b.dataset.arm }); load(); } catch (e) { fail(e); } }));
      }
    };
    sec.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => tab(+b.dataset.tab)));
    const rs = sec.querySelector("[data-reset]"); if (rs) rs.onclick = async () => { if (!confirm("换一个学校码？旧的码马上失效。")) return; try { await rpc("school_code_reset", { sid: s.id }); load(); } catch (e) { fail(e); } };
    tab(view[s.id] || 0);
  }

  // ---------- 院系（自己是院系管理员、不是通过学校管的） ----------
  function deptHtml(d) {
    return `<section class="card" data-did="${d.id}"><h2>🏛 ${esc(d.name)} <span class="badge">${d.school ? esc(d.school) : "还没并进学校"}</span></h2>
      ${d.school ? "" : d.role === "owner" ? `<div class="row"><input placeholder="学校码" data-jc size="10"><button data-jgo>并进学校</button><span class="pill">学校管理员在学校管理里能看到学校码</span></div>` : ""}
      <div class="tabs">${["统计", "作息", "功能", "作业审核"].map((t, i) => `<button class="small${(view[d.id] || 0) === i ? " on" : ""}" data-tab="${i}">${t}</button>`).join("")}</div><div data-pane></div>
      <div class="desc">建班、挂班、加院系管理员在「我的班级」页的院系里操作。</div></section>`;
  }
  function bindDept(sec, d) {
    const pane = sec.querySelector("[data-pane]");
    const tab = (i) => { view[d.id] = i; sec.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", +b.dataset.tab === i));
      if (i === 0) showStats(pane, "dept", d.id, 7); else if (i === 1) showSched(pane, "dept", d.id, d.school); else if (i === 2) showFeat(pane, "dept", d.id); else showHw(pane, d.id); };
    sec.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => tab(+b.dataset.tab)));
    const j = sec.querySelector("[data-jgo]"); if (j) j.onclick = async () => { try { const r = await rpc("dept_join_school", { did: d.id, p_school_code: sec.querySelector("[data-jc]").value }); toast("已并进「" + r.name + "」"); load(); } catch (e) { fail(e); } };
    tab(view[d.id] || 0);
  }

  // ---------- 网站管理员 ----------
  async function siteHtml() {
    let ap = [], all = [];
    try { ap = (await rpc("school_apply_list")) || []; } catch (e) {}
    try { all = (await rpc("school_all")) || []; } catch (e) {}
    return `<section class="card" id="siteBox"><h2>⚙️ 网站管理员：开通学校</h2>
      <div class="row"><input placeholder="学校全称" id="ncName" size="20"><input placeholder="学校管理员的账号或邮箱" id="ncOwner" size="22"><button class="primary" id="ncGo">直接开通</button></div>
      <h3>开通申请（${ap.filter((a) => a.status === "pending").length} 条待审核）</h3>
      ${ap.map((a) => `<div class="item"><div class="grow"><b>${esc(a.name)}</b> <span class="badge ${a.status === "pending" ? "wait" : a.status === "approved" ? "ok" : ""}">${{ pending: "待审核", approved: "已通过", rejected: "已拒绝" }[a.status]}</span>${a.exists ? ` <span class="pill">（这所学校已开通，通过后加为管理员）</span>` : ""}
          <div class="meta">${esc(a.who)}（${esc(a.account || "")}）· 联系方式 ${esc(a.contact)} · ${fmt(a.at)}</div>${a.note ? `<div class="meta">说明：${esc(a.note)}</div>` : ""}${a.review_note ? `<div class="meta">审核意见：${esc(a.review_note)}</div>` : ""}</div>
          ${a.proof ? `<img class="proof" src="${esc(a.proof)}" alt="证明材料" data-big>` : ""}
          ${a.status === "pending" ? `<button class="primary small" data-apok="${a.id}">通过</button><button class="small danger" data-apno="${a.id}">拒绝</button>` : ""}</div>`).join("") || `<div class="empty">没有申请。</div>`}
      <h3>已开通的学校（${all.length}）</h3>
      ${all.map((s) => `<div class="item"><div class="grow"><b>${esc(s.name)}</b> <span class="pill">学校码 ${esc(s.code)} · ${s.depts} 个院系 · ${s.classes} 个班</span><div class="meta">管理员：${(s.admins || []).map((a) => esc(a.name) + (a.role === "owner" ? "（主）" : "")).join("、") || "无"}</div></div></div>`).join("") || `<div class="empty">还没有。</div>`}</section>`;
  }
  function bindSite() {
    const go = $("ncGo"); if (!go) return;
    go.onclick = async () => { try { const r = await rpc("school_create", { p_name: $("ncName").value, p_owner: $("ncOwner").value }); toast("已开通「" + r.name + "」，学校码 " + r.code); load(); } catch (e) { fail(e); } };
    document.querySelectorAll("[data-apok]").forEach((b) => (b.onclick = async () => { try { await rpc("school_apply_review", { p_id: +b.dataset.apok, p_ok: true }); toast("已通过"); load(); } catch (e) { fail(e); } }));
    document.querySelectorAll("[data-apno]").forEach((b) => (b.onclick = async () => { const n = prompt("拒绝的原因（会告诉申请人）", ""); if (n === null) return; try { await rpc("school_apply_review", { p_id: +b.dataset.apno, p_ok: false, p_note: n }); toast("已拒绝"); load(); } catch (e) { fail(e); } }));
    document.querySelectorAll("[data-big]").forEach((im) => (im.onclick = () => window.open(im.src, "_blank")));
  }

  // ---------- 申请开通 ----------
  async function applyHtml() {
    let mine = []; try { mine = (await rpc("school_apply_mine")) || []; } catch (e) {}
    return `<section class="card"><h2>📝 申请开通学校</h2><div class="desc">学校的老师（教务处、学工处、院系负责人等）可以申请开通。通过后你就是这所学校的管理员，可以建院系、指定院系管理员、设置全校作息和功能、看全校统计。</div>
      <div class="row"><input id="apName" placeholder="学校全称" size="20"><input id="apContact" placeholder="手机号或邮箱" size="18"></div>
      <div class="row" style="margin-top:8px"><input id="apNote" placeholder="你的部门和职务（选填）" size="40"></div>
      <div class="row" style="margin-top:8px"><label class="pill">工作证 / 教师证照片（选填，加快审核）<input type="file" id="apFile" accept="image/*"></label><button class="primary" id="apGo">提交申请</button></div>
      ${mine.length ? `<h3>我的申请</h3>` + mine.map((a) => `<div class="item"><div class="grow"><b>${esc(a.name)}</b> <span class="badge ${a.status === "pending" ? "wait" : a.status === "approved" ? "ok" : ""}">${{ pending: "审核中", approved: "已通过", rejected: "未通过" }[a.status]}</span>${a.note ? `<div class="meta">${esc(a.note)}</div>` : ""}</div><span class="pill">${fmt(a.at)}</span></div>`).join("") : ""}</section>`;
  }
  function shrink(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader(); fr.onerror = () => rej(new Error("读不了这张图片"));
      fr.onload = () => { const im = new Image(); im.onerror = () => rej(new Error("读不了这张图片")); im.onload = () => {
        let w = im.width, h = im.height; const k = Math.min(1, 1400 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(im, 0, 0, w, h);
        for (const q of [0.8, 0.6, 0.45, 0.3]) { const u = c.toDataURL("image/jpeg", q); if (u.length < 390000) { res(u); return; } }
        rej(new Error("图片太大了，换一张"));
      }; im.src = fr.result; };
      fr.readAsDataURL(file);
    });
  }
  function bindApply() {
    const go = $("apGo"); if (!go) return;
    go.onclick = async () => {
      go.disabled = true;
      try {
        const f = $("apFile").files[0], proof = f ? await shrink(f) : null;
        await rpc("school_apply", { p_name: $("apName").value, p_contact: $("apContact").value, p_note: $("apNote").value, p_proof: proof });
        toast("申请已提交，等网站管理员审核"); load();
      } catch (e) { fail(e); }
      go.disabled = false;
    };
  }

  async function render() {
    const parts = [];
    if (roles.site_admin) parts.push(await siteHtml());
    schools.forEach((s) => parts.push(schoolHtml(s)));
    const viaSchool = new Set(schools.flatMap((s) => (s.depts || []).map((d) => d.id)));
    const myDepts = (roles.depts || []).filter((d) => !viaSchool.has(d.id));
    myDepts.forEach((d) => parts.push(deptHtml(d)));
    if (!schools.length) parts.push(await applyHtml());
    $("root").innerHTML = parts.join("");
    bindSite(); bindApply();
    schools.forEach((s) => bindSchool(document.querySelector(`[data-sid="${s.id}"]`), s));
    myDepts.forEach((d) => bindDept(document.querySelector(`[data-did="${d.id}"]`), d));
  }

  // 7.36 管理中心（manage.html）直接用这里的统计 / 作息 / 功能 / 作业审核面板
  window.CCOrg = { showStats, showSched, showFeat, showHw, showLeave, shrink };
  (async () => {
    if (document.body.dataset.embed) return;
    const s = await CCAuth.session();
    if (!s) { location.href = "login.html?next=school.html"; return; }
    const me = await CCAuth.me().catch(() => null);
    if (!me) { location.href = "login.html?next=school.html"; return; }
    $("who").textContent = me.display_name || me.account || "";
    load();
  })();
})();
