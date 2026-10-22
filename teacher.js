/* 5.8.0 老师专属：首页「教学工作台」+「班级情况」页（谁没看、谁没完成、每个同学的情况）+ 教师组（老师之间）
 * 依赖 app.js：currentUser currentClass myClasses teacherMode kindOf KIND_NAME showView esc save LS_CUR_CLASS renderClassBar loadClass loadMyClasses ago
 * 数据库函数在 5.8.0 SQL：teacher_classes teacher_overview create_class_kind item_viewers */
(function () {
  "use strict";
  const T = { classes: null, at: 0, cid: null, days: 14, ov: null, tab: "stu", filter: "all", err: "", loading: false };
  window.TEACH = T;
  const $t = (id) => document.getElementById(id);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fmtDay = (t) => { const m = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(t || ""); return m ? `${+m[2]}/${+m[3]}${m[4] ? " " + m[4] : ""}` : "时间待定"; };
  const sinceDays = (t) => (t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : null);

  async function loadClasses(force) {
    if (!force && T.classes && Date.now() - T.at < 60000) return T.classes;
    // 6.9.2 manage_classes = 我带的班 + 我是班委的班（老的服务器没有就退回 teacher_classes）
    try {
      try { T.classes = await CCAuth.rpc("manage_classes"); }
      catch (e0) { if (!/manage_classes|PGRST202|Could not find/i.test(e0.message)) throw e0; T.classes = ((await CCAuth.rpc("teacher_classes")) || []).map((c) => ({ ...c, role: "teacher" })); }
      T.at = Date.now(); T.err = "";
    }
    catch (e) { T.classes = T.classes || []; T.err = /teacher_classes|function|schema/i.test(e.message) ? "数据库还没升级到 5.8.0，请先执行 5.8.0 的 SQL" : e.message; }
    return T.classes;
  }
  // 我带的班（含团队）和教师组分开
  const teachClasses = () => (T.classes || []).filter((c) => c.kind !== "staff");
  const staffGroups = () => {
    const own = (T.classes || []).filter((c) => c.kind === "staff");
    const joined = (myClasses || []).filter((c) => kindOf(c) === "staff" && !own.some((o) => o.id === c.id)).map((c) => ({ id: c.id, name: c.name, joined: true }));
    return own.concat(joined);
  };

  // ---------- 首页：教学工作台 ----------
  function home() {
    const view = document.querySelector('.view[data-view="home"]'); if (!view) return;
    let box = $t("teachHome");
    const on = typeof teacherMode === "function" && teacherMode();
    const own = !on && typeof overviewMode === "function" && overviewMode();   // 自己建了班的管理员 / 班委：首页只加一张卡片
    const eb = view.querySelector(".studio-home-heading .studio-eyebrow"), h2 = view.querySelector(".studio-home-heading h2");
    if (h2 && !h2.dataset.t0) { h2.dataset.t0 = h2.firstChild.textContent; eb.dataset.t0 = eb.textContent; }
    if (h2 && !own) { h2.firstChild.textContent = on ? "教学工作台" : (window.CC_HOME_TITLE || h2.dataset.t0); eb.textContent = on ? "今天也辛苦了" : (window.CC_HOME_EYEBROW || eb.dataset.t0); }
    if (!on && !own) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("section"); box.id = "teachHome"; box.className = "t-home surface";
      const n = $t("notice"); n.parentNode.insertBefore(box, n.nextSibling);
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tgo]"); if (!b) return;
        if (b.dataset.tgo) T.cid = b.dataset.tgo;
        showView("teach");
      });
    }
    const draw = () => {
      const cl = teachClasses();
      box.innerHTML = `<div class="t-home-h"><b>${own ? "📊 我管理的班级" : "👩‍🏫 我的班级"}</b><span class="spacer"></span><button class="small" data-ckpanel="1">📋 签到</button><button class="small" data-tgo="">班级情况 ›</button></div>
        ${T.err ? `<div class="meta">${esc(T.err)}</div>` : !T.classes ? `<div class="meta">加载中…</div>`
        : cl.length ? `<div class="t-home-l">${cl.map((c) => `<button class="t-hc" data-tgo="${esc(c.id)}"><b>${esc(c.name)}</b>
            <span>${c.total} 人${c.pending ? ` · <em>${c.pending} 人待审批</em>` : ""}</span><small>近 7 天完成作业 ${c.done7} 次 · 这两周作业 ${c.hw} 项</small></button>`).join("")}</div>`
        : `<div class="meta">还没有班级。<a href="class.html">创建班级 →</a> 建好后把班级码发给同学，他们加入后这里就能看到每个人的情况。</div>`}
        <div class="t-home-tip">发布作业后，在「班级情况」里能看到谁还没看、谁还没完成，一键复制名字到群里提醒。</div>`;
    };
    draw();
    loadClasses().then(draw);
  }
  (window.CC_HOME_HOOKS ||= []).push(home);

  // ---------- 班级情况页 ----------
  async function render(force) {
    const box = $t("teachView"); if (!box) return;
    if (!currentUser) { box.innerHTML = `<div class="aempty surface">登录后才能看班级情况</div>`; return; }
    if (!T.classes || force) box.innerHTML = `<div class="aempty surface">加载中…</div>`;
    await loadClasses(force);
    const cl = teachClasses();
    if (!T.cid || !cl.some((c) => c.id === T.cid)) T.cid = (currentClass && cl.some((c) => c.id === currentClass.id) ? currentClass.id : cl[0] && cl[0].id) || null;
    if (T.cid && (force || !T.ov || T.ov.class.id !== T.cid || T.ov._days !== T.days)) {
      T.loading = true; paint();
      try { T.ov = await CCAuth.rpc("teacher_overview", { cid: T.cid, days: T.days }); T.ov._days = T.days; T.err = ""; }
      catch (e) { T.ov = null; T.err = e.message; }
      T.loading = false;
    }
    paint();
  }
  window.renderTeach = () => render(false);
  async function loadCk() {
    const cid = T.cid; if (!cid || T.ckBusy === cid) return;
    T.ckBusy = cid;
    try { T.ck = { cid, list: (await CCAuth.rpc("checkin_list", { cid })) || [] }; } catch (e) { T.ck = { cid, list: [] }; }
    T.ckBusy = null; if (T.cid === cid) paint();
  }

  function paint() {
    const box = $t("teachView"); if (!box) return;
    const cl = teachClasses(), o = T.ov && T.ov.class && T.ov.class.id === T.cid ? T.ov : null;
    let html = "";
    if (T.err && !o) html += `<div class="aempty surface">${esc(T.err)}</div>`;
    html += `<div class="t-cls">${cl.map((c) => `<button class="t-chip${c.id === T.cid ? " on" : ""}" data-tcid="${esc(c.id)}">${KIND_NAME[c.kind] ? esc(KIND_NAME[c.kind]) + " · " : ""}${esc(c.name)}${c.role === "monitor" ? "（班委）" : ""}${c.ck_open ? ` <i class="t-ck">签到中</i>` : ""}${c.pending ? `<em>${c.pending}</em>` : ""}</button>`).join("")}
      <a class="t-chip add" href="class.html">＋ 建班</a></div>`;
    if (!cl.length && !T.err) html += `<div class="aempty surface">你还没有自己带的班。<a href="class.html">创建班级 →</a></div>`;
    if (o) {
      const st = o.students || [], hwN = o.hw_count || 0, sumDone = st.reduce((a, s) => a + Math.min(s.hw_done, hwN || s.hw_done), 0);
      const rate = pct(sumDone, hwN * st.length);
      const lazy = st.filter((s) => hwN && s.hw_done < hwN), quiet = st.filter((s) => { const d = sinceDays(s.last_active); return d == null || d >= 7; });
      const list = T.filter === "lazy" ? lazy : T.filter === "quiet" ? quiet : st;
      html += `<div class="t-ov surface">
        <div class="t-ov-h"><b>${esc(o.class.name)}</b>${o.class.code ? `<button class="small" data-tcopy="${esc(o.class.code)}" title="复制班级码">班级码 ${esc(o.class.code)} ⧉</button>` : ""}<span class="spacer"></span>
          <select id="tDays" aria-label="统计范围">${[7, 14, 30].map((d) => `<option value="${d}"${d === T.days ? " selected" : ""}>最近 ${d} 天</option>`).join("")}</select></div>
        <div class="t-kpi">
          <div><b>${o.total}</b><span>学生</span></div>
          <div><b>${hwN}</b><span>已到期作业</span></div>
          <div><b>${hwN && st.length ? rate + "%" : "–"}</b><span>作业完成率</span></div>
          <a href="class.html" class="${o.pending ? "warn" : ""}"><b>${o.pending}</b><span>待审批 ›</span></a>
        </div>
        ${T.loading ? `<div class="meta">更新中…</div>` : ""}
      </div>
      <div class="t-tabs"><button data-ttab="stu" class="${T.tab === "stu" ? "on" : ""}">👥 每个同学</button><button data-ttab="items" class="${T.tab === "items" ? "on" : ""}">📋 发布的事项（谁看了）</button><button data-ttab="ck" class="${T.tab === "ck" ? "on" : ""}">📋 签到</button>${teacherMode() ? `<button data-ttab="staff" class="${T.tab === "staff" ? "on" : ""}">🧑‍🏫 教师组</button>` : ""}</div>`;
      if (T.tab === "stu") {
        html += `<div class="t-filter"><button data-tf="all" class="${T.filter === "all" ? "on" : ""}">全部 ${st.length}</button><button data-tf="lazy" class="${T.filter === "lazy" ? "on" : ""}">作业没做完 ${lazy.length}</button><button data-tf="quiet" class="${T.filter === "quiet" ? "on" : ""}">7 天没打开 ${quiet.length}</button>
          <span class="spacer"></span>${list.length && T.filter !== "all" ? `<button class="small" data-tnames="${esc(list.map((s) => "@" + (s.name || s.account)).join(" "))}">复制名字</button>` : ""}</div>
          <div class="t-stu surface">${list.length ? list.map((s) => { const d = sinceDays(s.last_active), p = hwN ? pct(Math.min(s.hw_done, hwN), hwN) : 0;
            return `<div class="t-s"><span class="av sm">${esc([...(s.name || "?")][0])}</span><span class="t-sn"><b data-user="${esc(s.user_id)}" class="ulink">${esc(s.name || s.account)}</b>${s.role === "monitor" ? "<i>班委</i>" : ""}<small>${d == null ? "还没打开过" : d === 0 ? "今天打开过" : d + " 天前打开过"} · 看过 ${s.seen} 条</small></span>
              <span class="t-sp"><span class="bar"><i style="width:${p}%" class="${p >= 80 ? "ok" : p < 40 ? "low" : ""}"></i></span><small>作业 ${s.hw_done}${hwN ? "/" + hwN : ""}</small></span></div>`; }).join("")
            : `<div class="meta">${T.filter === "all" ? "还没有同学加入。把班级码发到班级群，同学输入班级码就能加入。" : "没有 🎉"}</div>`}</div>
          <p class="meta">「作业」= 最近 ${o.days} 天到期的作业里，同学自己勾了完成的项数；「看过」= 打开过作业页或点开过事项。老师自己看不算。</p>`;
      } else if (T.tab === "items") {
        const it = o.items || [];
        html += `<div class="t-items surface">${it.length ? it.map((x) => { const hw = x.type === "作业";
          return `<div class="t-it"><div class="t-it-h"><span class="tag t-${esc(x.type)}">${esc(x.type)}</span><b>${esc(x.subject || x.summary || x.type)}</b></div>
            <div class="t-it-m"><span>${esc(fmtDay(x.time))}${x.by ? " · " + esc(x.by) + " 发布" : ""}</span><span class="spacer"></span><button class="link" data-tview="${esc(x.id)}" data-ttitle="${esc(x.subject || x.summary || x.type)}">名单 ›</button></div>
            <div class="t-it-b"><span>已读</span><span class="bar"><i style="width:${pct(x.views, o.total)}%"></i></span><small>${x.views}/${o.total}</small></div>
            ${hw ? `<div class="t-it-b"><span>完成</span><span class="bar"><i class="ok" style="width:${pct(x.done, o.total)}%"></i></span><small>${x.done}/${o.total}</small></div>` : ""}</div>`; }).join("")
          : `<div class="meta">最近 ${o.days} 天没有事项。去首页「发布事项」或「AI 整理」发一条吧。</div>`}</div>`;
      }
    }
    // 6.9.2 签到：这个班最近的签到（发起、投屏、名单都在签到面板里）
    if (T.tab === "ck" && T.cid) {
      const ck = T.ck && T.ck.cid === T.cid ? T.ck.list : null;
      if (!ck) loadCk();
      html += `<div class="t-items surface"><div class="t-home-h"><b>📋 签到</b><span class="spacer"></span><button class="btn ink sm" data-ckpanel="1" data-ckcid="${esc(T.cid)}">＋ 发起签到 / 投屏</button></div>
        ${!ck ? `<div class="meta">加载中…</div>` : ck.length ? ck.map((x) => `<div class="t-it" data-ckone="${x.id}" style="cursor:pointer"><div class="t-it-h"><span class="tag">${x.mode === "code" ? "🔢 动态码" : x.mode === "both" ? "📍+🔢" : "📍 位置"}</span><b>${esc(x.title)}</b><span class="spacer"></span><small>${x.open ? "进行中" : "已结束"}</small></div>
            <div class="t-it-m"><span>${(() => { const d = new Date(x.starts_at); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })()} · ${esc(x.by || "")}发起${x.place ? " · " + esc(x.place) : ""}</span><span class="spacer"></span><button class="link" data-ckone="${x.id}">名单 ›</button></div>
            <div class="t-it-b"><span>已签</span><span class="bar"><i class="ok" style="width:${pct(x.signed, x.members)}%"></i></span><small>${x.signed}/${x.members}</small></div></div>`).join("")
          : `<div class="meta">最近 7 天没有签到。点右上角「发起签到」，课堂上投屏动态码，同学微信一扫就签上。</div>`}</div>`;
    }
    if ((T.tab === "staff" && teacherMode()) || (!o && T.tab !== "ck" && teacherMode())) html += staffHtml();
    html += `<div class="t-work surface"><div class="t-home-h"><b>🗂 我自己的工作</b></div>
      <div class="t-work-b"><button class="small" data-twork="mine">✏️ 记一件事</button><button class="small" data-twork="pub">📣 发布班级事项</button><button class="small" data-twork="ai">✨ AI 整理群消息</button><button class="small" data-twork="course">📚 我的课表</button><button class="small" data-twork="cal">📅 日历</button></div>
      <small class="meta">自己记的事项只有你能看到；课表可以拍照导入，也能发布给全班。</small></div>`;
    box.innerHTML = html;
  }
  function staffHtml() {
    const g = staffGroups();
    return `<div class="t-staff surface"><div class="t-home-h"><b>🧑‍🏫 教师组</b><span class="spacer"></span><button class="small" data-tstaff="new">＋ 新建教师组</button><a class="small btnlike" href="class.html">输入组码加入</a></div>
      ${g.length ? g.map((c) => `<button class="t-g" data-tgroup="${esc(c.id)}"><b>${esc(c.name)}</b><small>${c.joined ? "我加入的" : `我建的 · ${c.total || 0} 位老师${c.code ? " · 组码 " + esc(c.code) : ""}`}</small><span>进入 ›</span></button>`).join("")
        : `<div class="meta">教研组、年级组、备课组……建一个教师组，把组码发给同事。只有老师身份能加入。</div>`}
      <small class="meta">教师组和班级一样：可以发通知、共享日程（比如教研活动、监考安排）、在班级墙讨论，还能一起维护课表。</small></div>`;
  }

  async function newStaff() {
    const name = prompt("教师组的名字（例如：高一数学备课组、初二年级组）");
    if (!name || !name.trim()) return;
    try {
      const r = await CCAuth.rpc("create_class_kind", { cname: name.trim(), ckind: "staff" });
      await loadClasses(true);
      try { await loadMyClasses(); } catch (e) {}
      alert(`「${r.name}」建好了，组码：${r.code}\n把组码发给同事，他们在「班级」页输入组码就能加入（只有老师身份能加入）。`);
      paint();
    } catch (e) { alert(e.message); }
  }
  function enter(cid) {
    const c = (myClasses || []).find((x) => x.id === cid);
    if (!c) { alert("这个组还没出现在你的班级列表里，刷新一下网页再试"); return; }
    currentClass = c; save(LS_CUR_CLASS, c.id); renderClassBar(); loadClass(); showView("wall");
  }

  document.addEventListener("click", (e) => {
    const box = $t("teachView");
    if (e.target.id === "tRefresh") { render(true); return; }
    if (!box || !box.contains(e.target)) return;
    const q = (s) => e.target.closest(s);
    let b;
    if ((b = q("[data-tcid]"))) { T.cid = b.dataset.tcid; T.filter = "all"; render(false); }
    else if ((b = q("[data-ttab]"))) { T.tab = b.dataset.ttab; if (T.tab === "ck") T.ck = null; paint(); }
    else if ((b = q("[data-tf]"))) { T.filter = b.dataset.tf; paint(); }
    else if ((b = q("[data-tview]"))) { if (window.hwOpenViewers) window.hwOpenViewers(b.dataset.tview, T.cid, b.dataset.ttitle); }
    else if ((b = q("[data-tnames]")) || (b = q("[data-tcopy]"))) {
      const t = b.dataset.tnames || b.dataset.tcopy;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { const o = b.textContent; b.textContent = "已复制 ✓"; setTimeout(() => { b.textContent = o; }, 1500); }).catch(() => prompt("复制：", t));
    }
    else if ((b = q("[data-tstaff]"))) newStaff();
    else if ((b = q("[data-tgroup]"))) enter(b.dataset.tgroup);
    else if ((b = q("[data-twork]"))) {
      const w = b.dataset.twork;
      if (w === "cal") showView("calendar");
      else { showView("home"); const id = { mine: "qMine", pub: "cAddBtn", ai: "cIngestBtn", course: "qCourse" }[w]; setTimeout(() => { const x = $t(id); if (x) x.click(); }, 50); }
    }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "tDays") { T.days = +e.target.value; render(false); } });
})();
