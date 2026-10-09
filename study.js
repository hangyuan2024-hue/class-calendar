/* =========================================================================
 * 课内学习：按课程管理资料、笔记、考核、错题，用「知识框架」（分类 / 知识点）给它们打标签。
 * 功能来自合作队伍的「课内」（github.com/RainyyyyDay/courses_app，原始代码在 partners/courses_app/），
 * 这里改成捞捞课程表的样式，数据存在捞捞的账号里（数据库函数 kn_*，见 deploy/study.sql）：
 *   · 换设备、换浏览器都在；一台设备改了，别的设备几秒内跟着变（随「我的数据」同步一个版本号 kn_rev_v1）
 *   · 课程可以从「课程表」一键导入
 *   · 有截止日期的考核会出现在首页、日历、作业提醒里（和班级事项一样能勾完成）
 * 依赖 app.js 里的 $ esc load save showView showBanner currentUser Sync renderAll ck ccDate keyOf buzz isMobile
 * ========================================================================= */
(() => {
  const LS_CACHE = "kn_cache_v1", LS_REV = "kn_rev_v1", LS_VIEW = "kn_view_v1";
  const KINDS = {
    material: { name: "资料", icon: "📄", empty: "还没有资料：上传讲义、课件，或者手动记下要点" },
    note: { name: "笔记", icon: "📝", empty: "还没有笔记：拍照上传，或者直接写" },
    assessment: { name: "考核", icon: "🎯", empty: "还没有考核：把考试、大作业、实验报告加进来，截止日期会出现在日历和提醒里" },
    mistake: { name: "错题", icon: "❌", empty: "还没有错题：拍下来或者手动输入，打上知识点标签，复习时按知识点看" },
  };
  const TABS = [["material", "📄", "资料"], ["note", "📝", "笔记"], ["assessment", "🎯", "考核"], ["mistake", "❌", "错题"], ["tree", "🧭", "知识框架"]];
  const MAX_FILE = 5 * 1024 * 1024;

  let data = (() => { const c = load(LS_CACHE, null); return c && c.uid ? c : null; })();
  let view = { page: "list", cid: null, tab: "material", ...load(LS_VIEW, {}) };
  let q = "", loading = false, loadErr = "", expanded = new Set(load("kn_open_v1", [])), lastFetch = 0;
  const box = () => $("studyBox");
  const me = () => (typeof currentUser !== "undefined" && currentUser ? currentUser : null);
  const mine = () => !!(data && me() && data.uid === me().id);
  const rpc = (fn, args) => CCAuth.rpc(fn, args || {});
  const saveView = () => save(LS_VIEW, { page: view.page, cid: view.cid, tab: view.tab });
  const tip = (msg, ms = 2600) => { showBanner(msg); clearTimeout(tip.t); tip.t = setTimeout(() => showBanner(""), ms); };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
  const dstr = (t) => { const d = new Date(t); return isNaN(d) ? "" : `${d.getMonth() + 1}月${d.getDate()}日`; };
  const daysTo = (day) => Math.round((new Date(day + "T00:00:00") - new Date(keyOf(ccDate()) + "T00:00:00")) / 86400000);
  const dueText = (day) => { const n = daysTo(day); return n < 0 ? `已过 ${-n} 天` : n === 0 ? "今天截止" : n === 1 ? "明天截止" : `${n} 天后截止`; };
  const extOf = (name) => { const m = String(name || "").match(/(\.[A-Za-z0-9]{1,8})$/); return m ? m[1] : ""; };

  // ---------------- 数据 ----------------
  const courses = () => (mine() ? data.courses : []);
  const course = (id) => courses().find((c) => c.id === id) || null;
  const nodesOf = (cid) => (mine() ? data.nodes.filter((n) => n.course_id === cid) : []);
  const itemsOf = (cid, kind) => (mine() ? data.items.filter((i) => i.course_id === cid && (!kind || i.kind === kind)) : []);
  const node = (id) => (mine() ? data.nodes.find((n) => n.id === id) : null);
  const item = (id) => (mine() ? data.items.find((i) => i.id === id) : null);
  const tagsOf = (iid) => (mine() ? data.links.filter((l) => l[0] === iid).map((l) => node(l[1])).filter(Boolean) : []);
  function index() {
    if (!data) return;
    data.links = data.links || [];
    data.byParent = {};
    for (const n of data.nodes) (data.byParent[(n.course_id) + ":" + (n.parent_id || 0)] ||= []).push(n);
    for (const k in data.byParent) data.byParent[k].sort((a, b) => (b.is_system - a.is_system) || a.sort_order - b.sort_order || a.id - b.id);
  }
  const kids = (cid, pid) => (data && data.byParent && data.byParent[cid + ":" + (pid || 0)]) || [];
  function subtree(id) {
    const n = node(id); if (!n) return [];
    const out = [id];
    for (const k of kids(n.course_id, id)) out.push(...subtree(k.id));
    return out;
  }
  // 某个分类 / 知识点（连同下级）关联的资源；「未分类」= 一个标签都没有的资源
  function itemsUnder(id) {
    const n = node(id); if (!n) return [];
    if (n.is_system) { const tagged = new Set(data.links.map((l) => l[0])); return itemsOf(n.course_id).filter((i) => i.kind !== "assessment" && !tagged.has(i.id)); }
    const ids = new Set(subtree(id)), got = new Set(data.links.filter((l) => ids.has(l[1])).map((l) => l[0]));
    return itemsOf(n.course_id).filter((i) => got.has(i.id));
  }
  function pathOf(id) {
    const out = []; let n = node(id), g = 0;
    while (n && g++ < 200) { out.unshift(n.name); n = n.parent_id ? node(n.parent_id) : null; }
    return out;
  }

  async function refresh(force) {
    if (!me()) return;
    if (loading) return;
    if (!force && mine() && Date.now() - lastFetch < 1500) return;
    loading = true;
    try {
      const s = await rpc("kn_state");
      data = { uid: me().id, at: Date.now(), courses: s.courses || [], nodes: s.nodes || [], items: s.items || [], links: s.links || [], used: +s.used || 0 };
      index(); loadErr = "";
      lastFetch = Date.now();
      try { save(LS_CACHE, { uid: data.uid, at: data.at, courses: data.courses, nodes: data.nodes, items: data.items.map((i) => ({ ...i, content: String(i.content || "").slice(0, 400) })), links: data.links, used: data.used }); } catch (e) {}
    } catch (e) {
      loadErr = /function|does not exist|PGRST202|404/.test(e.message || "") ? "服务器还没装好「课内学习」（需要管理员在扣子里执行 setup_study.py）" : (e.message || "读取失败");
    } finally { loading = false; }
    try { if (currentView() === "study") render(); } catch (e) {}
    try { renderAll(); } catch (e) {}
  }
  // 改了东西：重新读一遍，再告诉别的设备（kn_rev_v1 随「我的数据」同步过去）
  async function changed() {
    await refresh(true);
    try { save(LS_REV, { t: Date.now(), n: data ? data.items.length : 0 }); } catch (e) {}
  }
  async function act(fn, args, okMsg) {
    try { const r = await rpc(fn, args); if (okMsg) tip(okMsg); await changed(); return r; }
    catch (e) { tip("没成功：" + (e.message || "请稍后再试"), 4200); throw e; }
  }

  // ---------------- 给日历 / 首页 / 提醒：有截止日期的考核 ----------------
  window.studyItems = () => {
    if (!mine()) return [];
    const out = [];
    for (const i of data.items) {
      if (i.kind !== "assessment" || !i.deadline) continue;
      const c = course(i.course_id);
      out.push({ _key: "kn" + i.id, _study: i.id, id: "kn" + i.id, msg_type: "考核", subject: (c ? c.name + " · " : "") + i.title,
        summary: i.requirement || "", event_time: String(i.deadline).slice(0, 10), location: "", _studyCourse: c ? c.name : "" });
    }
    return out;
  };

  // ---------------- 页面 ----------------
  function render() {
    const el = box(); if (!el) return;
    if (view.page === "course" && !course(view.cid) && mine()) view.page = "list";
    $("knTitle").textContent = view.page === "course" && course(view.cid) ? course(view.cid).name : "课内学习";
    $("knAdd").textContent = view.page === "course" ? (view.tab === "tree" ? "＋ 分类" : "＋ 添加" + (KINDS[view.tab] ? KINDS[view.tab].name : "")) : "＋ 课程";
    $("knAdd").classList.toggle("hidden", !me());
    if (!me()) { el.innerHTML = `<div class="kn-empty surface"><b>登录后就能用</b><p>资料、笔记、考核、错题都存在你的账号里，换手机、换电脑都在。</p><a class="btn ink sm" href="login.html">去登录</a></div>`; return; }
    if (!mine()) { el.innerHTML = loadErr ? `<div class="kn-empty surface"><b>读取失败</b><p>${esc(loadErr)}</p><button class="btn sm" data-kn="retry">重试</button></div>` : `<div class="kn-empty surface"><p>正在读取…</p></div>`; if (!loading && !loadErr) refresh(); return; }
    el.innerHTML = (view.page === "course" ? coursePage() : listPage()) + (loadErr ? `<div class="kn-warn">${esc(loadErr)}</div>` : "") + footHtml();
    if (view.page === "list") { const s = $("knQ"); if (s && document.activeElement !== s) { s.value = q; } }
  }
  const footHtml = () => `<div class="kn-foot">「课内学习」由合作队伍设计（<a href="https://github.com/RainyyyyDay/courses_app" target="_blank" rel="noopener">courses_app</a>），已接入捞捞课程表的账号和数据。
    ${mine() ? `附件已用 ${fmtSize(data.used)} / 100 MB。` : ""}</div>`;

  function timetableNames() {
    try { const d = ck().data; if (!d || !d.courses) return []; return [...new Set(d.courses.map((c) => String(c.name || "").trim()).filter(Boolean))]; } catch (e) { return []; }
  }
  function listPage() {
    const have = new Set(courses().map((c) => c.name));
    const miss = timetableNames().filter((n) => !have.has(n));
    const kw = q.trim().toLowerCase();
    const list = courses().filter((c) => !kw || c.name.toLowerCase().includes(kw));
    const card = (c) => {
      const its = itemsOf(c.id), cnt = (k) => its.filter((i) => i.kind === k).length;
      const due = its.filter((i) => i.kind === "assessment" && i.deadline && daysTo(String(i.deadline).slice(0, 10)) >= 0).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))[0];
      return `<div class="kn-course surface${c.pinned ? " pinned" : ""}" data-kn="open" data-id="${c.id}" tabindex="0" role="button">
        <div class="kc-top"><b>${c.pinned ? "📌 " : ""}${esc(c.name)}</b><button class="kn-more" data-kn="cmenu" data-id="${c.id}" aria-label="更多">⋯</button></div>
        <div class="kc-cnt"><span>📄 ${cnt("material")}</span><span>📝 ${cnt("note")}</span><span>🎯 ${cnt("assessment")}</span><span>❌ ${cnt("mistake")}</span></div>
        ${due ? `<div class="kc-due${daysTo(String(due.deadline).slice(0, 10)) <= 3 ? " soon" : ""}">🎯 ${esc(due.title)} · ${dueText(String(due.deadline).slice(0, 10))}</div>` : ""}
      </div>`;
    };
    return `<div class="kn-intro">按课程整理资料、笔记、考核和错题，再用知识框架把它们串起来，复习时按知识点找。</div>
      ${miss.length ? `<div class="kn-import surface"><span>📚 课程表里有 <b>${miss.length}</b> 门课还没加进来：${esc(miss.slice(0, 4).join("、"))}${miss.length > 4 ? " 等" : ""}</span><button class="btn ink sm" data-kn="import">一键加入</button></div>` : ""}
      ${courses().length > 4 ? `<input id="knQ" class="kn-search" placeholder="🔍 搜课程" maxlength="30">` : ""}
      ${list.length ? `<div class="kn-grid">${list.map(card).join("")}</div>`
        : `<div class="kn-empty surface"><b>${kw ? "没有找到匹配的课程" : "还没有课程"}</b><p>${kw ? "换个关键词试试" : "点右上角「＋ 课程」添加，或者从课程表一键导入"}</p></div>`}`;
  }

  function coursePage() {
    const c = course(view.cid);
    const tabs = `<div class="ptabs kn-tabs">${TABS.map(([k, ic, nm]) => {
      const n = k === "tree" ? nodesOf(c.id).filter((x) => !x.is_system).length : itemsOf(c.id, k).length;
      return `<button class="ptab${view.tab === k ? " on" : ""}" data-kn="tab" data-t="${k}"><span>${ic}</span>${nm}${n ? `<em>${n}</em>` : ""}</button>`;
    }).join("")}</div>`;
    return tabs + (view.tab === "tree" ? treePane(c) : listPane(c, view.tab));
  }

  function chips(iid, clickable) {
    const t = tagsOf(iid);
    if (!t.length) return "";
    return `<div class="kn-chips">${t.map((n) => `<button class="kn-chip ${n.type}" ${clickable ? `data-kn="node" data-id="${n.id}"` : "tabindex=-1"}>${n.type === "folder" ? "📁" : "💡"} ${esc(n.name)}</button>`).join("")}</div>`;
  }
  function listPane(c, kind) {
    const its = itemsOf(c.id, kind).slice();
    if (kind === "assessment") its.sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")));
    const row = (i) => {
      const meta = [];
      if (kind === "assessment") meta.push(i.deadline ? `<span class="kn-due${daysTo(String(i.deadline).slice(0, 10)) < 0 ? " past" : daysTo(String(i.deadline).slice(0, 10)) <= 3 ? " soon" : ""}">截止 ${esc(String(i.deadline).slice(0, 10))} · ${dueText(String(i.deadline).slice(0, 10))}</span>` : "没有截止日期");
      if (i.file_id) meta.push(`${/^image\//.test(i.file_type) ? "🖼 图片" : "📎 " + esc(extOf(i.file_name).slice(1).toUpperCase() || "文件")} · ${fmtSize(i.file_size || 0)}`);
      else if (kind !== "assessment") meta.push("✍ 手动输入");
      if (kind === "note" && i.source) meta.push(esc(i.source));
      meta.push(dstr(i.created_at));
      const body = kind === "assessment" ? i.requirement : i.content;
      return `<div class="kn-item surface" data-kn="item" data-id="${i.id}" tabindex="0" role="button">
        <div class="ki-main"><b>${esc(i.title)}</b><div class="meta">${meta.join(" · ")}</div>
          ${body ? `<div class="ki-body">${esc(String(body).slice(0, 160))}</div>` : ""}${chips(i.id, true)}</div>
        <div class="ki-ops"><button class="small" data-kn="edit" data-id="${i.id}">编辑</button><button class="small" data-kn="del" data-id="${i.id}">删除</button></div>
      </div>`;
    };
    const k = KINDS[kind];
    const add = kind === "assessment" ? `<button class="btn ink sm" data-kn="new" data-mode="manual">＋ 添加考核</button>`
      : `<button class="btn ink sm" data-kn="new" data-mode="file">＋ 上传文件</button><button class="btn sm" data-kn="new" data-mode="manual">＋ 手动输入</button>`;
    return `<div class="kn-bar">${add}</div>${its.length ? `<div class="kn-list">${its.map(row).join("")}</div>` : `<div class="kn-empty surface"><p>${k.empty}</p></div>`}`;
  }

  // ---------------- 知识框架 ----------------
  function treePane(c) {
    const roots = kids(c.id, null);
    const rowHtml = (n, depth) => {
      const ch = kids(c.id, n.id), open = expanded.has(n.id), isF = n.type === "folder", cnt = itemsUnder(n.id).length;
      return `<div class="kt-row${n.is_system ? " sys" : ""}" style="--d:${depth}" data-nid="${n.id}">
          ${n.is_system ? `<span class="kt-grip off"></span>` : `<span class="kt-grip" data-grip="${n.id}" title="按住拖动：调顺序、放进别的分类" aria-label="拖动">⠿</span>`}
          ${isF && ch.length ? `<button class="kt-tog" data-kn="tog" data-id="${n.id}" aria-label="${open ? "收起" : "展开"}">${open ? "▾" : "▸"}</button>` : `<span class="kt-tog"></span>`}
          <button class="kt-name" data-kn="node" data-id="${n.id}"><span>${n.is_system ? "📥" : isF ? "📁" : "💡"}</span>${esc(n.name)}${cnt ? `<em>${cnt}</em>` : ""}</button>
          ${n.is_system ? "" : `<span class="kt-ops">${isF ? `<button data-kn="nadd" data-id="${n.id}" title="在这里面添加">＋</button>` : ""}<button data-kn="nren" data-id="${n.id}" title="改名">✎</button><button data-kn="nmove" data-id="${n.id}" title="移动 / 排序">⇅</button><button data-kn="ndel" data-id="${n.id}" title="删除">×</button></span>`}
        </div>${isF && open && ch.length ? ch.map((k) => rowHtml(k, depth + 1)).join("") : ""}`;
    };
    const real = roots.filter((n) => !n.is_system);
    return `<div class="kn-bar"><button class="btn ink sm" data-kn="nadd" data-type="folder">＋ 分类</button><button class="btn sm" data-kn="nadd" data-type="knowledge">＋ 知识点</button>
        <span class="meta kn-bar-tip">按住 ⠿ 拖动可以调顺序、放进别的分类（电脑上直接拖名称也行）；点名称看它下面的全部内容</span></div>
      <div class="kn-tree surface" id="knTree">${roots.map((n) => rowHtml(n, 0)).join("")}
        ${real.length ? `<div class="kt-rootzone" id="ktRoot">拖到这里：放到第一级最后</div>` : ""}
        ${real.length ? "" : `<div class="kn-tree-empty">还没有分类和知识点。比如先建「第一章 函数与极限」，里面再加「夹逼定理」「重要极限」。</div>`}</div>`;
  }

  // ---------------- 知识框架：拖动排序（和原版「课内」一样：放到上半 / 下半 = 插到前面 / 后面，放到分类中间 = 放进去） ----------------
  let dg = null, dragJustEnded = 0;
  function dragStart(e, id, row) {
    const r = row.getBoundingClientRect();
    dg = { id, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, row, started: false, pid: e.pointerId, target: null };
  }
  function dragBegin() {
    const n = node(dg.id); if (!n) { dg = null; return; }
    dg.started = true;
    const g = dg.row.cloneNode(true);
    g.classList.add("kt-ghost"); g.style.width = dg.row.getBoundingClientRect().width + "px";
    document.body.appendChild(g); dg.ghost = g;
    // 被拖的这一枝（连同下级）变淡，不能拖进自己里面
    dg.bad = new Set(subtree(dg.id));
    document.querySelectorAll("#knTree .kt-row").forEach((r) => { if (dg.bad.has(+r.dataset.nid)) r.classList.add("kt-src"); });
    document.body.classList.add("kt-dragging");
    buzz(15);
  }
  function clearMarks() { document.querySelectorAll("#knTree .drop-before, #knTree .drop-after, #knTree .drop-into, #ktRoot.on").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into", "on")); }
  function dragMove(e) {
    if (!dg) return;
    if (!dg.started) { if (Math.hypot(e.clientX - dg.sx, e.clientY - dg.sy) < 5) return; dragBegin(); if (!dg) return; }
    e.preventDefault();
    dg.ghost.style.transform = `translate(${e.clientX - dg.ox}px, ${e.clientY - dg.oy}px)`;
    clearMarks(); dg.target = null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = el && el.closest("#ktRoot");
    if (zone) { zone.classList.add("on"); dg.target = { where: "root" }; }
    const row = el && el.closest("#knTree .kt-row");
    if (row && !zone) {
      const tid = +row.dataset.nid, t = node(tid);
      if (t && !dg.bad.has(tid)) {
        const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        let where = y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
        if (where === "into" && (t.type !== "folder" || t.is_system)) where = y < 0.5 ? "before" : "after";
        if (t.is_system) where = "after";       // 「未分类」永远在最上面：放在它后面 = 第一级第一个
        row.classList.add("drop-" + where); dg.target = { id: tid, where };
      }
    }
    // 拖到屏幕上下边缘时自动滚动
    const m = 60;
    if (e.clientY < m) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - m) window.scrollBy(0, 12);
  }
  async function dragEnd(cancel) {
    if (!dg) return;
    const d = dg; dg = null;
    document.body.classList.remove("kt-dragging");
    if (!d.started) return;
    dragJustEnded = Date.now();
    if (d.ghost) d.ghost.remove();
    clearMarks(); document.querySelectorAll("#knTree .kt-src").forEach((r) => r.classList.remove("kt-src"));
    const t = d.target, n = node(d.id); if (cancel || !t || !n) return;
    let parent, pos;
    if (t.where === "root") { parent = null; pos = null; }
    else {
      const tg = node(t.id); if (!tg) return;
      if (t.where === "into") { parent = tg.id; pos = null; }
      else if (tg.is_system) { parent = null; pos = 0; }
      else {
        parent = tg.parent_id || null;
        const sib = kids(tg.course_id, parent).filter((x) => !x.is_system && x.id !== n.id);
        pos = sib.findIndex((x) => x.id === tg.id) + (t.where === "after" ? 1 : 0);
      }
    }
    // 没动：同一个位置
    const cur = kids(n.course_id, n.parent_id).filter((x) => !x.is_system), oldPos = cur.findIndex((x) => x.id === n.id);
    if ((parent || null) === (n.parent_id || null) && (pos === oldPos || (pos == null && oldPos === cur.length - 1))) return;
    if (parent) { expanded.add(parent); saveOpen(); }
    // 先在本地挪好，界面马上跟着变；服务器失败的话 act 里会重新读回来
    n.parent_id = parent;
    const sib = kids(n.course_id, parent).filter((x) => !x.is_system && x.id !== n.id);
    sib.splice(pos == null ? sib.length : pos, 0, n); sib.forEach((x, i) => { x.sort_order = i; });
    index(); render();
    try { await act("kn_node_move", { p_id: n.id, p_parent: parent, p_pos: pos }); } catch (err) { refresh(true); }
  }
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.target.closest || !e.target.closest("#knTree")) return;
    const grip = e.target.closest("[data-grip]");
    const row = e.target.closest(".kt-row");
    if (!row || row.classList.contains("sys")) return;
    // 手机：只能按住 ⠿ 拖（不然没法上下滑页面）；电脑：名称上直接拖也行
    if (!grip && (e.pointerType !== "mouse" || !e.target.closest(".kt-name"))) return;
    if (grip) e.preventDefault();
    dragStart(e, +row.dataset.nid, row);
  });
  document.addEventListener("pointermove", (e) => { if (dg && e.pointerId === dg.pid) dragMove(e); }, { passive: false });
  document.addEventListener("pointerup", (e) => { if (dg && e.pointerId === dg.pid) dragEnd(false); });
  document.addEventListener("pointercancel", (e) => { if (dg && e.pointerId === dg.pid) dragEnd(true); });
  document.addEventListener("keydown", (e) => { if (dg && e.key === "Escape") dragEnd(true); });
  // 拖完松手时不要顺便「点开」那个名称
  document.addEventListener("click", (e) => { if (Date.now() - dragJustEnded < 300 && e.target.closest && e.target.closest("#knTree")) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ---------------- 弹窗 ----------------
  function dlg(html, cls) {
    const d = $("knDlg");
    d.className = "dlg kn-dlg" + (cls ? " " + cls : "");
    $("knDlgBody").innerHTML = html;
    if (!d.open) d.showModal();
    return d;
  }
  const closeDlg = () => { const d = $("knDlg"); if (d.open) d.close(); revokeUrl(); };
  let blobUrl = "";
  const revokeUrl = () => { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) {} blobUrl = ""; } };

  // 标签选择：树形勾选（「未分类」不是标签，不出现）
  function pickerHtml(cid, sel) {
    const walk = (pid, depth) => kids(cid, pid).filter((n) => !n.is_system).map((n) =>
      `<label class="kp-row" style="--d:${depth}"><input type="checkbox" name="kpn" value="${n.id}"${sel.has(n.id) ? " checked" : ""}><span>${n.type === "folder" ? "📁" : "💡"} ${esc(n.name)}</span></label>` + walk(n.id, depth + 1)).join("");
    const inner = walk(null, 0);
    return `<div class="kp">${inner || `<div class="meta">这门课还没有知识框架，可以先保存，之后在「知识框架」里建好再回来打标签。</div>`}
      <div class="kp-new"><input id="kpNew" maxlength="60" placeholder="没有合适的？新建一个知识点"><button type="button" class="small" data-kn="kpnew">＋ 新建</button></div></div>`;
  }

  function openForm(kind, mode, iid) {
    const c = course(view.cid), it = iid ? item(iid) : null;
    kind = it ? it.kind : kind; mode = it ? (it.file_id ? "file" : "manual") : mode;
    const k = KINDS[kind], sel = new Set(it ? tagsOf(it.id).map((n) => n.id) : []);
    const isA = kind === "assessment";
    const ext = it && it.file_id ? extOf(it.file_name) : "";
    const base = it ? (ext && it.title.toLowerCase().endsWith(ext.toLowerCase()) ? it.title.slice(0, -ext.length) : it.title) : "";
    dlg(`<form id="knForm" data-kind="${kind}" data-mode="${mode}" data-id="${iid || ""}">
      <h3>${it ? "编辑" : mode === "file" && !isA ? "上传" : "添加"}${k.name}<small>${esc(c ? c.name : "")}</small></h3>
      ${!it && mode === "file" ? `<label class="kn-file"><input type="file" id="knFile"><span id="knFileTxt">📎 选择文件（图片、PDF、文档都行，最大 5MB）</span></label>` : ""}
      <label>名称<span class="kn-name"><input id="knTitle2" maxlength="${ext ? 110 : 120}" value="${esc(base)}" placeholder="${isA ? "如 期中考试、实验报告二" : kind === "mistake" ? "如 极限计算 第 3 题" : "如 第三章 讲义要点"}" ${!it && mode === "file" ? "" : "required"}><em id="knExt">${esc(ext)}</em></span></label>
      ${isA ? `<label>截止日期<input type="date" id="knDeadline" value="${esc(it && it.deadline ? String(it.deadline).slice(0, 10) : "")}"></label>
        <label>考核要求<textarea id="knReq" rows="3" maxlength="4000" placeholder="可以不填：范围、形式、要带什么">${esc(it ? it.requirement : "")}</textarea></label>
        ${!it ? `<label class="kn-file sm"><input type="file" id="knFile"><span id="knFileTxt">📎 附件（可选）</span></label>` : ""}`
      : mode === "manual" ? `<label>${kind === "mistake" ? "题目内容" : "内容"}<textarea id="knContent" rows="6" maxlength="20000" placeholder="${kind === "mistake" ? "题目、你的错误答案、正确思路…" : "可以写很多行"}">${esc(it ? it.content : "")}</textarea></label>` : ""}
      ${kind === "note" ? `<label>来源<input id="knSource" maxlength="40" value="${esc(it ? it.source : mode === "file" ? "手动上传" : "自己整理")}" placeholder="如 课堂笔记、同学分享"></label>` : ""}
      ${isA ? "" : `<div class="kn-lab">标签（知识框架）</div>${pickerHtml(view.cid, sel)}`}
      <div class="nd-actions"><span class="meta" id="knSt"></span><span class="spacer"></span><button type="button" class="small" data-kn="close">取消</button><button type="submit" class="btn ink sm" id="knSave">保存</button></div>
    </form>`, "kn-form");
    const f = $("knFile");
    if (f) f.onchange = () => {
      const x = f.files[0]; if (!x) return;
      if (x.size > MAX_FILE) { $("knSt").textContent = "文件太大了：最多 5MB"; f.value = ""; return; }
      $("knFileTxt").textContent = "📎 " + x.name + " · " + fmtSize(x.size);
      if (!isA) { const e2 = extOf(x.name); $("knExt").textContent = e2; if (!$("knTitle2").value.trim()) $("knTitle2").value = e2 ? x.name.slice(0, -e2.length) : x.name; }
    };
    setTimeout(() => { const t = $("knTitle2"); if (t && mode !== "file") t.focus(); }, 50);
  }
  const readB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("读取文件失败")); r.readAsDataURL(file); });
  async function submitForm(form) {
    const kind = form.dataset.kind, mode = form.dataset.mode, iid = +form.dataset.id || null, st = $("knSt"), btn = $("knSave");
    const file = $("knFile") && $("knFile").files[0];
    if (!iid && mode === "file" && kind !== "assessment" && !file) { st.textContent = "先选一个文件"; return; }
    let title = $("knTitle2").value.trim();
    const ext = $("knExt").textContent;
    if (!title && file) title = ext ? file.name.slice(0, -ext.length) : file.name;
    if (!title) { st.textContent = "请输入名称"; $("knTitle2").focus(); return; }
    if (ext && !title.toLowerCase().endsWith(ext.toLowerCase())) title += ext;      // 文件后缀跟着文件走，不能改丢
    if (mode === "manual" && $("knContent") && !$("knContent").value.trim() && kind !== "assessment") { st.textContent = "请输入内容"; $("knContent").focus(); return; }
    const p = { title };
    if (iid) p.id = iid; else { p.course_id = view.cid; p.kind = kind; }
    if ($("knContent")) p.content = $("knContent").value;
    if ($("knSource")) p.source = $("knSource").value.trim();
    if ($("knDeadline")) p.deadline = $("knDeadline").value || null;
    if ($("knReq")) p.requirement = $("knReq").value;
    if (kind !== "assessment") p.nodes = [...form.querySelectorAll("input[name=kpn]:checked")].map((x) => +x.value);
    btn.disabled = true; st.textContent = file ? "上传中…" : "保存中…";
    try {
      if (file) {
        if (file.size > MAX_FILE) throw new Error("文件太大了：最多 5MB");
        p.file_id = await rpc("kn_file_put", { p_name: file.name, p_mime: file.type || "", p_data: await readB64(file) });
        p.file_type = file.type || ""; p.file_name = file.name;
      }
      await rpc("kn_item_save", { p });
      closeDlg(); tip(iid ? "已保存" : "已添加" + KINDS[kind].name + (kind === "assessment" && p.deadline ? "，截止日期已放进日历和提醒" : ""));
      await changed();
    } catch (e) { st.textContent = "没成功：" + (e.message || "请稍后再试"); btn.disabled = false; }
  }

  async function openItem(iid) {
    const it = item(iid); if (!it) { tip("这条内容已经不在了"); return; }
    const c = course(it.course_id), k = KINDS[it.kind];
    const meta = [k.name, c ? c.name : "", it.kind === "note" && it.source ? "来源：" + it.source : "", "添加于 " + dstr(it.created_at)].filter(Boolean);
    const body = it.kind === "assessment"
      ? `${it.deadline ? `<div class="kv-due">截止 ${esc(String(it.deadline).slice(0, 10))} · ${dueText(String(it.deadline).slice(0, 10))}</div>` : ""}${it.requirement ? `<div class="kv-text">${esc(it.requirement)}</div>` : ""}`
      : it.content ? `<div class="kv-text">${esc(it.content)}</div>` : "";
    dlg(`<form method="dialog" class="kv">
      <h3>${k.icon} ${esc(it.title)}</h3><div class="meta">${meta.map(esc).join(" · ")}</div>
      ${chips(it.id, true) || (it.kind === "assessment" ? "" : `<div class="meta kv-notag">还没打标签（在「知识框架 → 未分类」里能找到）</div>`)}
      ${body}
      ${it.file_id ? `<div class="kv-file" id="kvFile"><div class="meta">正在读取附件…</div></div>` : ""}
      <div class="nd-actions"><button type="button" class="small" data-kn="del" data-id="${it.id}" style="color:var(--red)">删除</button><span class="spacer"></span>
        <button type="button" class="small" data-kn="edit" data-id="${it.id}">编辑</button><button type="button" class="btn ink sm" data-kn="close">关闭</button></div>
    </form>`, "kn-view");
    if (!it.file_id) return;
    try {
      const f = await rpc("kn_file_get", { p_id: it.file_id });
      const bin = atob(f.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      revokeUrl();
      const mime = f.mime || it.file_type || "application/octet-stream";
      blobUrl = URL.createObjectURL(new Blob([u8], { type: mime }));
      const el = $("kvFile"); if (!el) return;
      const dl = `<a class="btn sm" href="${blobUrl}" download="${esc(f.name || it.file_name || it.title)}">⬇ 下载</a><a class="btn sm" href="${blobUrl}" target="_blank" rel="noopener">在新窗口打开</a>`;
      if (/^image\//.test(mime)) el.innerHTML = `<img src="${blobUrl}" alt="${esc(it.title)}"><div class="kv-acts">${dl}</div>`;
      else if (mime === "application/pdf") el.innerHTML = `<iframe src="${blobUrl}" title="${esc(it.title)}"></iframe><div class="kv-acts">${dl}</div>`;
      else if (/^text\/|json|xml/.test(mime) && u8.length < 200000) el.innerHTML = `<pre>${esc(new TextDecoder().decode(u8))}</pre><div class="kv-acts">${dl}</div>`;
      else el.innerHTML = `<div class="meta">这种文件（${esc(extOf(it.file_name) || mime)}）不能直接预览，下载后打开。</div><div class="kv-acts">${dl}</div>`;
    } catch (e) { const el = $("kvFile"); if (el) el.innerHTML = `<div class="meta">附件读取失败：${esc(e.message || "")}</div>`; }
  }

  function openNode(nid) {
    const n = node(nid); if (!n) return;
    const its = itemsUnder(nid), group = (k) => its.filter((i) => i.kind === k);
    const sec = (k) => { const g = group(k); return `<div class="kv-sec"><b>${KINDS[k].icon} 关联${KINDS[k].name}</b><span>${g.length}</span></div>` +
      (g.length ? g.map((i) => `<button class="kv-it" data-kn="item" data-id="${i.id}">${esc(i.title)}<small>${dstr(i.created_at)}</small></button>`).join("") : `<div class="meta kv-none">没有</div>`); };
    const c = course(n.course_id);
    dlg(`<form method="dialog" class="kv">
      <h3>${n.is_system ? "📥" : n.type === "folder" ? "📁" : "💡"} ${esc(n.name)}</h3>
      <div class="meta">${n.is_system ? "系统分类：没打任何标签的资料、笔记、错题都在这里" : (n.type === "folder" ? "分类（包含它下面所有知识点的内容）" : "知识点") + " · " + esc(c ? c.name : "")}</div>
      ${n.is_system ? "" : `<div class="kv-path">${pathOf(nid).map(esc).join(" › ")}</div>`}
      ${sec("mistake")}${sec("material")}${sec("note")}
      <div class="nd-actions"><span class="spacer"></span><button type="button" class="btn ink sm" data-kn="close">关闭</button></div>
    </form>`, "kn-view");
  }

  function askText(title, value, placeholder, onOk, extraHtml) {
    dlg(`<form id="knAsk"><h3>${esc(title)}</h3>${extraHtml || ""}<label><input id="knAskIn" maxlength="60" value="${esc(value || "")}" placeholder="${esc(placeholder || "")}" required></label>
      <div class="nd-actions"><span class="meta" id="knAskSt"></span><span class="spacer"></span><button type="button" class="small" data-kn="close">取消</button><button type="submit" class="btn ink sm">确定</button></div></form>`, "kn-ask");
    $("knAsk").onsubmit = async (e) => {
      e.preventDefault();
      const v = $("knAskIn").value.trim(); if (!v) return;
      const t = document.querySelector("#knAsk input[name=knt]:checked");
      try { await onOk(v, t ? t.value : null); closeDlg(); } catch (err) { $("knAskSt").textContent = err.message || "没成功"; }
    };
    setTimeout(() => { const i = $("knAskIn"); i.focus(); i.select(); }, 50);
  }
  const typePick = (def) => `<div class="kn-typ"><label><input type="radio" name="knt" value="folder"${def === "folder" ? " checked" : ""}> 📁 分类<small>里面还能再放</small></label><label><input type="radio" name="knt" value="knowledge"${def !== "folder" ? " checked" : ""}> 💡 知识点</label></div>`;

  function openMove(nid) {
    const n = node(nid); if (!n) return;
    const sib = kids(n.course_id, n.parent_id).filter((x) => !x.is_system), pos = sib.findIndex((x) => x.id === nid);
    const bad = new Set(subtree(nid));
    const opts = [`<option value="">（第一级）</option>`];
    const walk = (pid, d) => { for (const x of kids(n.course_id, pid)) { if (x.is_system || x.type !== "folder" || bad.has(x.id)) continue; opts.push(`<option value="${x.id}"${x.id === n.parent_id ? " selected" : ""}>${"　".repeat(d + 1)}📁 ${esc(x.name)}</option>`); walk(x.id, d + 1); } };
    walk(null, 0);
    dlg(`<form id="knMove"><h3>移动「${esc(n.name)}」</h3>
      <div class="kn-mv"><button type="button" class="btn sm" data-kn="mvup" data-id="${nid}"${pos <= 0 ? " disabled" : ""}>↑ 上移</button><button type="button" class="btn sm" data-kn="mvdown" data-id="${nid}"${pos >= sib.length - 1 ? " disabled" : ""}>↓ 下移</button></div>
      <label>移到哪个分类下面<select id="knMvTo">${opts.join("")}</select></label>
      <div class="nd-actions"><span class="meta" id="knMvSt"></span><span class="spacer"></span><button type="button" class="small" data-kn="close">取消</button><button type="submit" class="btn ink sm">移过去</button></div></form>`, "kn-ask");
    $("knMove").onsubmit = async (e) => {
      e.preventDefault();
      const to = $("knMvTo").value ? +$("knMvTo").value : null;
      if (to === (n.parent_id || null)) { closeDlg(); return; }
      try { await rpc("kn_node_move", { p_id: nid, p_parent: to, p_pos: null }); if (to) { expanded.add(to); saveOpen(); } closeDlg(); tip("已移动"); await changed(); }
      catch (err) { $("knMvSt").textContent = err.message || "没成功"; }
    };
  }
  const saveOpen = () => save("kn_open_v1", [...expanded].slice(-300));

  // ---------------- 事件 ----------------
  function go(page, cid, tab) {
    view.page = page; if (cid != null) view.cid = cid; if (tab) view.tab = tab; saveView();
    render(); window.scrollTo(0, 0);
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-kn]");
    if (!b || !b.closest("#studyBox, #knDlg")) return;
    const a = b.dataset.kn, id = +b.dataset.id || null;
    if (a !== "open" || !e.target.closest(".kn-more")) e.preventDefault();
    if (a === "retry") { loadErr = ""; render(); refresh(true); return; }
    if (a === "close") { closeDlg(); return; }
    if (a === "open") { if (e.target.closest(".kn-more")) return; go("course", id, view.cid === id ? view.tab : "material"); return; }
    if (a === "tab") { view.tab = b.dataset.t; saveView(); render(); return; }
    if (a === "import") {
      const names = timetableNames().filter((n) => !courses().some((c) => c.name === n));
      b.disabled = true;
      try { const n = await act("kn_course_import", { p_names: names }); tip(`已加入 ${n} 门课`); } catch (err) { b.disabled = false; }
      return;
    }
    if (a === "cmenu") {
      const c = course(id); if (!c) return;
      dlg(`<form method="dialog"><h3>${esc(c.name)}</h3><div class="kn-menu">
        <button type="button" data-kn="cpin" data-id="${id}">${c.pinned ? "📌 取消置顶" : "📌 置顶"}</button>
        <button type="button" data-kn="cren" data-id="${id}">✎ 改名</button>
        <button type="button" data-kn="cdel" data-id="${id}" class="danger">🗑 删除这门课</button></div>
        <div class="nd-actions"><span class="spacer"></span><button type="button" class="small" data-kn="close">取消</button></div></form>`, "kn-ask");
      return;
    }
    if (a === "cpin") { const c = course(id); closeDlg(); await act("kn_course_save", { p_id: id, p_name: null, p_pinned: !c.pinned }); return; }
    if (a === "cren") { const c = course(id); askText("改课程名", c.name, "课程名", (v) => act("kn_course_save", { p_id: id, p_name: v, p_pinned: null }, "已改名")); return; }
    if (a === "cdel") {
      const c = course(id), n = itemsOf(id).length;
      if (!confirm(`删除「${c.name}」？${n ? `里面的 ${n} 条资料、笔记、考核、错题和附件会一起删掉，` : ""}删除后不能恢复。`)) return;
      closeDlg(); await act("kn_course_del", { p_id: id }, "已删除"); if (view.cid === id) go("list"); return;
    }
    if (a === "new") { openForm(view.tab, b.dataset.mode, null); return; }
    if (a === "item") { if (e.target.closest(".ki-ops, .kn-chip")) return; openItem(id); return; }
    if (a === "edit") { closeDlg(); openForm(null, null, id); return; }
    if (a === "del") {
      const it = item(id); if (!it) return;
      if (!confirm(`删除「${it.title}」？${it.file_id ? "附件也会一起删掉，" : ""}删除后不能恢复。`)) return;
      closeDlg(); await act("kn_item_del", { p_id: id }, "已删除"); return;
    }
    if (a === "node") { openNode(id); return; }
    if (a === "tog") { expanded.has(id) ? expanded.delete(id) : expanded.add(id); saveOpen(); render(); return; }
    if (a === "nadd") {
      const par = id ? node(id) : null, def = b.dataset.type || (par ? "knowledge" : "folder");
      askText(par ? `在「${par.name}」里添加` : def === "folder" ? "新建分类" : "新建知识点", "", "名称，如 第一章 函数与极限", async (v, t) => {
        await act("kn_node_add", { p_course: view.cid, p_parent: id, p_name: v, p_type: t || def });
        if (id) { expanded.add(id); saveOpen(); render(); }
      }, typePick(def));
      return;
    }
    if (a === "nren") { const n = node(id); askText("改名", n.name, "名称", (v) => act("kn_node_rename", { p_id: id, p_name: v })); return; }
    if (a === "ndel") {
      const n = node(id), sub = subtree(id).length - 1;
      if (!confirm(`删除「${n.name}」？${sub ? `它下面的 ${sub} 个分类 / 知识点也会一起删掉。` : ""}打过这个标签的资料、笔记、错题不会删，只是去掉这个标签。`)) return;
      await act("kn_node_del", { p_id: id }, "已删除"); return;
    }
    if (a === "nmove") { openMove(id); return; }
    if (a === "mvup" || a === "mvdown") {
      const n = node(id), sib = kids(n.course_id, n.parent_id).filter((x) => !x.is_system), pos = sib.findIndex((x) => x.id === id);
      const np = a === "mvup" ? pos - 1 : pos + 1; if (np < 0 || np >= sib.length) return;
      closeDlg(); await act("kn_node_move", { p_id: id, p_parent: n.parent_id || null, p_pos: np }); return;
    }
    if (a === "kpnew") {
      const inp = $("kpNew"), v = inp.value.trim(); if (!v) { inp.focus(); return; }
      const form = $("knForm"), keep = new Set([...form.querySelectorAll("input[name=kpn]:checked")].map((x) => +x.value));
      try {
        const nid = await rpc("kn_node_add", { p_course: view.cid, p_parent: null, p_name: v, p_type: "knowledge" });
        await refresh(true); keep.add(nid);
        form.querySelector(".kp").outerHTML = pickerHtml(view.cid, keep);
        try { save(LS_REV, { t: Date.now() }); } catch (err) {}
      } catch (err) { $("knSt").textContent = err.message || "没成功"; }
      return;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches || !e.target.matches(".kn-course, .kn-item")) return;
    e.target.click();
  });
  document.addEventListener("submit", (e) => { if (e.target.id === "knForm") { e.preventDefault(); submitForm(e.target); } });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "knQ") return;
    q = e.target.value; const pos = e.target.selectionStart; render();
    const s = $("knQ"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (err) {} }
  });
  $("knDlg").addEventListener("close", revokeUrl);
  $("knDlg").addEventListener("click", (e) => { if (e.target === $("knDlg")) closeDlg(); });
  $("knBack").onclick = () => { if (view.page === "course") go("list"); else showView("home"); };
  $("knAdd").onclick = () => {
    if (view.page !== "course") { askText("添加课程", "", "课程名，如 高等数学A(1)", (v) => act("kn_course_save", { p_id: null, p_name: v, p_pinned: null }, "已添加")); return; }
    if (view.tab === "tree") { const b = document.querySelector('#studyBox [data-kn="nadd"][data-type="folder"]'); if (b) b.click(); return; }
    openForm(view.tab, view.tab === "assessment" ? "manual" : "file", null);
  };

  // 从首页 / 日历的考核点过来：直接打开那一条
  window.openStudyItem = (iid) => { const it = item(iid); if (!it) { showView("study"); return; } view.page = "course"; view.cid = it.course_id; view.tab = it.kind; saveView(); showView("study"); setTimeout(() => openItem(iid), 60); };
  window.Study = { refresh: (f) => refresh(f), state: () => data, view: () => view };
  window.renderStudy = () => { render(); if (me() && (!mine() || Date.now() - lastFetch > 20000)) refresh(); };

  // 别的设备改了（kn_rev_v1 同步过来）→ 重新读；登录 / 换账号后也读一次
  try { Sync.onChange((set) => { if (set && set.has && set.has(LS_REV)) refresh(true); }); } catch (e) {}
  document.addEventListener("visibilitychange", () => { if (!document.hidden && me() && Date.now() - lastFetch > 60000 && (currentView() === "study" || mine())) refresh(); });
  let lastUid = null;
  setInterval(() => { const u = me() ? me().id : null; if (u !== lastUid) { lastUid = u; if (u && data && data.uid !== u) data = null; if (u) refresh(true); else { data = null; try { renderAll(); } catch (e) {} } } }, 1500);
  index();
})();
