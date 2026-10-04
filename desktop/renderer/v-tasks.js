// 事项：左边筛选、中间一张表、右边详情。支持多选、批量完成、键盘操作、备注
"use strict";
const FILTERS = [
  ["todo", "待办", "📋", (x, n) => !x.done && !x.hidden],
  ["today", "今天", "☀️", (x, n) => !x.hidden && x.day === M.dayKey(n)],
  ["week", "接下来 7 天", "🗓", (x, n) => !x.hidden && !x.done && x.day && M.dayDiff(x.day, n) >= 0 && M.dayDiff(x.day, n) <= 7],
  ["late", "过期没完成", "⏰", (x, n) => !x.hidden && overdue(x, n)],
  ["noday", "没定日子", "📎", (x, n) => !x.hidden && !x.done && !x.day],
  ["done", "已完成", "✅", (x, n) => x.done && !x.hidden],
  ["hidden", "已隐藏", "🙈", (x, n) => x.hidden],
  ["all", "全部", "🗂", (x, n) => !x.hidden],
];
App.views.tasks = {
  title: "事项", icon: "tasks", filter: "todo", types: new Set(), q: "", sort: "time", sel: new Set(), cur: null, anchor: null, rows: [],
  count() { const n = App.now(); return { n: App.items().filter((x) => !x.hidden && overdue(x, n)).length, hot: true }; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>事项</h1><div class="sub">班级发的作业、通知，加上你自己记的事</div></div><span class="grow"></span>
        <button class="btn hidden" id="tkPub">📣 发布班级事项</button>
        <button class="btn primary" id="tkNew">${icon("plus")}记一件事<kbd style="background:none;border-color:rgba(255,255,255,.4);color:#fff">Ctrl N</kbd></button></div>
      <div class="tk-body">
        <aside class="tk-filters" id="tkFilters"></aside>
        <section class="tk-main">
          <div class="tk-tools"><div class="tk-search">${icon("search")}<input id="tkQ" placeholder="搜索标题、内容、地点、备注（Ctrl F）" spellcheck="false"></div>
            <div class="seg" id="tkSort"><button data-s="time" class="on">按时间</button><button data-s="type">按类型</button><button data-s="new">最新发布</button></div></div>
          <div class="tk-bulk hidden" id="tkBulk"></div>
          <div class="tk-table" id="tkTable" tabindex="0"></div>
          <div class="tk-foot muted" id="tkFoot"></div>
        </section>
        <aside class="tk-detail" id="tkDetail"></aside>
      </div>`;
    $("#tkNew", el).onclick = () => editItem(null);
    $("#tkPub", el).onclick = () => editClassItem(null);
    $("#tkQ", el).oninput = (e) => { this.q = e.target.value.trim(); this.table(); };
    $("#tkQ", el).onkeydown = (e) => { if (e.key === "Escape") { e.target.value = ""; this.q = ""; this.table(); $("#tkTable", el).focus(); e.stopPropagation(); } if (e.key === "ArrowDown") { $("#tkTable", el).focus(); this.move(1, false); e.preventDefault(); } };
    $("#tkSort", el).onclick = (e) => { const b = e.target.closest("button"); if (!b) return; this.sort = b.dataset.s; $$("#tkSort button", el).forEach((x) => x.classList.toggle("on", x === b)); this.table(); };
    $("#tkFilters", el).onclick = (e) => {
      const f = e.target.closest("[data-f]"); if (f) { this.filter = f.dataset.f; this.sel.clear(); this.update(); return; }
      const t = e.target.closest("[data-t]"); if (t) { const k = t.dataset.t; this.types.has(k) ? this.types.delete(k) : this.types.add(k); this.update(); }
    };
    const tb = $("#tkTable", el);
    tb.addEventListener("mousedown", (e) => {
      const r = e.target.closest(".tr[data-k]"); if (!r || e.target.closest(".chk")) return;
      if (e.button === 2 && this.sel.has(r.dataset.k)) return;
      this.pick(r.dataset.k, e.ctrlKey || e.metaKey, e.shiftKey);
    });
    tb.addEventListener("click", (e) => { const c = e.target.closest(".chk[data-k]"); if (c) { const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); } });
    tb.addEventListener("dblclick", (e) => { const r = e.target.closest(".tr[data-k]"); if (!r) return; const x = App.find(r.dataset.k); if (x && x.mine) editItem(x); else this.focusNote(); });
    tb.addEventListener("contextmenu", (e) => {
      const r = e.target.closest(".tr[data-k]"); if (!r) return;
      if (this.sel.size > 1 && this.sel.has(r.dataset.k)) { e.preventDefault(); const ks = [...this.sel]; return menu(e.clientX, e.clientY, this.bulkActions(ks)); }
      const x = App.find(r.dataset.k); if (x) itemMenu(e, x);
    });
    $("#tkBulk", el).onclick = (e) => { const b = e.target.closest("[data-b]"); if (b) this.bulkActions([...this.sel])[+b.dataset.b].fn(); };
    $("#tkDetail", el).addEventListener("click", (e) => this.detailClick(e));
  },
  show(arg) {
    if (arg && arg.key) {
      const x = App.find(arg.key);
      if (x && !this.visible().some((r) => r.key === x.key)) { this.filter = x.hidden ? "hidden" : x.done ? "done" : "all"; this.types.clear(); this.q = ""; $("#tkQ", this.el).value = ""; }
      this.sel = new Set([arg.key]); this.cur = arg.key; this.anchor = arg.key; this.update();
      const r = $(`.tr[data-k="${CSS.escape(arg.key)}"]`, this.el); if (r) r.scrollIntoView({ block: "center" });
      $("#tkTable", this.el).focus();
    }
  },
  visible() {
    const n = App.now(), f = FILTERS.find((x) => x[0] === this.filter)[3], q = this.q.toLowerCase();
    let list = App.items().filter((x) => f(x, n) && (!this.types.size || this.types.has(x.type)) && (!q || (x.title + " " + x.summary + " " + x.location + " " + x.note + " " + x.original).toLowerCase().includes(q)));
    if (this.sort === "type") list = M.sortItems(list).sort((a, b) => M.TYPES.indexOf(a.type) - M.TYPES.indexOf(b.type));
    else if (this.sort === "new") list = list.slice().sort((a, b) => (b.publish || b.key).localeCompare(a.publish || a.key));
    else { list = M.sortItems(list); if (this.filter === "done") list.reverse(); }
    return list;
  },
  update() {
    const el = this.el, n = App.now(), items = App.items();
    $("#tkPub", el).classList.toggle("hidden", !App.canAddItem());
    $("#tkFilters", el).innerHTML = `<div class="tf-h">清单</div>` + FILTERS.map(([id, name, ic, f]) => { const c = items.filter((x) => f(x, n)).length; return `<button class="tf${this.filter === id ? " on" : ""}" data-f="${id}"><span>${ic}</span>${name}<small class="${id === "late" && c ? "hot" : ""}">${c || ""}</small></button>`; }).join("")
      + `<div class="tf-h">类型</div><div class="tf-types">${M.TYPES.map((t) => `<button class="tf-t${this.types.has(t) ? " on" : ""}" data-t="${t}" style="--c:${tc(t)}">${t}</button>`).join("")}</div>`
      + `<div class="tf-tip"><b>键盘操作</b><span><kbd>↑</kbd><kbd>↓</kbd> 选择　<kbd>Shift</kbd> 连选</span><span><kbd>空格</kbd> 完成　<kbd>Enter</kbd> 编辑</span><span><kbd>Del</kbd> 删除/隐藏　<kbd>Ctrl A</kbd> 全选</span></div>`;
    this.table();
  },
  table() {
    const el = this.el, now = App.now(), list = this.visible(), tk = M.dayKey(now);
    this.rows = list.map((x) => x.key);
    for (const k of [...this.sel]) if (!this.rows.includes(k)) this.sel.delete(k);
    if (this.cur && !App.find(this.cur)) this.cur = null;
    const grp = (x) => {
      if (this.sort !== "time" || this.filter === "done" || this.filter === "hidden") return "";
      if (!x.day) return "没定日子"; const d = M.dayDiff(x.day, now);
      if (overdue(x, now) && d < 0) return "已经过去"; if (d < 0) return "已经过去"; if (d === 0) return "今天"; if (d === 1) return "明天"; if (d <= 7) return "这几天"; if (d <= 31) return "这个月"; return "以后";
    };
    let g = null, html = `<div class="th"><span></span><span>类型</span><span>标题</span><span>时间</span><span>地点</span><span>来源</span></div>`;
    for (const x of list) {
      const gg = grp(x);
      if (gg && gg !== g) { g = gg; html += `<div class="tg">${gg}<span>${list.filter((y) => grp(y) === gg).length}</span></div>`; }
      const late = overdue(x, now);
      html += `<div class="tr${this.sel.has(x.key) ? " sel" : ""}${x.key === this.cur ? " cur" : ""}${x.done ? " done" : ""}" data-k="${esc(x.key)}">
        <span><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}" tabindex="-1"></button></span><span>${tagHtml(x.type)}</span>
        <span class="tt"><b>${esc(x.title)}</b>${x.note ? `<i title="${esc(x.note)}">📝</i>` : ""}${x.summary ? `<small>${esc(x.summary)}</small>` : ""}</span>
        <span class="tw${late ? " late" : ""}${x.day === tk ? " tdy" : ""}">${esc(whenText(x, now))}</span><span class="tl2">${esc(x.location)}</span><span class="ts">${x.mine ? "我的" : App.group(x.gid) ? "👥 " + esc(App.group(x.gid).name) : "班级"}${attachList(x.key).length ? " 📎" : ""}</span></div>`;
    }
    if (!list.length) html += `<div class="empty"><b>${this.q ? "🔍" : "🎉"}</b>${this.q ? "没有找到「" + esc(this.q) + "」" : "这里没有事项"}</div>`;
    $("#tkTable", el).innerHTML = html;
    const done = list.filter((x) => x.done).length;
    $("#tkFoot", el).textContent = `${list.length} 件${done ? `，其中 ${done} 件已完成` : ""}${this.sel.size > 1 ? ` · 已选 ${this.sel.size} 件` : ""}`;
    this.bulk(); this.detail();
  },
  pick(k, add, range) {
    if (range && this.anchor && this.rows.includes(this.anchor)) {
      const a = this.rows.indexOf(this.anchor), b = this.rows.indexOf(k);
      if (!add) this.sel.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.sel.add(this.rows[i]);
    } else if (add) { this.sel.has(k) ? this.sel.delete(k) : this.sel.add(k); this.anchor = k; }
    else { this.sel = new Set([k]); this.anchor = k; }
    this.cur = k;
    $$(".tr", this.el).forEach((r) => { r.classList.toggle("sel", this.sel.has(r.dataset.k)); r.classList.toggle("cur", r.dataset.k === k); });
    $("#tkFoot", this.el).textContent = $("#tkFoot", this.el).textContent.replace(/ · 已选 \d+ 件$/, "") + (this.sel.size > 1 ? ` · 已选 ${this.sel.size} 件` : "");
    this.bulk(); this.detail(true);
  },
  move(d, range) {
    if (!this.rows.length) return;
    let i = this.rows.indexOf(this.cur); i = i < 0 ? 0 : Math.max(0, Math.min(this.rows.length - 1, i + d));
    this.pick(this.rows[i], false, range);
    const r = $(`.tr[data-k="${CSS.escape(this.rows[i])}"]`, this.el); if (r) r.scrollIntoView({ block: "nearest" });
  },
  bulkActions(ks) {
    const xs = ks.map((k) => App.find(k)).filter(Boolean), mine = xs.filter((x) => x.mine), cls = xs.filter((x) => !x.mine);
    return [
      { label: `全部标记完成（${xs.length}）`, icon: "tasks", fn: async () => { for (const x of xs) if (!x.done) await call("done", x.key, true); toast(`已完成 ${xs.length} 件`, { action: { label: "撤销", fn: async () => { for (const x of xs) if (!x.done) await call("done", x.key, false); } } }); } },
      { label: "全部标记没完成", icon: "close", fn: async () => { for (const x of xs) if (x.done) await call("done", x.key, false); } },
      cls.length ? { label: this.filter === "hidden" ? `取消隐藏（${cls.length}）` : `隐藏班级事项（${cls.length}）`, icon: "eye", fn: async () => { const hide = this.filter !== "hidden"; for (const x of cls) await call("mark", x.key, { hidden: hide }); toast(hide ? `已隐藏 ${cls.length} 件` : "已取消隐藏"); } } : null,
      mine.length ? { label: `删除我的事项（${mine.length}）`, icon: "trash", danger: true, fn: async () => { if (!(await confirmBox(`删除 ${mine.length} 件你自己记的事？`, "删除后网页版和手机上也会一起删掉。", "删除", true))) return; for (const x of mine) await call("mine:delete", x.key); toast(`已删除 ${mine.length} 件`); } } : null,
    ].filter(Boolean);
  },
  bulk() {
    const b = $("#tkBulk", this.el);
    b.classList.toggle("hidden", this.sel.size < 2);
    if (this.sel.size < 2) return;
    b.innerHTML = `<b>已选 ${this.sel.size} 件</b>` + this.bulkActions([...this.sel]).map((a, i) => `<button class="btn sm${a.danger ? " danger" : ""}" data-b="${i}">${a.label}</button>`).join("") + `<span class="grow"></span><button class="btn ghost sm" id="tkUnsel">取消选择</button>`;
    $("#tkUnsel", b).onclick = () => { this.sel = new Set(this.cur ? [this.cur] : []); this.table(); };
  },
  detail(force) {
    const box = $("#tkDetail", this.el), x = this.cur && App.find(this.cur), now = App.now();
    const ta = $("textarea", box);
    if (!force && ta && document.activeElement === ta && box.dataset.k === this.cur) return;   // 正在写备注：不打断
    box.dataset.k = this.cur || "";
    if (!x) { box.innerHTML = `<div class="empty" style="margin-top:80px"><b>👈</b>点左边的一件事，在这里看详情、写备注</div>`; return; }
    const late = overdue(x, now);
    box.innerHTML = `
      <div class="dt-top">${tagHtml(x.type)}${App.group(x.gid) ? `<span class="tag" style="--c:var(--ok)">👥 ${esc(App.group(x.gid).name)}</span>` : ""}${x.done ? '<span class="tag" style="--c:var(--ok)">已完成</span>' : late ? '<span class="tag" style="--c:var(--bad)">过期了</span>' : ""}${x.confirm ? '<span class="tag" style="--c:var(--warn)">待核实</span>' : ""}<span class="grow"></span>
        ${x.mine ? `<button class="btn ghost iconbtn sm" data-d="edit" title="编辑（Enter）">${icon("edit")}</button>` : App.canEditIn(x.gid) ? `<button class="btn ghost iconbtn sm" data-d="cedit" title="修改这条班级事项">${icon("edit")}</button>` : ""}
        ${!x.mine && App.S.groupsOk && x.updated ? `<button class="btn ghost iconbtn sm" data-d="hist" title="修改记录">${icon("history")}</button>` : ""}
        ${App.canDelItem(x) ? `<button class="btn ghost iconbtn sm danger" data-d="cdel" title="从班级里删除">${icon("trash")}</button>` : ""}</div>
      <h2 class="dt-title selectable">${esc(x.title)}</h2>
      <div class="dt-rows">
        <div>${icon("clock")}<span class="${late ? "late" : ""}">${x.day ? dateCN(x.day) + (x.time ? " " + x.time : "") + `　<small>${esc(M.relDay(x.day, now))}</small>` : "没定日子"}</span></div>
        ${x.location ? `<div>${icon("place")}<span class="selectable">${esc(x.location)}</span></div>` : ""}
        ${x.publish ? `<div>📣<span>${esc(x.publish)} 发布</span></div>` : ""}
      </div>
      ${x.summary ? `<div class="dt-sec"><div class="dt-l">内容</div><div class="selectable dt-txt">${esc(x.summary)}</div></div>` : ""}
      ${x.prepare ? `<div class="dt-sec"><div class="dt-l">要准备</div><div class="selectable dt-txt">${esc(x.prepare)}</div></div>` : ""}
      ${x.original ? `<details class="dt-sec"><summary class="dt-l">原始消息</summary><div class="selectable dt-txt dt-orig">${esc(x.original)}</div></details>` : ""}
      ${!x.mine && x.editor && x.updated ? `<div class="dt-by muted">✏️ ${esc(x.editor)} · ${esc(whenStr(x.updated))}更新</div>` : ""}
      <div class="dt-sec"><div class="dt-l">附件 <small class="muted">只在这台电脑上</small></div>${attachHtml(x.key)}</div>
      <div class="dt-sec"><div class="dt-l">我的备注 <small class="muted" id="dtSaved"></small></div><textarea class="input" rows="4" maxlength="2000" placeholder="写点什么，自动保存，手机和网页上也能看到">${esc(x.note)}</textarea></div>
      <div class="dt-act">
        <button class="btn ${x.done ? "" : "primary"}" data-d="done">${x.done ? "标记为没完成" : "✓ 完成"}<kbd>空格</kbd></button>
        <button class="btn" data-d="focus">🍅 专注</button>
        ${x.mine ? `<button class="btn danger" data-d="del">${icon("trash")}删除</button>` : `<button class="btn" data-d="hide">${x.hidden ? "取消隐藏" : "隐藏"}</button>`}
        ${x.original ? `<button class="btn ghost" data-d="copy">复制原文</button>` : ""}
      </div>`;
    const t = $("textarea", box); let timer = 0;
    const save = async () => {
      clearTimeout(timer); const v = t.value.trim(); const cur = App.find(x.key); if (!cur || v === (cur.note || "")) return;
      if (x.mine) { const raw = (App.S.mine || []).find((r) => r.id === x.key); await call("mine:upsert", { ...raw, note: v }); } else await call("mark", x.key, { note: v });
      const s = $("#dtSaved", box); if (s) s.textContent = "已保存";
    };
    t.oninput = () => { clearTimeout(timer); timer = setTimeout(save, 700); $("#dtSaved", box).textContent = "…"; };
    t.onblur = save;
    t.onkeydown = (e) => { if (e.key === "Escape") { t.blur(); $("#tkTable", this.el).focus(); e.stopPropagation(); } };
  },
  focusNote() { const t = $("#tkDetail textarea", this.el); if (t) { t.focus(); t.selectionStart = t.value.length; } },
  async detailClick(e) {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const x = App.find(this.cur); if (!x) return;
    const a = b.dataset.d;
    if (a === "done") toggleDone(x.key, !x.done);
    if (a === "edit") editItem(x);
    if (a === "cedit") editClassItem(x);
    if (a === "cdel") deleteClassItem(x);
    if (a === "hist") showItemHistory(x);
    if (a === "focus") App.go("focus", { task: x.title });
    if (a === "del") deleteMine(x.key);
    if (a === "hide") hideItem(x.key, !x.hidden);
    if (a === "copy") { navigator.clipboard.writeText(x.original).then(() => toast("已复制")); }
  },
  keys(e, typing) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) { $("#tkQ", this.el).focus(); $("#tkQ", this.el).select(); return true; }
    if (typing) return;
    if (e.key === "ArrowDown" || e.key === "j") { this.move(1, e.shiftKey); return true; }
    if (e.key === "ArrowUp" || e.key === "k") { this.move(-1, e.shiftKey); return true; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) { this.sel = new Set(this.rows); this.table(); return true; }
    const ks = this.sel.size ? [...this.sel] : this.cur ? [this.cur] : [];
    if (!ks.length) return;
    if (e.key === " ") { const xs = ks.map((k) => App.find(k)).filter(Boolean); const to = !xs.every((x) => x.done); (async () => { for (const x of xs) if (x.done !== to) await call("done", x.key, to); if (to) toast(`已完成 ${xs.length > 1 ? xs.length + " 件" : "：" + xs[0].title}`, { action: { label: "撤销", fn: async () => { for (const x of xs) await call("done", x.key, false); } } }); })(); return true; }
    if (e.key === "Enter") { const x = App.find(this.cur); if (x && x.mine) editItem(x); else this.focusNote(); return true; }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (ks.length > 1) { const acts = this.bulkActions(ks); const d = acts.find((a) => a.danger) || acts[2]; if (d) d.fn(); return true; }
      const x = App.find(ks[0]); if (!x) return; x.mine ? deleteMine(x.key) : hideItem(x.key, !x.hidden); return true;
    }
    if (e.key === "Escape" && this.sel.size > 1) { this.sel = new Set([this.cur]); this.table(); return true; }
  },
};
