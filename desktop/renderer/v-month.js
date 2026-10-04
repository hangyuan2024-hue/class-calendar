// 月历：一整月的事项铺开；自己记的事可以直接拖到别的日子；双击某天新建；右边看当天详情
"use strict";
App.views.month = {
  title: "月历", icon: "month", ym: null, day: null, showDone: true,
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1 id="moTitle"></h1><div class="sub">拖动「我的」事项可以改日期 · 双击某天新建</div></div><span class="grow"></span>
        <div class="mo-legend">${M.TYPES.map((t) => `<span><i style="background:${tc(t)}"></i>${t}</span>`).join("")}</div>
        <label class="row" style="gap:6px;font-size:13px;color:var(--text2)"><button class="switch on" id="moDone"></button>显示已完成</label>
        <div class="row"><button class="btn iconbtn" id="moPrev" title="上个月（←）">${icon("left")}</button><button class="btn" id="moNow" title="回到今天（T）">今天</button><button class="btn iconbtn" id="moNext" title="下个月（→）">${icon("right")}</button></div></div>
      <div class="mo-body"><div class="mo-cal"><div class="mo-wd">${"一二三四五六日".split("").map((d) => `<span>周${d}</span>`).join("")}</div><div class="mo-grid" id="moGrid"></div></div><aside class="mo-side" id="moSide"></aside></div>`;
    $("#moPrev", el).onclick = () => this.shift(-1);
    $("#moNext", el).onclick = () => this.shift(1);
    $("#moNow", el).onclick = () => { this.ym = null; this.day = M.dayKey(App.now()); this.update(); };
    $("#moDone", el).onclick = (e) => { this.showDone = !this.showDone; e.currentTarget.classList.toggle("on", this.showDone); this.update(); };
    const g = $("#moGrid", el);
    g.addEventListener("click", (e) => { const c = e.target.closest(".mo-d"); if (c) { this.day = c.dataset.day; $$(".mo-d", g).forEach((x) => x.classList.toggle("sel", x === c)); this.side(); } });
    g.addEventListener("dblclick", (e) => { const ch = e.target.closest(".mo-ch[data-k]"); if (ch) { const x = App.find(ch.dataset.k); if (x && x.mine) editItem(x); else App.go("tasks", { key: ch.dataset.k }); return; } const c = e.target.closest(".mo-d"); if (c) editItem(null, { day: c.dataset.day }); });
    g.addEventListener("contextmenu", (e) => { const ch = e.target.closest(".mo-ch[data-k]"); if (ch) { const x = App.find(ch.dataset.k); if (x) itemMenu(e, x); return; } const c = e.target.closest(".mo-d"); if (c) { e.preventDefault(); menu(e.clientX, e.clientY, [{ label: "在这天记一件事", icon: "plus", fn: () => editItem(null, { day: c.dataset.day }) }]); } });
    // ---------- 拖动改日期 ----------
    g.addEventListener("dragstart", (e) => {
      const ch = e.target.closest(".mo-ch[data-k]"); if (!ch) return;
      const x = App.find(ch.dataset.k);
      if (!x || !x.mine) { e.preventDefault(); toast("班级发的事项不能改日期，只能拖你自己记的事"); return; }
      e.dataTransfer.setData("text/x-cc", x.key); e.dataTransfer.effectAllowed = "move"; ch.classList.add("dragging"); this.dragFrom = x.day;
      g.classList.add("dragmode");
    });
    g.addEventListener("dragend", (e) => { $$(".dragging,.drop", g).forEach((n) => n.classList.remove("dragging", "drop")); g.classList.remove("dragmode"); });
    g.addEventListener("dragover", (e) => { const c = e.target.closest(".mo-d"); if (!c || !e.dataTransfer.types.includes("text/x-cc")) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; $$(".drop", g).forEach((n) => n !== c && n.classList.remove("drop")); c.classList.add("drop"); });
    g.addEventListener("dragleave", (e) => { const c = e.target.closest(".mo-d"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("drop"); });
    g.addEventListener("drop", async (e) => {
      const c = e.target.closest(".mo-d"); const k = e.dataTransfer.getData("text/x-cc"); if (!c || !k) return;
      e.preventDefault(); e.stopPropagation(); c.classList.remove("drop");
      const from = this.dragFrom, to = c.dataset.day; if (from === to) return;
      const x = App.find(k);
      await call("move", k, to);
      toast(`「${x ? x.title : ""}」改到 ${dateCN(to)}`, { action: { label: "撤销", fn: () => from ? call("move", k, from) : call("mine:upsert", { ...(App.S.mine || []).find((r) => r.id === k), event_time: "" }) } });
    });
    $("#moSide", el).addEventListener("click", (e) => {
      const c = e.target.closest(".chk[data-k]"); if (c) { const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); return; }
      const r = e.target.closest(".ms-it[data-k]"); if (r) App.go("tasks", { key: r.dataset.k });
      if (e.target.closest("#msNew")) editItem(null, { day: this.day });
    });
  },
  shift(n) { const [y, m] = this.base(); const d = new Date(y, m + n, 1); this.ym = [d.getFullYear(), d.getMonth()]; this.update(); },
  base() { if (this.ym) return this.ym; const n = App.now(); return [n.getFullYear(), n.getMonth()]; },
  update() {
    const el = this.el, [y, m] = this.base(), now = App.now(), tk = M.dayKey(now);
    if (!this.day) this.day = tk;
    $("#moTitle", el).textContent = `${y} 年 ${m + 1} 月`;
    const first = new Date(y, m, 1), start = M.addDays(first, -M.weekday0(first));
    const weeks = Math.ceil((M.weekday0(first) + new Date(y, m + 1, 0).getDate()) / 7);
    const items = App.items().filter((x) => !x.hidden && x.day && (this.showDone || !x.done));
    const by = {}; for (const x of M.sortItems(items)) (by[x.day] ||= []).push(x);
    const g = $("#moGrid", el); g.style.gridTemplateRows = `repeat(${weeks}, 1fr)`;
    let html = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = M.addDays(start, i), k = M.dayKey(d), its = by[k] || [], cs = M.coursesOn(App.S.courses, d).length;
      const wk = i % 7 === 0 ? M.weekOf(App.S.courses.meta, d) : null;
      html += `<div class="mo-d${d.getMonth() !== m ? " out" : ""}${k === tk ? " today" : ""}${k === this.day ? " sel" : ""}${i % 7 >= 5 ? " we" : ""}" data-day="${k}">
        <div class="mo-n"><b>${d.getDate() === 1 ? d.getMonth() + 1 + "月" : ""}${d.getDate()}</b>${wk ? `<small class="wkno">第${wk}周</small>` : ""}${cs ? `<small class="cs">${cs} 节课</small>` : ""}</div>
        <div class="mo-chs">${its.slice(0, 4).map((x) => `<div class="mo-ch${x.done ? " done" : ""}${x.mine ? " mine" : ""}" data-k="${esc(x.key)}" draggable="true" style="--c:${tc(x.type)}" title="${esc(x.type + "：" + x.title + (x.time ? "　" + x.time : "") + (x.mine ? "\n可以拖到别的日子" : ""))}">${x.time ? `<i>${x.time}</i>` : ""}${esc(x.title)}</div>`).join("")}${its.length > 4 ? `<div class="mo-more">还有 ${its.length - 4} 件</div>` : ""}</div></div>`;
    }
    g.innerHTML = html;
    this.side();
  },
  side() {
    const box = $("#moSide", this.el), k = this.day, now = App.now(), d = M.fromKey(k);
    const its = M.sortItems(App.items().filter((x) => !x.hidden && x.day === k));
    const cs = M.coursesOn(App.S.courses, d);
    box.innerHTML = `<div class="ms-h"><b>${d.getMonth() + 1}月${d.getDate()}日</b><span>周${M.WEEK[d.getDay()]} · ${esc(M.relDay(k, now))}</span></div>
      <div class="ms-s">课 <small>${cs.length}</small></div>
      ${cs.length ? cs.map((c) => `<div class="ms-c" style="--c:${c.color}"><span class="mono">${c.tStart}</span><b>${esc(c.name)}</b><small>${esc(c.location || "")}</small></div>`).join("") : `<div class="muted ms-e">没课</div>`}
      <div class="ms-s">事项 <small>${its.length}</small></div>
      ${its.length ? its.map((x) => `<div class="ms-it${x.done ? " done" : ""}" data-k="${esc(x.key)}"><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}"></button><div><b>${esc(x.title)}</b><small>${x.type}${x.time ? " · " + x.time : ""}${x.location ? " · " + esc(x.location) : ""}</small></div></div>`).join("") : `<div class="muted ms-e">没有事项</div>`}
      <button class="btn" id="msNew" style="margin-top:12px;width:100%">${icon("plus")}在这天记一件事</button>`;
  },
  keys(e, typing) {
    if (typing) return;
    if (e.key === "ArrowLeft" || e.key === "PageUp") { this.shift(-1); return true; }
    if (e.key === "ArrowRight" || e.key === "PageDown") { this.shift(1); return true; }
    if (e.key === "t" || e.key === "T") { this.ym = null; this.day = M.dayKey(App.now()); this.update(); return true; }
  },
};
