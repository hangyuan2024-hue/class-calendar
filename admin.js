// 捞捞课程表 · 管理后台：概览、用户（服务器分页筛选、批量操作、详情）、批量建号、操作日志
// 数据接口都在 deploy/admin.sql（adm_*），每个接口在数据库里再检查一次权限
(function () {
  const { rpc, esc, ROLE_NAMES } = CCAuth;
  const $ = (id) => document.getElementById(id);
  let me = null, isAdmin = false;

  // ---------- 小工具 ----------
  function toast(msg, err) {
    const t = $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), err ? 5000 : 2800);
  }
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message || String(e), true); } finally { if (btn) btn.disabled = false; }
  }
  const TZ = "Asia/Shanghai";
  const fmt = (t, withTime = true) => t ? new Date(t).toLocaleString("zh-CN", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).replace(/\//g, "-") : "";
  function ago(t) {
    if (!t) return "";
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 120) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
    return fmt(t, false);
  }
  const n = (x) => Number(x || 0).toLocaleString("zh-CN");
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const roleTag = (r) => `<span class="tag ${esc(r)}">${esc(ROLE_NAMES[r] || r)}</span>`;
  // CSV：带 BOM（Excel 打开不乱码）；= + - @ 开头的加 '，防止被当成公式
  function csv(rows) {
    const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  }
  function download(name, text) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = () => fmt(new Date()).replace(/[-: ]/g, "").slice(0, 12);
  const chunk = (arr, k) => { const out = []; for (let i = 0; i < arr.length; i += k) out.push(arr.slice(i, i + k)); return out; };

  // ---------- 弹窗 ----------
  const dlg = $("dlg");
  function openDlg(html, wide) {
    dlg.className = "dlg" + (wide ? " wide" : ""); dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
    const f = dlg.querySelector("[autofocus]"); if (f) setTimeout(() => f.focus(), 30);
    return dlg;
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
  // 跳过的人和原因
  function skippedHtml(skipped, nameOf) {
    if (!skipped || !skipped.length) return "";
    return `<div class="sec">没处理的 ${skipped.length} 人</div><div class="list" style="max-height:200px;overflow:auto">${skipped.map((s) =>
      `<div class="it"><span>${esc(nameOf(s.id))}</span><span class="sp"></span><span class="muted">${esc(s.why)}</span></div>`).join("")}</div>`;
  }

  // ---------- 路由 ----------
  const VIEWS = ["ov", "users", "import", "audit"];
  let loaded = {};
  function show(v) {
    if (!VIEWS.includes(v)) v = "ov";
    document.querySelectorAll(".view").forEach((s) => s.classList.toggle("hidden", s.id !== "v-" + v));
    document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    $("bulk").classList.toggle("hidden", v !== "users" || !sel.size);
    if (!loaded[v]) { loaded[v] = true; ({ ov: loadOv, users: loadUsers, import: () => {}, audit: loadAudit })[v](); }
  }
  document.querySelectorAll(".nav").forEach((b) => b.onclick = () => { location.hash = b.dataset.view; });
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ================= 概览 =================
  async function loadOv() {
    const s = await busy(null, () => rpc("adm_stats")); if (!s) return;
    const K = [
      ["总用户", n(s.total), `今天新注册 ${n(s.today)}`, ""],
      ["7 天活跃", n(s.active7), `今天 ${n(s.active1)} · 30 天 ${n(s.active30)}`, "active7"],
      ["7 天新注册", n(s.new7), `30 天 ${n(s.new30)}`, ""],
      ["已禁用", n(s.banned), "点击查看名单", "banned"],
      ["待改初始密码", n(s.must_change), "导入 / 重置后还没登录改密码", "must_change"],
      ["班级", n(s.classes), `绑定微信 ${n(s.wx)} · 邮箱 ${n(s.email)}`, ""],
    ];
    $("kpis").innerHTML = K.map(([k, v, sub, go]) => `<div class="panel kpi"${go ? ` data-go="${go}" role="button" tabindex="0"` : ""}><div class="k">${k}</div><div class="v">${v}</div><div class="s">${esc(sub)}</div></div>`).join("");
    // 30 天柱状图
    const days = s.days || [], max = Math.max(1, ...days.map((d) => Math.max(d.n, d.a))), W = 600, H = 190, bw = W / days.length;
    const bars = days.map((d, i) => {
      const x = i * bw, hn = (d.n / max) * (H - 24), ha = (d.a / max) * (H - 24);
      return `<g><title>${d.d}：新注册 ${d.n}，活跃 ${d.a}</title>
        <rect x="${x + bw * .14}" y="${H - 18 - ha}" width="${bw * .34}" height="${ha}" rx="2" fill="#22b07d" opacity=".75"/>
        <rect x="${x + bw * .5}" y="${H - 18 - hn}" width="${bw * .34}" height="${hn}" rx="2" fill="var(--accent)"/>
        ${i % 5 === 0 || i === days.length - 1 ? `<text x="${i === 0 ? x + 1 : i === days.length - 1 ? x + bw - 1 : x + bw / 2}" y="${H - 4}" font-size="10" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}" fill="var(--faint)">${d.d}</text>` : ""}</g>`;
    }).join("");
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="最近 30 天新注册和活跃人数">
      <line x1="0" x2="${W}" y1="${H - 18}" y2="${H - 18}" stroke="var(--line)"/>${bars}
      <text x="2" y="10" font-size="10" fill="var(--faint)">${max}</text></svg>`;
    const roles = Object.entries(s.roles || {}).sort((a, b) => b[1] - a[1]);
    const rmax = Math.max(1, ...roles.map((r) => r[1]));
    $("roleBars").innerHTML = roles.map(([r, c]) => `<div class="row link" data-role="${esc(r)}"><span class="nm">${esc(ROLE_NAMES[r] || r)}</span><span class="tr"><i style="width:${(c / rmax) * 100}%"></i></span><span class="n">${n(c)}</span></div>`).join("");
    const orgs = (s.orgs || []).concat(s.org_none ? [{ name: "（没填）", n: s.org_none, none: true }] : []);
    const omax = Math.max(1, ...orgs.map((o) => o.n));
    $("orgBars").innerHTML = orgs.map((o) => `<div class="row link" data-org="${esc(o.none ? "-" : o.name)}"><span class="nm" title="${esc(o.name)}">${esc(o.name)}</span><span class="tr"><i style="width:${(o.n / omax) * 100}%"></i></span><span class="n">${n(o.n)}</span></div>`).join("") || `<div class="muted">还没有人填学校</div>`;
    const acc = [["7 天内活跃", s.active7, "active7"], ["30 天没来过", Math.max(0, s.total - s.active30), "idle30"], ["待改初始密码", s.must_change, "must_change"], ["已禁用", s.banned, "banned"]];
    $("accBars").innerHTML = acc.map(([k, c, st]) => `<div class="row link" data-status="${st}"><span class="nm">${k}</span><span class="tr"><i style="width:${(c / Math.max(1, s.total)) * 100}%"></i></span><span class="n">${n(c)}</span></div>`).join("");
  }
  $("ovRefresh").onclick = (e) => busy(e.currentTarget, loadOv);
  $("v-ov").addEventListener("click", (e) => {
    const k = e.target.closest("[data-go],[data-role],[data-org],[data-status]"); if (!k) return;
    resetFilters(false);
    if (k.dataset.go) F.status = k.dataset.go;
    if (k.dataset.status) F.status = k.dataset.status;
    if (k.dataset.role) F.role = k.dataset.role;
    if (k.dataset.org) F.org = k.dataset.org;
    syncFilterInputs(); loaded.users = true; location.hash = "users"; loadUsers();
  });
  $("v-ov").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-go]")) e.target.click(); });

  // ================= 用户 =================
  const F = { q: "", role: "", status: "all", org: "", cls: "", clsName: "", from: "", to: "", sort: "created", dir: "desc", page: 1, size: 50 };
  let rows = [], total = 0;
  const sel = new Map();   // id → { id, account, name, role }
  Object.entries(ROLE_NAMES).forEach(([k, v]) => { $("fRole").insertAdjacentHTML("beforeend", `<option value="${k}">${v}</option>`); });
  const STATUS_NAMES = { active7: "7 天内活跃", idle30: "30 天没来过", never: "从没登录过", banned: "已禁用", must_change: "待改初始密码", no_class: "没加入班级" };

  function resetFilters(reload = true) {
    Object.assign(F, { q: "", role: "", status: "all", org: "", cls: "", clsName: "", from: "", to: "", page: 1 });
    syncFilterInputs(); if (reload) loadUsers();
  }
  function syncFilterInputs() {
    $("fQ").value = F.q; $("fRole").value = F.role; $("fStatus").value = F.status; $("fOrg").value = F.org === "-" ? "（没填）" : F.org;
    $("fCls").value = F.clsName; $("fFrom").value = F.from; $("fTo").value = F.to; $("pSize").value = String(F.size);
  }
  function chips() {
    const c = [];
    if (F.q) c.push(["q", `搜索：${F.q}`]);
    if (F.role) c.push(["role", `身份：${ROLE_NAMES[F.role] || F.role}`]);
    if (F.status !== "all") c.push(["status", STATUS_NAMES[F.status]]);
    if (F.org) c.push(["org", `学校：${F.org === "-" ? "没填" : F.org}`]);
    if (F.cls) c.push(["cls", `班级：${F.clsName}`]);
    if (F.from || F.to) c.push(["date", `注册：${F.from || "…"} ~ ${F.to || "…"}`]);
    $("chips").innerHTML = c.map(([k, t]) => `<span class="chip">${esc(t)}<button type="button" data-unf="${k}" aria-label="去掉这个条件">×</button></span>`).join("");
    $("chips").classList.toggle("hidden", !c.length);
  }
  $("chips").onclick = (e) => {
    const b = e.target.closest("[data-unf]"); if (!b) return;
    const k = b.dataset.unf;
    if (k === "status") F.status = "all"; else if (k === "cls") { F.cls = ""; F.clsName = ""; } else if (k === "date") { F.from = ""; F.to = ""; } else F[k] = "";
    F.page = 1; syncFilterInputs(); loadUsers();
  };
  let reqNo = 0;
  async function loadUsers() {
    chips();
    const my = ++reqNo;
    $("uRows").innerHTML = `<tr><td colspan="9" class="empty"><div class="skel" style="width:50%;margin:0 auto"></div></td></tr>`;
    let r;
    try { r = await rpc("adm_users", { f: { ...F } }); }
    catch (e) { if (my === reqNo) $("uRows").innerHTML = `<tr><td colspan="9" class="empty">${esc(e.message)}</td></tr>`; return; }
    if (my !== reqNo) return;
    rows = r.rows || []; total = r.total || 0;
    renderUsers();
  }
  function seenHtml(t) {
    if (!t) return `<span class="seen old">从没登录</span>`;
    const h = (Date.now() - new Date(t).getTime()) / 3600000;
    return `<span class="seen ${h < 24 ? "on" : h > 24 * 30 ? "old" : ""}" title="${esc(fmt(t))}">${esc(ago(t))}</span>`;
  }
  function statusHtml(u) {
    return (u.banned ? `<span class="tag red" title="${esc(u.ban_reason || "")}">已禁用</span>` : "")
      + (u.must_change ? `<span class="tag warn">待改密码</span>` : "")
      + (u.wx ? `<span class="tag ok">微信</span>` : "") + (u.email ? `<span class="tag">邮箱</span>` : "");
  }
  function renderUsers() {
    const pages = Math.max(1, Math.ceil(total / F.size));
    $("uCount").textContent = `共 ${n(total)} 人` + (sel.size ? ` · 已选 ${n(sel.size)} 人` : "");
    $("uRows").innerHTML = rows.map((u) => `<tr data-id="${esc(u.id)}" class="${sel.has(u.id) ? "sel" : ""}">
      <td class="ck"><input type="checkbox" data-ck="${esc(u.id)}" ${sel.has(u.id) ? "checked" : ""} aria-label="选中 ${esc(u.name)}"></td>
      <td class="acc">${esc(u.account)}</td><td class="nm"><b>${esc(u.name)}</b>${u.gender === "f" ? ' <span class="faint">♀</span>' : u.gender === "m" ? ' <span class="faint">♂</span>' : ""}</td>
      <td>${roleTag(u.role)}</td><td class="org" title="${esc(u.org || "")}">${esc(u.org || "")}</td>
      <td class="cl" title="${esc((u.classes || []).join("、"))}">${esc((u.classes || []).join("、"))}</td>
      <td class="num muted">${esc(fmt(u.created, false))}</td><td>${seenHtml(u.seen)}</td><td>${statusHtml(u)}</td></tr>`).join("")
      || `<tr><td colspan="9" class="empty">没有符合条件的用户</td></tr>`;
    $("pInfo").textContent = total ? `第 ${n((F.page - 1) * F.size + 1)}–${n(Math.min(F.page * F.size, total))} 人，共 ${n(total)} 人` : "";
    $("pNo").value = F.page; $("pMax").textContent = pages;
    $("pPrev").disabled = F.page <= 1; $("pNext").disabled = F.page >= pages;
    document.querySelectorAll("#uTable th.sort").forEach((th) => th.className = "sort" + (th.dataset.sort === F.sort ? " " + F.dir : ""));
    const onPage = rows.filter((u) => sel.has(u.id)).length;
    $("ckPage").checked = rows.length > 0 && onPage === rows.length; $("ckPage").indeterminate = onPage > 0 && onPage < rows.length;
    // 本页全选了、还有别的页：提示可以选全部筛选结果
    const sa = $("selAll");
    if (rows.length && onPage === rows.length && total > rows.length && sel.size < total) {
      sa.innerHTML = `已选中本页 ${rows.length} 人。<button type="button" id="selAllBtn">选中全部 ${n(Math.min(total, 5000))} 个筛选结果</button>${total > 5000 ? "（一次最多 5000 人）" : ""}`;
      sa.classList.remove("hidden");
    } else if (sel.size > rows.length && sel.size >= Math.min(total, 5000) && total > rows.length) {
      sa.innerHTML = `已选中全部 ${n(sel.size)} 个筛选结果。<button type="button" id="selNone">取消选择</button>`; sa.classList.remove("hidden");
    } else sa.classList.add("hidden");
    renderBulk();
  }
  function renderBulk() {
    $("bulk").classList.toggle("hidden", !sel.size || !location.hash.match(/users/));
    $("bulkN").textContent = `已选 ${n(sel.size)} 人`;
    $("uCount").textContent = `共 ${n(total)} 人` + (sel.size ? ` · 已选 ${n(sel.size)} 人` : "");
  }
  const pick = (u) => ({ id: u.id, account: u.account, name: u.name, role: u.role });
  $("uRows").addEventListener("click", (e) => {
    const ck = e.target.closest("[data-ck]");
    if (ck) {
      const u = rows.find((x) => x.id === ck.dataset.ck); if (!u) return;
      if (ck.checked) sel.set(u.id, pick(u)); else sel.delete(u.id);
      ck.closest("tr").classList.toggle("sel", ck.checked); renderUsers(); return;
    }
    if (e.target.closest("td.ck")) return;
    const tr = e.target.closest("tr[data-id]"); if (tr) openUser(tr.dataset.id);
  });
  $("ckPage").onchange = (e) => { rows.forEach((u) => (e.target.checked ? sel.set(u.id, pick(u)) : sel.delete(u.id))); renderUsers(); };
  $("selAll").addEventListener("click", async (e) => {
    if (e.target.id === "selNone") { sel.clear(); renderUsers(); return; }
    if (e.target.id !== "selAllBtn") return;
    await busy(e.target, async () => {
      const r = await rpc("adm_users", { f: { ...F, page: 1, size: 5000, export: true } });
      (r.rows || []).forEach((u) => sel.set(u.id, pick(u))); renderUsers();
    });
  });
  document.querySelectorAll("#uTable th.sort").forEach((th) => th.onclick = () => {
    if (F.sort === th.dataset.sort) F.dir = F.dir === "asc" ? "desc" : "asc";
    else { F.sort = th.dataset.sort; F.dir = ["account", "name", "role", "org"].includes(F.sort) ? "asc" : "desc"; }
    F.page = 1; loadUsers();
  });
  $("pPrev").onclick = () => { if (F.page > 1) { F.page--; loadUsers(); } };
  $("pNext").onclick = () => { F.page++; loadUsers(); };
  $("pNo").onchange = () => { const v = Math.max(1, Math.min(Math.ceil(total / F.size) || 1, parseInt($("pNo").value, 10) || 1)); F.page = v; loadUsers(); };
  $("pSize").onchange = () => { F.size = +$("pSize").value; F.page = 1; loadUsers(); };
  $("fQ").addEventListener("input", debounce(() => { F.q = $("fQ").value.trim(); F.page = 1; loadUsers(); }, 300));
  $("fRole").onchange = () => { F.role = $("fRole").value; F.page = 1; loadUsers(); };
  $("fStatus").onchange = () => { F.status = $("fStatus").value; F.page = 1; loadUsers(); };
  $("fFrom").onchange = () => { F.from = $("fFrom").value; F.page = 1; loadUsers(); };
  $("fTo").onchange = () => { F.to = $("fTo").value; F.page = 1; loadUsers(); };
  $("fReset").onclick = () => resetFilters();
  // 学校 / 单位：边输边提示
  const orgFill = debounce(async () => {
    try { const l = await rpc("adm_lookup", { kind: "org", q: $("fOrg").value.trim() }); $("orgList").innerHTML = `<option value="（没填）">` + l.map((o) => `<option value="${esc(o.name)}">${n(o.n)} 人</option>`).join(""); } catch (e) {}
  }, 250);
  $("fOrg").addEventListener("input", orgFill); $("fOrg").addEventListener("focus", orgFill);
  $("fOrg").addEventListener("change", () => { const v = $("fOrg").value.trim(); F.org = v === "（没填）" ? "-" : v; F.page = 1; loadUsers(); });
  // 班级：名称或班级码，选中后按班级 id 筛选
  let clsMap = new Map();
  const clsLabel = (c) => `${c.name}（${c.code}）`;
  const clsFill = debounce(async (inp) => {
    try {
      const l = await rpc("adm_lookup", { kind: "class", q: inp.value.replace(/（.*$/, "").trim() });
      l.forEach((c) => clsMap.set(clsLabel(c), c));
      $("clsList").innerHTML = l.map((c) => `<option value="${esc(clsLabel(c))}">${esc(c.teacher || "")} · ${n(c.n)} 人</option>`).join("");
    } catch (e) {}
  }, 250);
  ["fCls", "impCls"].forEach((id) => { $(id).addEventListener("input", () => clsFill($(id))); $(id).addEventListener("focus", () => clsFill($(id))); });
  $("fCls").addEventListener("change", () => {
    const c = clsMap.get($("fCls").value.trim());
    if (!$("fCls").value.trim()) { F.cls = ""; F.clsName = ""; }
    else if (c) { F.cls = c.id; F.clsName = clsLabel(c); }
    else { toast("没找到这个班级，请从下拉列表里选", true); return; }
    F.page = 1; loadUsers();
  });

  // 导出
  async function exportRows(list, name) {
    const head = ["账号", "姓名", "身份", "性别", "学校/单位", "班级", "注册时间", "最近活跃", "状态", "禁用原因"];
    download(name, csv([head, ...list.map((u) => [u.account, u.name, ROLE_NAMES[u.role] || u.role, u.gender === "m" ? "男" : u.gender === "f" ? "女" : "",
      u.org || "", (u.classes || []).join("、"), fmt(u.created), u.seen ? fmt(u.seen) : "从没登录",
      [u.banned && "已禁用", u.must_change && "待改密码", u.wx && "绑定微信", u.email && "绑定邮箱"].filter(Boolean).join(" "), u.ban_reason || ""])]));
  }
  $("exportAll").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await rpc("adm_users", { f: { ...F, page: 1, size: 5000, export: true } });
    await exportRows(r.rows || [], `用户名单_${stamp()}.csv`);
    toast(`已导出 ${n((r.rows || []).length)} 人` + (r.total > 5000 ? `（共 ${n(r.total)} 人，一次最多导出 5000，请加筛选条件分批导出）` : ""));
  });

  // ---------- 批量操作 ----------
  const selIds = () => [...sel.keys()];
  const nameOf = (id) => { const u = sel.get(id) || rows.find((x) => x.id === id) || (curUser && curUser.id === id ? curUser : null); return u ? `${u.name}（${u.account}）` : id; };
  async function runChunks(fn, ids, size = 500) {
    let done = 0; const skipped = []; const out = [];
    for (const part of chunk(ids, size)) {
      const r = await rpc(fn.name, fn.args(part));
      done += r.done || 0; skipped.push(...(r.skipped || [])); out.push(...(r.rows || []));
    }
    return { done, skipped, rows: out };
  }
  function after(r, what) {
    if (r.skipped.length) {
      openDlg(`<div class="in"><h2>${what} ${n(r.done)} 人</h2>${skippedHtml(r.skipped, nameOf)}<div class="fa"><button class="btn pri" data-close>知道了</button></div></div>`);
    } else toast(`${what} ${n(r.done)} 人`);
    loadUsers(); loaded.ov = false;
  }
  const roleOptions = () => Object.entries(ROLE_NAMES).filter(([k]) => k !== "admin" || isAdmin).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const BULK = {
    role(ids) {
      const d = openDlg(`<form><h2>给 ${n(ids.length)} 人改身份</h2><p class="lead">改成「老师」后能创建班级；开发者、测试员能进插件后台。</p>
        <div class="fields"><label class="fl">新身份<select class="inp" name="r" autofocus>${roleOptions()}</select></label></div>
        <div class="err"></div><div class="fa"><button type="button" class="btn" data-close>取消</button><button class="btn pri">确定</button></div></form>`);
      d.querySelector("form").onsubmit = (e) => { e.preventDefault(); const r = e.target.r.value;
        busy(e.submitter, async () => { const res = await runChunks({ name: "adm_set_role", args: (p) => ({ ids: p, new_role: r }) }, ids, 1000); d.close(); after(res, `已改成${ROLE_NAMES[r]}`); }); };
    },
    class(ids) {
      const d = openDlg(`<form><h2>把 ${n(ids.length)} 人加入班级</h2><p class="lead">直接成为班级成员，不用老师审批。只有学生、班委会被加入。</p>
        <div class="fields"><label class="fl">班级<input class="inp" name="c" list="clsList" placeholder="输入班级名称或班级码，从列表里选" autocomplete="off" autofocus></label></div>
        <div class="err"></div><div class="fa"><button type="button" class="btn" data-close>取消</button><button class="btn pri">加入</button></div></form>`);
      const inp = d.querySelector("[name=c]"); inp.addEventListener("input", () => clsFill(inp)); clsFill(inp);
      d.querySelector("form").onsubmit = (e) => { e.preventDefault(); const c = clsMap.get(inp.value.trim());
        if (!c) { d.querySelector(".err").textContent = "请从下拉列表里选一个班级"; return; }
        busy(e.submitter, async () => { const res = await runChunks({ name: "adm_add_to_class", args: (p) => ({ ids: p, cls: c.id }) }, ids); d.close(); after(res, `已加入「${c.name}」`); }); };
    },
    ban(ids) {
      const d = openDlg(`<form><h2>禁用 ${n(ids.length)} 个账号</h2><p class="lead">禁用后不能登录（网页、App、小程序都不行），已经登录的设备最多 1 小时内掉线。数据会保留，可以随时解除。</p>
        <div class="fields"><div class="fl">时长<div class="radio">${[["24", "1 天"], ["168", "7 天"], ["720", "30 天"], ["", "一直禁用"]].map(([v, t], i) => `<label><input type="radio" name="h" value="${v}" ${i === 1 ? "checked" : ""}>${t}</label>`).join("")}</div></div>
          <label class="fl">原因（会记进操作日志）<input class="inp" name="why" maxlength="100" placeholder="如：发广告、冒用他人身份" autofocus></label></div>
        <div class="err"></div><div class="fa"><button type="button" class="btn" data-close>取消</button><button class="btn danger pri">禁用</button></div></form>`);
      d.querySelector("form").onsubmit = (e) => { e.preventDefault(); const f = e.target, why = f.why.value.trim();
        if (!why) { d.querySelector(".err").textContent = "请写一下原因"; return; }
        const h = f.h.value ? +f.h.value : null;
        busy(e.submitter, async () => { const res = await runChunks({ name: "adm_ban", args: (p) => ({ ids: p, hours: h, reason: why }) }, ids, 1000); d.close(); after(res, "已禁用"); }); };
    },
    async unban(ids) {
      if (!confirm(`解除这 ${ids.length} 个账号的禁用？`)) return;
      await busy(null, async () => after(await runChunks({ name: "adm_unban", args: (p) => ({ ids: p }) }, ids, 1000), "已解除禁用"));
    },
    pw(ids) {
      const d = openDlg(`<form><h2>重置 ${n(ids.length)} 人的密码</h2><p class="lead">重置后旧密码失效、已登录的设备会掉线，本人用新密码登录后要马上改成自己的密码。</p>
        <div class="fields"><div class="fl">新密码<div class="radio"><label><input type="radio" name="m" value="random" checked>每人随机</label><label><input type="radio" name="m" value="same">统一密码</label></div></div>
          <input class="inp hidden" name="pw" placeholder="至少 8 位" autocomplete="off"></div>
        <div class="err"></div><div class="fa"><button type="button" class="btn" data-close>取消</button><button class="btn pri">重置</button></div></form>`);
      const f = d.querySelector("form");
      f.addEventListener("change", () => f.pw.classList.toggle("hidden", f.m.value !== "same"));
      f.onsubmit = (e) => { e.preventDefault(); const pw = f.m.value === "same" ? f.pw.value : "";
        if (f.m.value === "same" && pw.length < 8) { d.querySelector(".err").textContent = "密码至少 8 位"; return; }
        busy(e.submitter, async () => {
          const res = await runChunks({ name: "adm_reset_pw", args: (p) => ({ ids: p, pw }) }, ids, 500);
          showPasswords(res.rows, `重置了 ${n(res.done)} 人的密码`, `新密码_${stamp()}.csv`, res.skipped); loadUsers(); loaded.ov = false;
        }); };
    },
    async export(ids) {
      await busy(null, async () => {
        // 选中的人可能在别的页：按需取一遍完整信息
        const need = new Set(ids), have = rows.filter((u) => need.has(u.id));
        let list = have;
        if (have.length < ids.length) { const r = await rpc("adm_users", { f: { ...F, page: 1, size: 5000, export: true } }); list = (r.rows || []).filter((u) => need.has(u.id)); }
        await exportRows(list, `选中用户_${stamp()}.csv`); toast(`已导出 ${n(list.length)} 人`);
      });
    },
    del(ids) {
      const d = openDlg(`<form><h2>删除 ${n(ids.length)} 个账号</h2>
        <div class="dangerbox">删除后不能恢复：账号、课表、待办、学习资料、班级墙发言都会一起删除。<br>只是暂时不让登录的话，用「禁用」。</div>
        <div class="fields" style="margin-top:12px"><label class="fl">确认请输入要删除的数量：${ids.length}<input class="inp" name="n" inputmode="numeric" autocomplete="off" autofocus></label></div>
        <div class="err"></div><div class="fa"><button type="button" class="btn" data-close>取消</button><button class="btn danger pri">永久删除</button></div></form>`);
      d.querySelector("form").onsubmit = (e) => { e.preventDefault();
        if (+e.target.n.value !== ids.length) { d.querySelector(".err").textContent = "数量不对"; return; }
        busy(e.submitter, async () => {
          let done = 0; const skipped = [];
          for (const part of chunk(ids, 500)) { const r = await rpc("adm_delete", { ids: part, confirm_n: part.length }); done += r.done; skipped.push(...(r.skipped || [])); }
          ids.forEach((id) => { if (!skipped.some((s) => s.id === id)) sel.delete(id); });
          d.close(); after({ done, skipped }, "已删除");
        }); };
    },
    clear() { sel.clear(); renderUsers(); },
  };
  $("bulk").onclick = (e) => { const b = e.target.closest("[data-bulk]"); if (b) BULK[b.dataset.bulk](selIds()); };

  function showPasswords(list, title, file, skipped) {
    const csvText = csv([["账号", "姓名", "新密码"], ...list.map((u) => [u.account, u.name, u.password])]);
    const d = openDlg(`<div class="in"><h2>${esc(title)}</h2>
      <div class="warnbox">新密码<b>只显示这一次</b>，请下载保存，私下发给本人。</div>
      <div class="pwtable" style="margin-top:12px"><table class="t"><thead><tr><th>账号</th><th>姓名</th><th>新密码</th></tr></thead><tbody>
        ${list.map((u) => `<tr><td class="acc">${esc(u.account)}</td><td>${esc(u.name)}</td><td class="pw">${esc(u.password)}</td></tr>`).join("")}</tbody></table></div>
      ${skippedHtml(skipped, nameOf)}
      <div class="fa"><button class="btn" data-copy>复制</button><span class="sp"></span><button class="btn" data-close>关闭</button><button class="btn pri" data-dl>⇩ 下载密码单</button></div></div>`, true);
    d.querySelector("[data-dl]").onclick = () => download(file, csvText);
    d.querySelector("[data-copy]").onclick = async () => {
      try { await navigator.clipboard.writeText(list.map((u) => `${u.account}\t${u.name}\t${u.password}`).join("\n")); toast("已复制，可以粘贴到 Excel"); } catch (e) { toast("复制失败，请用下载", true); }
    };
  }

  // ---------- 用户详情 ----------
  let curUser = null;
  async function openUser(id) {
    $("dMask").classList.remove("hidden"); const dr = $("drawer"); dr.classList.remove("hidden");
    dr.innerHTML = `<div class="dh"><div class="skel" style="width:46px;height:46px"></div><div style="flex:1"><div class="skel" style="width:50%"></div></div></div>`;
    let u; try { u = await rpc("adm_user", { uid: id }); } catch (e) { dr.innerHTML = `<div class="db">${esc(e.message)}</div>`; return; }
    curUser = u;
    const ACT = { role: "改身份", ban: "禁用", unban: "解除禁用", reset_pw: "重置密码", delete: "删除账号", create: "批量建号", class_add: "加入班级" };
    const DATA = { user_kv: "同步数据", user_courses: "课表", kn_items: "学习资料", kn_nodes: "知识点", mm_maps: "思维导图", wall_posts: "班级墙发帖", wall_comments: "评论", growth_events: "成长记录" };
    const self = u.id === me.id, lockAdmin = u.role === "admin" && !isAdmin;
    dr.innerHTML = `<div class="dh"><div class="av">${esc([...(u.name || "?")][0])}</div><div><h2>${esc(u.name)}</h2><div class="muted acc">@${esc(u.account)} ${roleTag(u.role)}${u.banned ? '<span class="tag red">已禁用</span>' : ""}${u.must_change ? '<span class="tag warn">待改密码</span>' : ""}</div></div>
        <span class="sp"></span><button class="btn ghost" data-dclose aria-label="关闭">✕</button></div>
      <div class="db">
        ${u.banned ? `<div class="dangerbox" style="margin-bottom:14px">已禁用${u.banned_until && !/^infinity|^2[1-9]\d\d|^9999/.test(u.banned_until) ? `到 ${esc(fmt(u.banned_until))}` : "（一直）"}：${esc(u.ban_reason || "")}<br><span style="opacity:.8">${esc(u.banned_by || "")} · ${esc(fmt(u.banned_at))}</span></div>` : ""}
        <dl class="kv">
          <dt>性别</dt><dd>${u.gender === "m" ? "男" : u.gender === "f" ? "女" : "—"}</dd>
          <dt>学校 / 单位</dt><dd>${esc(u.org || "—")}</dd>
          <dt>注册时间</dt><dd>${esc(fmt(u.created))}</dd>
          <dt>最近活跃</dt><dd>${u.seen ? `${esc(ago(u.seen))}（${esc(fmt(u.seen))}）` : "从没登录"}${u.devices ? ` · 30 天内 ${u.devices} 台设备` : ""}</dd>
          <dt>上次密码登录</dt><dd>${esc(fmt(u.last_sign_in) || "—")}</dd>
          <dt>微信</dt><dd>${u.wx ? `已绑定 · 最近微信登录 ${esc(fmt(u.wx.last) || "—")}` : "没绑定"}</dd>
          <dt>邮箱</dt><dd>${esc(u.email || "没绑定")}</dd>
          ${u.bio ? `<dt>签名</dt><dd>${esc(u.bio)}</dd>` : ""}
        </dl>
        <div class="sec">班级</div>
        <div class="list">${(u.teaches || []).map((c) => `<div class="it"><b>${esc(c.name)}</b><span class="tag teacher">班主任</span><span class="sp"></span><span class="muted">${esc(c.code)} · ${n(c.n)} 人</span></div>`).join("")
          + (u.classes || []).map((c) => `<div class="it"><b>${esc(c.name)}</b>${c.role === "monitor" ? '<span class="tag monitor">班委</span>' : ""}${c.status === "pending" ? '<span class="tag warn">待审批</span>' : ""}<span class="sp"></span><span class="muted">${esc(c.teacher || "")} · ${esc(c.code)}</span></div>`).join("")
          || `<div class="none">没加入班级</div>`}</div>
        <div class="sec">存了多少数据</div>
        <div class="stats">${Object.entries(u.data || {}).map(([k, v]) => `<div><b>${n(v)}</b>${esc(DATA[k] || k)}</div>`).join("")}</div>
        <div class="sec">后台操作记录</div>
        <div class="list log">${(u.log || []).map((l) => `<div class="it"><time>${esc(fmt(l.at))}</time><span>${esc(l.actor || "?")} · ${esc(ACT[l.action] || l.action)} ${esc(detailText(l.action, l.detail))}</span></div>`).join("") || `<div class="none">没有记录</div>`}</div>
      </div>
      <div class="acts">${self ? `<span class="muted">这是你自己的账号</span>` : lockAdmin ? `<span class="muted">只有管理员能操作管理员</span>` : `
        <button class="btn" data-uact="role">改身份</button>
        ${u.role !== "teacher" ? `<button class="btn" data-uact="class">加入班级</button>` : ""}
        ${u.banned ? `<button class="btn" data-uact="unban">解除禁用</button>` : `<button class="btn" data-uact="ban">禁用</button>`}
        <button class="btn" data-uact="pw">重置密码</button>
        ${isAdmin ? `<button class="btn danger" data-uact="del">删除账号</button>` : ""}`}</div>`;
  }
  function closeDrawer() { $("drawer").classList.add("hidden"); $("dMask").classList.add("hidden"); curUser = null; }
  $("dMask").onclick = closeDrawer;
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !dlg.open && curUser) closeDrawer(); });
  $("drawer").addEventListener("click", (e) => {
    if (e.target.closest("[data-dclose]")) return closeDrawer();
    const b = e.target.closest("[data-uact]"); if (!b || !curUser) return;
    const u = curUser;
    // 和批量操作用同一套弹窗；弹窗关掉后刷新详情
    const p = BULK[b.dataset.uact]([u.id]);
    const watch = () => { if (dlg.open) return setTimeout(watch, 300); if (b.dataset.uact === "del") closeDrawer(); else if (curUser && curUser.id === u.id) openUser(u.id); };
    Promise.resolve(p).then(() => setTimeout(watch, 300));
  });
  function detailText(a, d) {
    d = d || {};
    if (a === "role") return `${ROLE_NAMES[d.from] || d.from || ""} → ${ROLE_NAMES[d.to] || d.to || ""}`;
    if (a === "ban") return `${d.hours ? (d.hours >= 24 ? d.hours / 24 + " 天" : d.hours + " 小时") : "一直"}：${d.reason || ""}`;
    if (a === "reset_pw") return d.mode === "same" ? "（统一密码）" : "（随机密码）";
    if (a === "create") return [ROLE_NAMES[d.role] || "", d.class && "加入 " + d.class, d.org].filter(Boolean).join(" · ");
    if (a === "class_add") return d.class || "";
    if (a === "delete") return `${d.name || ""}（${ROLE_NAMES[d.role] || d.role || ""}${d.org ? " · " + d.org : ""}）`;
    return "";
  }

  // ================= 批量建号 =================
  const COLS = { account: /^(账号|学号|工号|用户名|account|username|id)$/i, name: /^(姓名|名字|name)$/i, role: /^(身份|角色|role)$/i,
    gender: /^(性别|gender|sex)$/i, org: /^(学校|单位|学校\/单位|学校单位|org|school)$/i, password: /^(密码|初始密码|password)$/i };
  let impRows = [];
  $("tplBtn").onclick = () => download("批量建号模板.csv", csv([["账号", "姓名", "身份", "性别", "学校/单位", "密码"],
    ["2026001", "张三", "学生", "男", "西安交通大学城市学院", ""], ["2026002", "李四", "学生", "女", "西安交通大学城市学院", ""], ["t_wang", "王老师", "老师", "女", "西安交通大学城市学院", ""]]));
  function parseTable(text) {
    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!text) return [];
    const delim = text.split("\n")[0].includes("\t") ? "\t" : text.split("\n")[0].includes(",") ? "," : text.split("\n")[0].includes("，") ? "，" : "\t";
    const out = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && cell === "") { q = true; continue; }
      if (ch === delim) { row.push(cell); cell = ""; continue; }
      if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; continue; }
      cell += ch;
    }
    row.push(cell); out.push(row);
    return out.map((r) => r.map((c) => c.trim().replace(/^'(?=[=+\-@])/, ""))).filter((r) => r.some((c) => c));
  }
  async function preview() {
    const t = parseTable($("impText").value);
    let map = { account: 0, name: 1, role: 2, gender: 3, org: 4, password: 5 }, body = t;
    if (t.length && t[0].some((c) => Object.values(COLS).some((re) => re.test(c)))) {
      map = {}; t[0].forEach((c, i) => { for (const [k, re] of Object.entries(COLS)) if (re.test(c) && map[k] == null) map[k] = i; });
      body = t.slice(1);
    }
    const seen = new Map();
    impRows = body.slice(0, 2000).map((r, i) => {
      const g = (k) => (map[k] != null ? r[map[k]] || "" : "").trim();
      const o = { i: i + 1, account: g("account").toLowerCase(), name: g("name"), role: /老师|教师|teacher/i.test(g("role")) ? "teacher" : "student",
        gender: /^(男|m|male)$/i.test(g("gender")) ? "m" : /^(女|f|female)$/i.test(g("gender")) ? "f" : "", org: g("org"), password: g("password"), why: "" };
      if (!/^[a-z0-9_]{3,20}$/.test(o.account)) o.why = "账号要 3~20 位小写字母、数字或下划线";
      else if (!o.name) o.why = "没填姓名";
      else if (o.password && (o.password.length < 8 || o.password.length > 72)) o.why = "密码要 8~72 位";
      else if (seen.has(o.account)) o.why = `和第 ${seen.get(o.account)} 行账号重复`;
      seen.set(o.account, seen.get(o.account) || o.i);
      return o;
    });
    // 去数据库查哪些账号已经有人用了
    const okAcc = impRows.filter((r) => !r.why).map((r) => r.account);
    if (okAcc.length) {
      try {
        const taken = new Set();
        for (const part of chunk(okAcc, 2000)) (await rpc("adm_accounts_taken", { accts: part })).forEach((a) => taken.add(a));
        impRows.forEach((r) => { if (!r.why && taken.has(r.account)) r.why = "账号已经存在"; });
      } catch (e) { toast(e.message, true); }
    }
    renderImp(body.length > 2000);
  }
  function renderImp(cut) {
    const good = impRows.filter((r) => !r.why).length, bad = impRows.length - good;
    $("impSum").innerHTML = impRows.length ? `<span class="tag ok">可以导入 ${n(good)} 人</span>${bad ? `<span class="tag red">有问题 ${n(bad)} 行（会跳过）</span>` : ""}${cut ? '<span class="tag warn">一次最多 2000 行，后面的没读</span>' : ""}
      <span class="muted">学生 ${n(impRows.filter((r) => !r.why && r.role === "student").length)} · 老师 ${n(impRows.filter((r) => !r.why && r.role === "teacher").length)}</span>` : "";
    $("impPrev").querySelector("tbody").innerHTML = impRows.map((r) => `<tr class="${r.why ? "bad" : ""}"><td class="faint">${r.i}</td><td class="acc">${esc(r.account)}</td><td>${esc(r.name)}</td>
      <td>${r.role === "teacher" ? "老师" : "学生"}</td><td>${r.gender === "m" ? "男" : r.gender === "f" ? "女" : ""}</td><td>${esc(r.org)}</td><td>${r.why ? `<span style="color:var(--red)">${esc(r.why)}</span>` : '<span class="tag ok">✓</span>'}</td></tr>`).join("")
      || `<tr><td colspan="7" class="empty">粘贴或上传名单后，这里会预览并检查每一行</td></tr>`;
    $("impGo").disabled = !good;
    $("impGo").textContent = good ? `③ 开始导入 ${n(good)} 人` : "③ 开始导入";
  }
  $("impText").addEventListener("input", debounce(preview, 400));
  async function readFile(f) {
    if (f.size > 5 * 1024 * 1024) { toast("文件太大了（最多 5MB）", true); return; }
    if (/\.xlsx?$/i.test(f.name)) { toast("请在 Excel 里「另存为 → CSV」再上传，或者直接复制表格粘贴进来", true); return; }
    const buf = await f.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("gbk").decode(buf); }   // Excel 存的中文 CSV 常常是 GBK
    $("impText").value = text; preview();
  }
  $("impFile").onchange = (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ""; };
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((k) => drop.addEventListener(k, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((k) => drop.addEventListener(k, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  document.querySelectorAll("input[name=impPw]").forEach((r) => r.onchange = () => $("impSame").classList.toggle("hidden", r.value !== "same" || !r.checked));
  $("impGo").onclick = (e) => busy(e.currentTarget, async () => {
    const list = impRows.filter((r) => !r.why);
    const same = document.querySelector("input[name=impPw]:checked").value === "same" ? $("impSame").value : "";
    if (document.querySelector("input[name=impPw]:checked").value === "same" && same.length < 8) { toast("统一密码至少 8 位", true); $("impSame").focus(); return; }
    let cls = "";
    if ($("impCls").value.trim()) { const c = clsMap.get($("impCls").value.trim()); if (!c) { toast("请从下拉列表里选班级", true); return; } cls = c.id; }
    if (!confirm(`给 ${list.length} 人建账号？`)) return;
    $("impProg").classList.remove("hidden"); const bar = $("impProg").querySelector("i");
    const ok = [], failed = [];
    const parts = chunk(list, 300);
    for (let i = 0; i < parts.length; i++) {
      $("impMsg").textContent = `正在导入第 ${i * 300 + 1}–${Math.min((i + 1) * 300, list.length)} 人…`;
      try {
        const r = await rpc("adm_import", { rows: parts[i].map((x) => ({ account: x.account, name: x.name, role: x.role, gender: x.gender, org: x.org, password: x.password })), opts: { cls, pw: same } });
        ok.push(...(r.rows || [])); failed.push(...(r.failed || []).map((f) => ({ ...f, row: parts[i][f.row - 1] ? parts[i][f.row - 1].i : f.row })));
      } catch (err) { parts[i].forEach((x) => failed.push({ row: x.i, account: x.account, why: err.message })); }
      bar.style.width = ((i + 1) / parts.length) * 100 + "%";
    }
    $("impMsg").textContent = `完成：建好 ${ok.length} 人${failed.length ? `，${failed.length} 人没建成` : ""}`;
    const file = `账号密码单_${stamp()}.csv`;
    const text = csv([["账号", "姓名", "身份", "初始密码", "班级"], ...ok.map((u) => [u.account, u.name, u.role === "teacher" ? "老师" : "学生", u.password, u.class || ""])]);
    if (ok.length) download(file, text);   // 先自动下载一份，免得关掉弹窗就没了
    const d = openDlg(`<div class="in"><h2>建好了 ${n(ok.length)} 个账号</h2>
      <div class="warnbox">「账号密码单」已经自动下载（${esc(file)}）。初始密码<b>只显示这一次</b>，请私下发给本人，第一次登录会要求改密码。</div>
      ${failed.length ? `<div class="sec">没建成的 ${failed.length} 行</div><div class="list" style="max-height:180px;overflow:auto">${failed.map((f) => `<div class="it"><span class="faint">第 ${f.row} 行</span><span class="acc">${esc(f.account || "")}</span><span class="sp"></span><span class="muted">${esc(f.why)}</span></div>`).join("")}</div>` : ""}
      <div class="pwtable" style="margin-top:12px"><table class="t"><thead><tr><th>账号</th><th>姓名</th><th>身份</th><th>初始密码</th><th>班级</th></tr></thead><tbody>
        ${ok.slice(0, 500).map((u) => `<tr><td class="acc">${esc(u.account)}</td><td>${esc(u.name)}</td><td>${u.role === "teacher" ? "老师" : "学生"}</td><td class="pw">${esc(u.password)}</td><td>${esc(u.class || "")}</td></tr>`).join("")}</tbody></table></div>
      <div class="fa"><span class="sp"></span><button class="btn" data-close>关闭</button><button class="btn pri" data-dl>⇩ 再下载一次</button></div></div>`, true);
    d.querySelector("[data-dl]").onclick = () => download(file, text);
    $("impText").value = ""; impRows = []; renderImp(); $("impProg").classList.add("hidden"); bar.style.width = "0";
    loaded.users = false; loaded.ov = false;
  });
  renderImp();

  // ================= 操作日志 =================
  const A = { q: "", action: "", page: 1, size: 50 }; let aTotal = 0, aRows = [];
  const ACT_NAMES = { role: "改身份", ban: "禁用", unban: "解除禁用", reset_pw: "重置密码", delete: "删除账号", create: "建号", class_add: "加入班级" };
  Object.entries(ACT_NAMES).forEach(([k, v]) => $("aAct").insertAdjacentHTML("beforeend", `<option value="${k}">${v}</option>`));
  async function loadAudit() {
    let r; try { r = await rpc("adm_audit", { f: { ...A } }); } catch (e) { $("aRows").innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`; return; }
    aRows = r.rows || []; aTotal = r.total || 0;
    $("aRows").innerHTML = aRows.map((l) => `<tr${l.target ? ` data-id="${esc(l.target)}"` : ""}><td class="num muted" style="white-space:nowrap">${esc(fmt(l.at))}</td><td class="acc">${esc(l.actor || "?")}</td>
      <td><span class="tag ${l.action === "delete" || l.action === "ban" ? "red" : l.action === "create" ? "ok" : ""}">${esc(ACT_NAMES[l.action] || l.action)}</span></td>
      <td class="acc">${esc(l.target_acct || "")}</td><td>${esc(detailText(l.action, l.detail))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">没有记录</td></tr>`;
    const pages = Math.max(1, Math.ceil(aTotal / A.size));
    $("aInfo").textContent = `共 ${n(aTotal)} 条 · 第 ${A.page} / ${pages} 页`;
    $("aPrev").disabled = A.page <= 1; $("aNext").disabled = A.page >= pages;
  }
  $("aQ").addEventListener("input", debounce(() => { A.q = $("aQ").value.trim(); A.page = 1; loadAudit(); }, 300));
  $("aAct").onchange = () => { A.action = $("aAct").value; A.page = 1; loadAudit(); };
  $("aPrev").onclick = () => { A.page--; loadAudit(); };
  $("aNext").onclick = () => { A.page++; loadAudit(); };
  $("aRows").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr && tr.dataset.id) openUser(tr.dataset.id); });
  $("aExport").onclick = () => download(`操作日志_${stamp()}.csv`, csv([["时间", "操作人", "动作", "对象", "详情"], ...aRows.map((l) => [fmt(l.at), l.actor, ACT_NAMES[l.action] || l.action, l.target_acct || "", detailText(l.action, l.detail)])]));

  // ================= 启动 =================
  (async () => {
    const s = await CCAuth.session();
    if (!s) { location.href = "login.html?next=admin.html"; return; }
    me = await CCAuth.me();
    $("loading").classList.add("hidden");
    if (!me || !(me.role === "admin" || CCAuth.can(me, "manage_users"))) { $("noPerm").classList.remove("hidden"); return; }
    isAdmin = me.role === "admin";
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin));
    $("meName").textContent = me.display_name; $("meRole").textContent = (ROLE_NAMES[me.role] || me.role) + " · @" + me.account;
    $("app").classList.remove("hidden");
    show(location.hash.slice(1) || "ov");
  })();
})();
