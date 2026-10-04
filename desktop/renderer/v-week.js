// 课程表周视图：节次 × 周一到周日，铺满屏幕；红线标出现在的时间；点课看详情和相关作业
"use strict";
App.views.week = {
  title: "课程表", icon: "week", off: 0, sel: null,
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>课程表</h1><div class="sub" id="wkSub"></div></div><span class="grow"></span>
        <div class="row"><button class="btn iconbtn" id="wkPrev" title="上一周（←）">${icon("left")}</button><button class="btn" id="wkNow" title="回到本周（T）">本周</button><button class="btn iconbtn" id="wkNext" title="下一周（→）">${icon("right")}</button></div>
        <button class="btn" data-ext="https://www.laolaokechengbiao.cn/app.html" title="课程表在网站上导入和修改，改完这里自动同步">${icon("edit")}修改课程表</button></div>
      <div class="vbody wk-body"><div class="wk-wrap"><div class="wk-grid" id="wkGrid"></div></div><aside class="wk-insp hidden" id="wkInsp"></aside></div>`;
    $("#wkPrev", el).onclick = () => this.shift(-1);
    $("#wkNext", el).onclick = () => this.shift(1);
    $("#wkNow", el).onclick = () => { this.off = 0; this.update(); };
    el.addEventListener("click", (e) => {
      const c = e.target.closest(".wk-c"); if (c) { this.sel = { id: c.dataset.id, day: c.dataset.day }; this.inspect(); $$(".wk-c", el).forEach((x) => x.classList.toggle("sel", x === c)); return; }
      const it = e.target.closest(".wk-it[data-k]"); if (it) { App.go("tasks", { key: it.dataset.k }); return; }
      const x = e.target.closest("[data-close]"); if (x) { this.sel = null; $("#wkInsp", el).classList.add("hidden"); $$(".wk-c.sel", el).forEach((n) => n.classList.remove("sel")); }
    });
    el.addEventListener("dblclick", (e) => { const cell = e.target.closest(".wk-cell"); if (cell) editItem(null, { day: cell.dataset.day, time: cell.dataset.t }); });
    new ResizeObserver(() => this.nowLine()).observe($("#wkGrid", el));
  },
  shift(n) { this.off += n; this.update(); },
  monday() { const now = App.now(); return M.addDays(now, -M.weekday0(now) + this.off * 7); },
  update() {
    const S = App.S, el = this.el, now = App.now(), mon = this.monday(), meta = S.courses.meta || {}, times = M.periodTimes(meta), all = S.courses.courses || [];
    const wk = M.weekOf(meta, mon), sun = M.addDays(mon, 6);
    $("#wkSub", el).textContent = `${wk ? "第 " + wk + " 周 · " : ""}${mon.getMonth() + 1}月${mon.getDate()}日 – ${sun.getMonth() + 1}月${sun.getDate()}日${this.off ? (this.off > 0 ? `（${this.off} 周后）` : `（${-this.off} 周前）`) : "（本周）"}`;
    $("#wkNow", el).disabled = !this.off;
    const grid = $("#wkGrid", el);
    if (!all.length) { grid.className = "wk-grid"; grid.style.cssText = ""; grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:80px"><b>📚</b>还没有课程表<br><br><button class="btn primary" data-ext="https://www.laolaokechengbiao.cn/app.html">去网站导入课程表</button><br><br><span class="muted">支持从教务系统截图导入，导好后这里自动同步</span></div>`; return; }
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
      <div class="insp-act"><button class="btn sm" id="wkFocus">🍅 专注学这门课</button></div>`;
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
