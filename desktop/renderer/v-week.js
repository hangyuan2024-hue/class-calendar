// 课程表周视图：节次 × 周一到周日，铺满屏幕；红线标出现在的时间；点课看详情和相关作业
"use strict";
App.views.week = {
  title: "课程表", icon: "week", off: 0, sel: null,
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>课程表</h1><div class="sub" id="wkSub"></div></div><span class="grow"></span>
        <div class="row"><button class="btn iconbtn" id="wkPrev" title="上一周（←）">${icon("left")}</button><button class="btn" id="wkNow" title="回到本周（T）">本周</button><button class="btn iconbtn" id="wkNext" title="下一周（→）">${icon("right")}</button></div>
        <button class="btn" id="wkImport" title="把教务系统的课表截图粘贴进来，自动识别（Ctrl+V）">${icon("image")}截图导入</button>
        <button class="btn" id="wkEdit" title="手动添加、修改课程，设置第 1 周和上课时间">${icon("edit")}编辑课程表</button>
        <button class="btn iconbtn" id="wkMore" title="设成壁纸、导出 PDF、打印">⋯</button></div>
      <div class="vbody wk-body"><div class="wk-wrap"><div class="wk-grid" id="wkGrid"></div></div><aside class="wk-insp hidden" id="wkInsp"></aside></div>`;
    $("#wkPrev", el).onclick = () => this.shift(-1);
    $("#wkNext", el).onclick = () => this.shift(1);
    $("#wkNow", el).onclick = () => { this.off = 0; this.update(); };
    el.addEventListener("click", (e) => {
      const c = e.target.closest(".wk-c"); if (c) { this.sel = { id: c.dataset.id, day: c.dataset.day }; this.inspect(); $$(".wk-c", el).forEach((x) => x.classList.toggle("sel", x === c)); return; }
      const it = e.target.closest(".wk-it[data-k]"); if (it) { App.go("tasks", { key: it.dataset.k }); return; }
      const x = e.target.closest("[data-close]"); if (x) { this.sel = null; $("#wkInsp", el).classList.add("hidden"); $$(".wk-c.sel", el).forEach((n) => n.classList.remove("sel")); }
    });
    el.addEventListener("dblclick", (e) => { const cell = e.target.closest(".wk-cell"); if (cell) menu(e.clientX, e.clientY, [{ label: "在这里加一门课", icon: "plus", fn: () => CourseEd.editOne(null, { day: M.weekday0(M.fromKey(cell.dataset.day)), start: +cell.dataset.p }) }, { label: "这个时间记一件事", icon: "edit", fn: () => editItem(null, { day: cell.dataset.day, time: cell.dataset.t }) }]); });
    $("#wkEdit", el).onclick = () => CourseEd.open();
    $("#wkImport", el).onclick = () => CourseEd.importShot();
    $("#wkMore", el).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); this.moreMenu(r.right - 220, r.bottom + 4); };
    // 在课程表页面直接 Ctrl+V 一张截图：识别导入
    document.addEventListener("paste", (e) => { if (App.view !== "week" || overlayOpen() || e.target.closest("input,textarea")) return; const f = [...(e.clipboardData || {}).files || []].find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); CourseEd.importShot(f); } });
    new ResizeObserver(() => this.nowLine()).observe($("#wkGrid", el));
  },
  shift(n) { this.off += n; this.update(); },
  moreMenu(x, y) {
    call("wallpaper:state").then((w) => menu(x, y, [
      { label: "把这周课表设成桌面壁纸", icon: "image", fn: () => this.wallpaper() },
      w.on ? { label: "换回原来的壁纸", icon: "close", fn: () => call("wallpaper:restore").then(() => toast("已换回原来的壁纸")) } : null,
      "-",
      { label: "导出这周课表 + 作业（PDF）", icon: "export", fn: () => this.exportPdf() },
      { label: "课表存成图片", icon: "image", fn: () => call("export:image", timetableHtml(this.monday(), { image: true }), "课程表-" + M.dayKey(this.monday()), 1400, 900).then((f) => f && toast("已保存图片")) },
      { label: "打印", icon: "print", fn: () => call("print", timetableHtml(this.monday(), { print: true })) },
    ]));
  },
  async wallpaper() {
    if (!(App.S.courses.courses || []).length) return toast("先导入课程表", { bad: true });
    if (App.S.platform !== "win32") return toast("设置壁纸只支持 Windows", { bad: true });
    toast("正在生成壁纸…");
    try { await call("wallpaper:set", timetableHtml(this.monday(), { wallpaper: true })); toast("已经设成桌面壁纸，每周一会自动换成新一周的课表", { action: { label: "换回原来的", fn: () => call("wallpaper:restore") } }); } catch (e) {}
  },
  exportPdf() { return call("export:pdf", timetableHtml(this.monday(), { print: true }), "课程表-" + M.dayKey(this.monday()), true).then((f) => f && toast("已导出 PDF")); },
  monday() { const now = App.now(); return M.addDays(now, -M.weekday0(now) + this.off * 7); },
  update() {
    const S = App.S, el = this.el, now = App.now(), mon = this.monday(), meta = S.courses.meta || {}, times = M.periodTimes(meta), all = S.courses.courses || [];
    const wk = M.weekOf(meta, mon), sun = M.addDays(mon, 6);
    $("#wkSub", el).textContent = `${wk ? "第 " + wk + " 周 · " : ""}${mon.getMonth() + 1}月${mon.getDate()}日 – ${sun.getMonth() + 1}月${sun.getDate()}日${this.off ? (this.off > 0 ? `（${this.off} 周后）` : `（${-this.off} 周前）`) : "（本周）"}`;
    $("#wkNow", el).disabled = !this.off;
    const grid = $("#wkGrid", el);
    if (!all.length) { grid.className = "wk-grid"; grid.style.cssText = ""; grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:80px"><b>📚</b>还没有课程表<br><br><button class="btn primary" data-cimp>${icon("image")}截图导入</button> <button class="btn" data-cedit>${icon("edit")}手动填写</button><br><br><span class="muted">在教务系统里把课表截图（Win+Shift+S），回到这里按 Ctrl+V 就能自动识别。网页和手机上的课程表会自动同步过来。</span></div>`; grid.querySelector("[data-cimp]").onclick = () => CourseEd.importShot(); grid.querySelector("[data-cedit]").onclick = () => CourseEd.open(); return; }
    const maxP = Math.max(8, ...all.map((c) => c.end || c.start));
    const nP = Math.min(times.length, Math.max(maxP, times.filter(Boolean).length > 10 ? 10 : maxP));
    const weekend = all.some((c) => c.day >= 5);
    // 每节课之间如果隔了 40 分钟以上（午饭、晚饭），中间加一条细的「休息」行
    const rows = []; let r = 3;
    for (let p = 1; p <= nP; p++) {
      if (p > 1) { const a = M.toMin((times[p - 2] || "").split("-")[1]), b = M.toMin((times[p - 1] || "").split("-")[0]); if (a != null && b != null && b - a >= 40) rows.push({ gap: true, label: b < 15 * 60 ? "午休" : "晚饭", r: r++ }); }
      rows.push({ p, r: r++, t: times[p - 1] || "" });
    }
    const pRow = {}; rows.forEach((x) => x.p && (pRow[x.p] = x.r));
    grid.className = "wk-grid" + (weekend ? "" : " nowk");
    grid.style.gridTemplateRows = `auto max-content ${rows.map((x) => (x.gap ? "16px" : "minmax(54px,1fr)")).join(" ")}`;
    const days = Array.from({ length: 7 }, (_, i) => M.addDays(mon, i)), tk = M.dayKey(now);
    const items = App.items().filter((x) => !x.hidden && x.day);
    let html = `<div class="wk-corner" style="grid-row:1/3"></div>`;
    days.forEach((d, i) => {
      const k = M.dayKey(d), its = M.sortItems(items.filter((x) => x.day === k));
      html += `<div class="wk-dh${k === tk ? " today" : ""}" style="grid-column:${i + 2}"><span>周${"一二三四五六日"[i]}</span><b>${d.getMonth() + 1}/${d.getDate()}</b></div>`;
      html += `<div class="wk-its${k === tk ? " today" : ""}" style="grid-column:${i + 2};grid-row:2">${its.slice(0, 3).map((x) => `<span class="wk-it${x.done ? " done" : ""}" data-k="${esc(x.key)}" style="--c:${tc(x.type)}" title="${esc(x.type + "：" + x.title + (x.time ? " " + x.time : ""))}">${x.time ? `<i>${x.time}</i>` : ""}${esc(x.title)}</span>`).join("")}${its.length > 3 ? `<span class="wk-more" data-k="${esc(its[3].key)}">+${its.length - 3}</span>` : ""}</div>`;
    });
    for (const x of rows) {
      if (x.gap) { html += `<div class="wk-gap" style="grid-row:${x.r}"><span>${x.label}</span></div>`; continue; }
      const [a, b] = x.t.split("-");
      html += `<div class="wk-p" style="grid-row:${x.r}"><b>${x.p}</b><span>${a || ""}</span><span>${b || ""}</span></div>`;
      days.forEach((d, i) => (html += `<div class="wk-cell${M.dayKey(d) === tk ? " today" : ""}" data-day="${M.dayKey(d)}" data-p="${x.p}" data-t="${a || ""}" style="grid-row:${x.r};grid-column:${i + 2}"></div>`));
    }
    days.forEach((d, i) => {
      for (const c of M.coursesOn(S.courses, d)) {
        if (!pRow[c.start]) continue;
        const end = Math.min(c.end || c.start, nP), past = M.dayKey(d) < tk || (M.dayKey(d) === tk && M.toMin(c.tEnd) <= now.getHours() * 60 + now.getMinutes());
        const sel = this.sel && this.sel.id === String(c.id) && this.sel.day === M.dayKey(d);
        html += `<div class="wk-c${past ? " past" : ""}${sel ? " sel" : ""}" data-id="${esc(c.id)}" data-day="${M.dayKey(d)}" style="--c:${c.color};grid-column:${i + 2};grid-row:${pRow[c.start]}/${pRow[end] + 1}" title="${esc(c.name)}"><b>${esc(c.name)}</b>${c.location ? `<span>${icon("place")}${esc(c.location)}</span>` : ""}${c.teacher && end > c.start ? `<span class="t">${esc(c.teacher)}</span>` : ""}</div>`;
      }
    });
    html += `<div class="wk-now hidden" id="wkNowLine"><i></i></div>`;
    grid.innerHTML = html;
    this.nowLine();
    if (this.sel) this.inspect();
  },
  tick() { this.nowLine(); },
  // 红线：现在的时间在今天那一列的位置
  nowLine() {
    const el = this.el, line = el && $("#wkNowLine", el); if (!line) return;
    const now = App.now(), tk = M.dayKey(now), nm = now.getHours() * 60 + now.getMinutes();
    const cells = $$(`.wk-cell[data-day="${tk}"]`, el);
    line.classList.add("hidden");
    if (!cells.length) return;
    const times = M.periodTimes(App.S.courses.meta);
    let y = null;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], p = +c.dataset.p, [a, b] = (times[p - 1] || "").split("-").map(M.toMin);
      if (a == null) continue;
      if (nm < a) { y = c.offsetTop - (i ? 0 : 0); if (i === 0) return; break; }
      if (nm <= b) { y = c.offsetTop + ((nm - a) / (b - a)) * c.offsetHeight; break; }
    }
    if (y == null) return;
    const c0 = cells[0];
    Object.assign(line.style, { top: y + "px", left: c0.offsetLeft + "px", width: c0.offsetWidth + "px" });
    line.classList.remove("hidden");
  },
  inspect() {
    const el = this.el, box = $("#wkInsp", el), S = App.S;
    const c = (S.courses.courses || []).find((x) => String(x.id) === this.sel.id);
    if (!c) { box.classList.add("hidden"); return; }
    const times = M.periodTimes(S.courses.meta), t0 = (times[c.start - 1] || "").split("-")[0], t1 = (times[(c.end || c.start) - 1] || "").split("-")[1];
    const same = (S.courses.courses || []).filter((x) => x.name === c.name).sort((a, b) => a.day - b.day || a.start - b.start);
    const rel = M.sortItems(App.items().filter((x) => !x.hidden && (x.title + x.summary).includes(c.name))).filter((x) => !x.done).slice(0, 8);
    const weeks = Array.isArray(c.wl) && c.wl.length ? c.weeks || compactWeeks(c.wl) : c.weeks || "每周";
    box.classList.remove("hidden");
    box.innerHTML = `<div class="insp-h" style="--c:${M.colorFor(c.name)}"><b>${esc(c.name)}</b><button class="btn ghost iconbtn sm" data-close title="关闭">${icon("close")}</button></div>
      <div class="insp-rows">
        <div>${icon("clock")}<span>周${"一二三四五六日"[c.day]} 第 ${c.start}${c.end > c.start ? "–" + c.end : ""} 节 · ${t0}–${t1}</span></div>
        ${c.location ? `<div>${icon("place")}<span>${esc(c.location)}</span></div>` : ""}
        ${c.teacher ? `<div>👤<span>${esc(c.teacher)}</span></div>` : ""}
        <div>🗓<span>${esc(weeks)}${/周$/.test(weeks) ? "" : " 周"}</span></div>
      </div>
      ${same.length > 1 ? `<div class="insp-s">这门课每周</div>${same.map((x) => `<div class="insp-li">周${"一二三四五六日"[x.day]} 第 ${x.start}${x.end > x.start ? "–" + x.end : ""} 节${x.location ? " · " + esc(x.location) : ""}</div>`).join("")}` : ""}
      <div class="insp-s">相关的作业和事项</div>
      ${rel.length ? rel.map((x) => `<div class="insp-li it" data-k="${esc(x.key)}">${tagHtml(x.type)} ${esc(x.title)} <small class="${overdue(x, App.now()) ? "late" : ""}">${esc(whenText(x, App.now()))}</small></div>`).join("") : `<div class="muted" style="font-size:12px;padding:4px 0">没有标题里写着「${esc(c.name)}」的事项</div>`}
      <div class="insp-act"><button class="btn sm" id="wkFocus">🍅 专注学这门课</button><button class="btn sm" id="wkCEdit">${icon("edit")}修改</button><button class="btn sm danger" id="wkCDel">${icon("trash")}删除</button></div>`;
    $("#wkCEdit", box).onclick = () => CourseEd.editOne(c);
    $("#wkCDel", box).onclick = () => CourseEd.del(c);
    $("#wkFocus", box).onclick = () => App.go("focus", { task: c.name });
    $$(".insp-li.it", box).forEach((n) => (n.onclick = () => App.go("tasks", { key: n.dataset.k })));
  },
  keys(e, typing) {
    if (typing) return;
    if (e.key === "ArrowLeft") { this.shift(-1); return true; }
    if (e.key === "ArrowRight") { this.shift(1); return true; }
    if (e.key === "t" || e.key === "T") { this.off = 0; this.update(); return true; }
  },
};
function compactWeeks(wl) {
  const s = wl.slice().sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`); i = j; }
  return out.join(",");
}
