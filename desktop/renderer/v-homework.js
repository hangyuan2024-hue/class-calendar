// 作业：一周的作业按截止时间排好，过期没交的单独列出；可以翻到上一周、下一周；还能导出成 PDF 贴在桌上
"use strict";
App.views.homework = {
  title: "作业", icon: "homework", off: 0,
  count() { const now = App.now(), sun = M.dayKey(M.addDays(now, 6 - M.weekday0(now))); const n = App.items().filter((x) => x.type === "作业" && !x.done && !x.hidden && x.day && x.day <= sun && M.dayDiff(x.day, now) >= -30).length; return { n, hot: App.items().some((x) => x.type === "作业" && overdue(x, now) && !x.hidden) }; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1 id="hwTitle">本周作业</h1><div class="sub" id="hwSub"></div></div><span class="grow"></span>
        <button class="btn hidden" id="hwPub">📣 发布作业</button>
        <button class="btn" id="hwPdf" title="导出成 PDF，可以打印出来">${icon("print")}导出 / 打印</button>
        <div class="row"><button class="btn iconbtn" id="hwPrev" title="上一周（←）">${icon("left")}</button><button class="btn" id="hwNow">本周</button><button class="btn iconbtn" id="hwNext" title="下一周（→）">${icon("right")}</button></div></div>
      <div class="vbody"><div class="hw-wrap" id="hwBody"></div></div>`;
    $("#hwPrev", el).onclick = () => { this.off--; this.update(); };
    $("#hwNext", el).onclick = () => { this.off++; this.update(); };
    $("#hwNow", el).onclick = () => { this.off = 0; this.update(); };
    $("#hwPub", el).onclick = () => editClassItem(null);
    $("#hwPdf", el).onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(r.left, r.bottom + 4, [
        { label: "导出 PDF", icon: "export", fn: () => this.exportPdf() },
        { label: "直接打印", icon: "print", fn: () => call("print", this.printHtml()).then((ok) => ok === true && toast("已发送到打印机")) },
      ]);
    };
    el.addEventListener("click", (e) => {
      const c = e.target.closest(".chk[data-k]"); if (c) { const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); return; }
      const r = e.target.closest(".hw-row[data-k]"); if (r && !e.target.closest("button")) App.go("tasks", { key: r.dataset.k });
    });
    el.addEventListener("contextmenu", (e) => { const r = e.target.closest(".hw-row[data-k]"); if (r) { const x = App.find(r.dataset.k); if (x) itemMenu(e, x); } });
  },
  range() { const now = App.now(), mon = M.addDays(now, -M.weekday0(now) + this.off * 7); return [mon, M.addDays(mon, 6)]; },
  lists() {
    const now = App.now(), [mon, sun] = this.range(), a = M.dayKey(mon), b = M.dayKey(sun);
    const all = App.items().filter((x) => x.type === "作业" && !x.hidden);
    const by = (x, y) => (x.day + (x.time || "99")).localeCompare(y.day + (y.time || "99"));
    const week = all.filter((x) => x.day && x.day >= a && x.day <= b).sort(by);
    return { week, todo: week.filter((x) => !x.done), done: week.filter((x) => x.done),
      late: this.off === 0 ? all.filter((x) => x.day && !x.done && x.day < a && M.dayDiff(x.day, now) >= -30).sort(by) : [],
      undated: this.off === 0 ? all.filter((x) => !x.day && !x.done) : [] };
  },
  due(x) {
    const now = App.now();
    if (!x.day) return ["", "时间待定"];
    if (x.done) return ["ok", "已完成"];
    const n = M.dayDiff(x.day, now);
    if (n < 0 || overdue(x, now)) return ["late", n < 0 ? `过期 ${-n} 天` : "已过截止时间"];
    if (n === 0) return ["today", x.time ? `今天 ${x.time} 截止` : "今天截止"];
    if (n === 1) return ["soon", "明天截止"];
    return [n <= 3 ? "soon" : "", `还剩 ${n} 天`];
  },
  update() {
    const el = this.el, now = App.now(), [mon, sun] = this.range(), L = this.lists();
    $("#hwTitle", el).textContent = this.off === 0 ? "本周作业" : this.off === 1 ? "下周作业" : this.off === -1 ? "上周作业" : `${mon.getMonth() + 1}月${mon.getDate()}日这周的作业`;
    $("#hwSub", el).textContent = `${mon.getMonth() + 1}月${mon.getDate()}日 – ${sun.getMonth() + 1}月${sun.getDate()}日 · 由班委整理发布，有出入以群里为准`;
    $("#hwNow", el).disabled = !this.off;
    $("#hwPub", el).classList.toggle("hidden", !App.canAddItem());
    const row = (x) => {
      const [cls, txt] = this.due(x), d = x.day ? M.fromKey(x.day) : null, att = attachList(x.key).length, g = App.group(x.gid);
      return `<div class="hw-row${x.done ? " done" : ""}" data-k="${esc(x.key)}">
        <button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}" title="${x.done ? "标记为没交" : "交了"}"></button>
        <div class="hw-m"><b>${x.confirm ? "⚠ " : ""}${esc(x.title)}${g ? ` <span class="tag" style="--c:var(--ok)">👥 ${esc(g.name)}</span>` : ""}${att ? ` <span class="muted" title="${att} 个附件">📎${att}</span>` : ""}</b>${x.summary ? `<small>${esc(x.summary)}</small>` : ""}${x.note ? `<small class="hw-note">📝 ${esc(x.note)}</small>` : ""}</div>
        <div class="hw-d"><span class="due ${cls}">${esc(txt)}</span>${d ? `<small>周${M.WEEK[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}${x.time ? " " + x.time : ""}</small>` : ""}</div></div>`;
    };
    const sec = (t, sub, list, cls) => list.length ? `<section class="hw-sec ${cls || ""}"><div class="hw-h"><b>${t}</b><span>${sub}</span></div><div class="card">${list.map(row).join("")}</div></section>` : "";
    const pct = L.week.length ? Math.round(L.done.length / L.week.length * 100) : 0;
    $("#hwBody", el).innerHTML = `
      <div class="card hw-prog">${ringSvg(L.done.length, L.week.length, 84, "var(--ok)")}
        <div><b class="hw-big">${L.todo.length + L.late.length}<small> 项没交</small></b><div class="muted">${this.off === 0 ? "本周" : "这周"}已完成 ${L.done.length} / ${L.week.length}${L.late.length ? `，另外有 ${L.late.length} 项过期没交` : ""}${L.week.length && pct === 100 ? "，全部搞定 🎉" : ""}</div></div>
        <span class="grow"></span>
        <div class="hw-days">${Array.from({ length: 7 }, (_, i) => { const d = M.addDays(mon, i), k = M.dayKey(d), n = L.week.filter((x) => x.day === k && !x.done).length; return `<div class="${k === M.dayKey(now) ? "today" : ""}"><span>周${"一二三四五六日"[i]}</span><b class="${n ? "has" : ""}">${n || "·"}</b></div>`; }).join("")}</div></div>
      ${sec("之前没交的", "过期了，但还没标记完成", L.late, "late")}
      ${L.todo.length ? sec("待完成", "按截止时间排序", L.todo) : `<div class="card empty"><b>🎉</b>${L.week.length ? "这周的作业都做完了" : "这周没有作业"}</div>`}
      ${sec("截止时间待定", "去群里核实一下", L.undated)}
      ${sec("已完成", L.done.length + " 项", L.done, "donesec")}`;
  },
  printHtml() {
    const [mon, sun] = this.range(), L = this.lists(), now = App.now();
    const rows = L.late.concat(L.todo, L.undated, L.done).map((x) => { const [, txt] = this.due(x); return `<tr class="${x.done ? "d" : ""}"><td>${x.done ? "☑" : "☐"}</td><td><b>${esc(x.title)}</b>${x.summary ? `<br><small>${esc(x.summary)}</small>` : ""}</td><td>${x.day ? esc(x.day.slice(5).replace("-", "/") + (x.time ? " " + x.time : "")) : "待定"}</td><td>${esc(txt)}</td><td>${esc(x.location || "")}</td></tr>`; }).join("");
    return printDoc(`${App.className() || ""} 作业清单`, `${mon.getMonth() + 1}月${mon.getDate()}日 – ${sun.getMonth() + 1}月${sun.getDate()}日 · 导出于 ${whenStr(now)}`,
      `<table><thead><tr><th style="width:28px"></th><th>作业</th><th style="width:90px">截止</th><th style="width:100px">状态</th><th style="width:110px">地点</th></tr></thead><tbody>${rows || `<tr><td colspan="5">这周没有作业</td></tr>`}</tbody></table>`);
  },
  exportPdf() { const [mon] = this.range(); return call("export:pdf", this.printHtml(), `作业清单-${M.dayKey(mon)}`).then((f) => f && toast("已导出 PDF")); },
  keys(e, typing) {
    if (typing) return;
    if (e.key === "ArrowLeft") { this.off--; this.update(); return true; }
    if (e.key === "ArrowRight") { this.off++; this.update(); return true; }
    if (e.key === "t" || e.key === "T") { this.off = 0; this.update(); return true; }
  },
};

// 打印 / PDF 用的页面（在看不见的窗口里排版，不带脚本）
function printDoc(title, sub, body, extraCss) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:13px/1.55 "Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;color:#1b2740;margin:0;padding:8px 6px}
    h1{font-size:22px;margin:0 0 2px}.sub{color:#8b96aa;margin-bottom:14px}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e3e8f1;padding:7px 6px;text-align:left;vertical-align:top}
    th{font-size:12px;color:#55627a;background:#f3f6fb}small{color:#55627a}tr.d td{color:#8b96aa;text-decoration:line-through}
    .foot{margin-top:16px;color:#8b96aa;font-size:11px}${extraCss || ""}</style></head>
    <body><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}<div class="foot">捞捞课程表 电脑版</div></body></html>`;
}
