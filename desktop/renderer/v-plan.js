// 规划 · 时间管理：四象限（可拖动）、PDCA 循环、SMART 目标、六件事法；番茄工作法在「专注」里
// 数据和网页版同一份（quad_v1、plan_notes_v1），在哪边改都会同步
"use strict";
const QUADS = [
  [1, "重要且紧急", "马上做", "两天内截止的作业、会议，先把它们解决"],
  [2, "重要不紧急", "计划做", "复习、长期作业、习惯——最值得投入时间的地方"],
  [3, "紧急不重要", "尽快处理", "填表、报名这类小事，花几分钟打发掉"],
  [4, "不重要不紧急", "少做", "有空再说，别让它占用整块时间"],
];
const PLAN_METHODS = [
  { id: "quad", icon: "🎯", name: "四象限法", tag: "分清轻重缓急", intro: "四象限法（艾森豪威尔矩阵）按「重要」和「紧急」两个维度，把事情分成四类：\n① 重要且紧急——马上做；② 重要不紧急——排进计划，这是最值得投入的地方；③ 紧急不重要——尽快处理或请人帮忙；④ 不重要不紧急——少做或不做。\n用法：先把要做的事都写下来，再一件件放进格子里。每天先清空第①格，然后把大块时间留给第②格。" },
  { id: "pdca", icon: "🔄", name: "PDCA 循环", tag: "计划 → 执行 → 检查 → 改进", intro: "PDCA 循环（戴明环）把一件事分成四步，一轮一轮地做得更好：\nP 计划（Plan）：定目标、想方法；D 执行（Do）：按计划去做；C 检查（Check）：对照目标看效果，找出问题；A 改进（Act）：好的方法保留下来，没解决的问题放进下一轮的计划。\n适合：备考、学一门技能、准备比赛这类需要反复改进的事。" },
  { id: "smart", icon: "🏹", name: "SMART 目标", tag: "把目标定清楚", intro: "SMART 原则帮你把模糊的愿望变成能落地的目标，一个好目标要满足五点：\nS 具体（Specific）：说清楚要做成什么；M 可衡量（Measurable）：用数字判断完成没有；A 可实现（Achievable）：努力一下够得着；R 相关（Relevant）：和你真正想要的东西有关；T 有时限（Time-bound）：有明确的截止日期。\n例子：把「我要学好英语」改成「11 月 30 日前每天背 30 个四级单词，周末自测正确率达到 80%」。" },
  { id: "ivy", icon: "📋", name: "六件事法", tag: "每天只排最重要的 6 件", intro: "六件事法（艾维·李效率法）：\n1. 每天睡前写下明天最重要的 6 件事；2. 按重要程度排好顺序；3. 第二天从第 1 件开始做，做完一件再做下一件；4. 没做完的移到第二天的清单里。\n它的好处是逼自己做取舍、一次只专注一件事，不会被一长串待办吓到。" },
  { id: "pomo", icon: "🍅", name: "番茄工作法", tag: "专注 25 分钟，休息 5 分钟", intro: "番茄工作法：选一件事，定 25 分钟（一个「番茄」）全神贯注地做，中途不看手机；时间到了休息 5 分钟；每完成 4 个番茄，休息 15~30 分钟。\n小技巧：把大任务拆成几个番茄能做完的小块；被打断就记下来，等番茄结束再处理。" },
];
const PD = [["p", "P", "计划", "目标是什么？打算怎么做？"], ["d", "D", "执行", "实际做了什么？记录过程"], ["c", "C", "检查", "效果怎么样？和目标差多少？问题在哪？"], ["a", "A", "改进", "哪些做法保留？哪些问题放进下一轮？"]];
const SM = [["s", "S", "具体", "要做成什么样？越具体越好"], ["m", "M", "可衡量", "用什么数字判断完成了？"], ["a", "A", "可实现", "需要什么条件？每天做多少？"], ["r", "R", "相关", "为什么这件事对你重要？"]];

App.views.plan = {
  title: "规划", icon: "plan", ivyDay: 0, editIntro: false,
  navOn() { return App.fun().plan !== false; },
  notes() { return KV("plan_notes_v1") || {}; },
  cur() { const c = this.notes().cur; return PLAN_METHODS.some((m) => m.id === c) ? c : "quad"; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>规划</h1><div class="sub">五种时间管理方法，选一种用起来；和网页版、手机上同步</div></div><span class="grow"></span>
        <div class="seg" id="plTabs"></div></div>
      <div class="vbody"><div id="plIntro"></div><div id="plBody"></div></div>`;
    $("#plTabs", el).onclick = (e) => { const b = e.target.closest("[data-pm]"); if (!b) return; if (b.dataset.pm === "pomo") { App.go("focus"); return; } this.editIntro = false; kvSet("plan_notes_v1", "cur", b.dataset.pm); };
    el.addEventListener("click", (e) => this.click(e));
    el.addEventListener("change", (e) => this.change(e));
    el.addEventListener("keydown", (e) => this.keydown(e));
    // 四象限：拖动换格子
    el.addEventListener("dragstart", (e) => { const it = e.target.closest("[data-qk]"); if (it) { this.drag = it.dataset.qk; e.dataTransfer.setData("text/x-quad", it.dataset.qk); e.dataTransfer.effectAllowed = "move"; } });
    el.addEventListener("dragover", (e) => { const q = e.target.closest(".quad"); if (q && this.drag) { e.preventDefault(); $$(".quad.drop", el).forEach((x) => x !== q && x.classList.remove("drop")); q.classList.add("drop"); } });
    el.addEventListener("dragleave", (e) => { const q = e.target.closest(".quad"); if (q && !q.contains(e.relatedTarget)) q.classList.remove("drop"); });
    el.addEventListener("drop", (e) => { const q = e.target.closest(".quad"); if (q && this.drag) { e.preventDefault(); kvSet("quad_v1", this.drag, +q.dataset.q); } this.drag = null; $$(".quad.drop", el).forEach((x) => x.classList.remove("drop")); });
  },
  update() {
    const el = this.el, cur = this.cur(), m = PLAN_METHODS.find((x) => x.id === cur), notes = this.notes();
    if (el.contains(document.activeElement) && document.activeElement.matches("textarea, input:not([type=checkbox])") && !document.activeElement.dataset.qadd) return;   // 正在写：不打断
    $("#plTabs", el).innerHTML = PLAN_METHODS.map((x) => `<button data-pm="${x.id}" class="${x.id === cur ? "on" : ""}">${x.icon} ${x.name}</button>`).join("");
    const own = typeof notes["intro:" + cur] === "string" && notes["intro:" + cur].trim() ? notes["intro:" + cur] : null;
    $("#plIntro", el).innerHTML = this.editIntro
      ? `<div class="card pl-intro"><div class="card-h">${m.icon} ${m.name} · 编辑简介</div><div style="padding:0 16px 14px"><textarea class="input" id="plIntroTxt" rows="7" maxlength="3000">${esc(own || m.intro)}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn sm" data-pi="reset">恢复默认简介</button><span class="grow"></span><button class="btn sm" data-pi="cancel">取消</button><button class="btn primary sm" data-pi="save">保存</button></div></div></div>`
      : `<details class="card pl-intro"${notes["introOpen:" + cur] === false ? "" : " open"}><summary><b>${m.icon} ${m.name}</b><span class="muted">${m.tag}</span><em>这是什么？怎么用</em></summary>
          <div class="pl-intro-b">${esc(own || m.intro).replace(/\n/g, "<br>")}</div><div class="row pl-intro-f"><span class="muted">${own ? "这是你自己写的简介" : ""}</span><span class="grow"></span><button class="btn ghost sm" data-pi="edit">✏️ ${own ? "修改简介" : "换成我的简介"}</button></div></details>`;
    const d = $("details.pl-intro", el);
    if (d) d.addEventListener("toggle", () => { if (d.open !== (notes["introOpen:" + cur] !== false)) kvSet("plan_notes_v1", "introOpen:" + cur, d.open ? null : false); });
    $("#plBody", el).innerHTML = cur === "quad" ? this.quadHtml() : cur === "pdca" ? this.pdcaHtml() : cur === "smart" ? this.smartHtml() : this.ivyHtml();
  },
  // ---------- 四象限 ----------
  auto(x) { const n = x.day ? M.dayDiff(x.day, App.now()) : 99, urgent = n <= 2, important = x.mine || x.type === "作业" || x.type === "会议"; return important ? (urgent ? 1 : 2) : (urgent ? 3 : 4); },
  items() {
    const qm = KV("quad_v1") || {}, hide = App.fun().hideDone, log = App.S.doneLog || {}, t = todayKey();
    return App.items().filter((x) => !x.hidden && (!x.day || (M.dayDiff(x.day, App.now()) >= -14 && M.dayDiff(x.day, App.now()) <= 14)))
      .filter((x) => !x.done || (!hide && log[x.key] === t)).map((x) => ({ ...x, q: qm[x.key] || this.auto(x) }));
  },
  quadHtml() {
    const items = this.items(), hide = App.fun().hideDone, now = App.now();
    return `<div class="pl-tip muted">已经按截止时间和类型帮你自动分好了，觉得不对就拖到别的格子（右键也能换）。在格子里加的待办会出现在「我的事项」里。
        <label class="row" style="gap:6px;display:inline-flex;margin-left:12px"><input type="checkbox" data-hidedone${hide ? " checked" : ""}> 隐藏已完成</label></div>
      <div class="quads">${QUADS.map(([n, name, act, desc]) => {
        const list = items.filter((x) => x.q === n).sort((a, b) => (a.done - b.done) || (a.day || "9").localeCompare(b.day || "9"));
        const left = list.filter((x) => !x.done).length;
        return `<div class="quad q${n} card" data-q="${n}"><div class="q-h"><b>${name}</b><em>${act}</em><small>${left ? left + " 项" : ""}</small></div><div class="q-d muted">${desc}</div>
          <div class="q-items">${list.map((x) => { const due = x.day ? (M.dayDiff(x.day, now) < 0 ? "已过期" : M.relDay(x.day, now)) : "";
            return `<div class="q-it${x.done ? " done" : ""}" draggable="true" data-qk="${esc(x.key)}" style="--c:${tc(x.type)}"><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}"></button><span>${esc(x.title)}</span>${due ? `<small>${esc(due)}</small>` : ""}</div>`; }).join("") || `<div class="q-empty">${n === 1 ? "没有火烧眉毛的事 👍" : "空的"}</div>`}</div>
          <input class="q-add" data-qadd="${n}" maxlength="60" placeholder="＋ 加一条，回车保存"></div>`;
      }).join("")}</div>`;
  },
  // ---------- PDCA ----------
  listOf(pre) { const n = this.notes(); return Object.keys(n).filter((k) => k.startsWith(pre) && n[k]).map((k) => ({ key: k, ...n[k] })).sort((a, b) => (b.at || 0) - (a.at || 0)); },
  pdcaHtml() {
    const list = this.listOf("pdca:");
    return `<div class="card pl-add"><input class="input" id="pdcaNew" maxlength="60" placeholder="新开一个 PDCA，比如：期中数学提高 15 分"><button class="btn primary" data-pd-add>开始</button></div>
      ${list.length ? list.map((x) => `<div class="card pdca" data-pk="${esc(x.key)}">
        <div class="pd-h"><b>${esc(x.title)}</b>${x.round > 1 ? `<span class="tag">第 ${x.round} 轮</span>` : ""}<span class="grow"></span><button class="btn ghost sm danger" data-pd-del>删除</button></div>
        <div class="pd-steps">${PD.map(([f, L, name, ph], i) => `<label class="pds${(x.stage || 0) === i ? " cur" : ""}${(x.stage || 0) > i ? " ok" : ""}"><span><i>${L}</i>${name}</span><textarea class="input" data-pd-f="${f}" rows="4" maxlength="800" placeholder="${ph}">${esc(x[f] || "")}</textarea></label>`).join("")}</div>
        <div class="pd-f"><span class="muted">现在在：<b>${PD[x.stage || 0][2]}</b></span><span class="grow"></span>
          ${(x.stage || 0) < 3 ? `<button class="btn primary sm" data-pd-next>进入「${PD[(x.stage || 0) + 1][2]}」→</button>` : `<button class="btn primary sm" data-pd-round>完成这一轮，开始下一轮 🔄</button>`}</div></div>`).join("")
        : `<div class="card empty"><b>🔄</b>还没有 PDCA。写一个想改进的目标，点「开始」。</div>`}`;
  },
  // ---------- SMART ----------
  smartHtml() {
    const list = this.listOf("smart:"), mine = App.S.mine || [];
    return `<div class="card pl-add"><input class="input" id="smartNew" maxlength="60" placeholder="写下一个想实现的目标，比如：学好英语"><button class="btn primary" data-sm-add>添加</button></div>
      ${list.length ? list.map((x) => {
        const n = SM.filter(([f]) => (x[f] || "").trim()).length + (x.t ? 1 : 0), inCal = mine.some((y) => y.id === "g" + x.key.slice(6));
        return `<div class="card smart${x.done ? " done" : ""}" data-sk="${esc(x.key)}">
          <div class="pd-h"><button class="chk${x.done ? " on" : ""}" data-sm-done title="${x.done ? "标记为没达成" : "目标达成"}"></button><b>${esc(x.title)}</b><span class="smeter" title="目标清晰度"><i style="width:${n * 20}%"></i></span><small class="muted">${n}/5</small><span class="grow"></span><button class="btn ghost sm danger" data-sm-del>删除</button></div>
          <div class="sm-g">${SM.map(([f, L, name, ph]) => `<label class="sms"><span><i>${L}</i>${name}</span><input class="input" data-sm-f="${f}" maxlength="200" placeholder="${ph}" value="${esc(x[f] || "")}"></label>`).join("")}
            <label class="sms"><span><i>T</i>有时限</span><span class="row"><input class="input" type="date" data-sm-f="t" value="${esc(x.t || "")}">${x.t ? `<button class="btn sm" data-sm-cal>${inCal ? "已在日历 ✓" : "📅 放进日历"}</button>` : ""}</span></label></div>
          <div class="muted sm-tip">${n < 5 ? "还差：" + [...SM.filter(([f]) => !(x[f] || "").trim()).map(([, , nm]) => nm), ...(x.t ? [] : ["截止日期"])].join("、") : `<span style="color:var(--ok)">✓ 这是一个清楚的 SMART 目标，加油！</span>`}</div></div>`;
      }).join("") : `<div class="card empty"><b>🏹</b>还没有目标。先随便写一个，再按 S、M、A、R、T 五点把它改清楚。</div>`}`;
  },
  // ---------- 六件事 ----------
  ivyList(day) { const l = ((this.notes()["ivy:" + day]) || []).slice(0, 6).map((x) => ({ text: "", done: false, ...x })); while (l.length < 6) l.push({ text: "", done: false }); return l; },
  ivyHtml() {
    const day = shiftDay(todayKey(), this.ivyDay), list = this.ivyList(day);
    const done = list.filter((x) => x.text && x.done).length, all = list.filter((x) => x.text).length, first = list.findIndex((x) => x.text && !x.done);
    return `<div class="card ivy">
      <div class="pd-h"><div class="seg"><button data-ivy-day="0" class="${this.ivyDay === 0 ? "on" : ""}">今天</button><button data-ivy-day="1" class="${this.ivyDay === 1 ? "on" : ""}">明天</button></div>
        <span class="muted">${all ? `完成 ${done}/${all}` : this.ivyDay ? "睡前写下明天最重要的 6 件事" : "写下今天最重要的 6 件事，按重要程度排序"}</span><span class="grow"></span>
        ${this.ivyDay === 0 && all > done ? `<button class="btn sm" data-ivy-move>没做完的移到明天</button>` : ""}</div>
      ${list.map((x, i) => `<div class="ivr${x.done ? " done" : ""}${i === first && this.ivyDay === 0 ? " now" : ""}"><span class="ivn">${i + 1}</span>
        <input class="input" data-ivy="${i}" maxlength="60" value="${esc(x.text)}" placeholder="${i === 0 ? "最重要的一件" : "第 " + (i + 1) + " 件"}">
        ${x.text ? `<button class="chk${x.done ? " on" : ""}" data-ivy-done="${i}"></button>` : `<span style="width:18px"></span>`}
        <button class="btn ghost sm" data-ivy-up="${i}" ${i ? "" : "disabled"}>↑</button><button class="btn ghost sm" data-ivy-dn="${i}" ${i < 5 ? "" : "disabled"}>↓</button>
        ${x.text && this.ivyDay === 0 && !x.done ? `<button class="btn ghost sm" data-ivy-focus="${i}" title="专注做这件事">🍅</button>` : ""}</div>`).join("")}
      ${first >= 0 && this.ivyDay === 0 ? `<div class="ivy-now">👉 现在只做第 ${first + 1} 件：<b>${esc(list[first].text)}</b></div>` : ""}</div>`;
  },
  ivySet(fn) {
    const day = shiftDay(todayKey(), this.ivyDay), list = this.ivyList(day); fn(list);
    return kvSet("plan_notes_v1", "ivy:" + day, list.some((x) => x.text) ? list : null);
  },
  put(key, v) { return kvSet("plan_notes_v1", key, v || null); },
  get(key) { const v = this.notes()[key]; return v ? { ...v } : null; },
  async click(e) {
    const c = e.target.closest(".chk[data-k]"); if (c) { const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); return; }
    const b = e.target.closest("button"); if (!b) return;
    const pk = b.closest("[data-pk]"), sk = b.closest("[data-sk]"), cur = this.cur();
    if (b.dataset.pi) {
      const m = PLAN_METHODS.find((x) => x.id === cur);
      if (b.dataset.pi === "edit") { this.editIntro = true; this.update(); }
      if (b.dataset.pi === "cancel") { this.editIntro = false; this.update(); }
      if (b.dataset.pi === "reset") { this.editIntro = false; kvSet("plan_notes_v1", "intro:" + cur, null); }
      if (b.dataset.pi === "save") { const t = $("#plIntroTxt", this.el).value.trim(); this.editIntro = false; kvSet("plan_notes_v1", "intro:" + cur, t && t !== m.intro ? t : null); }
      return;
    }
    if (b.hasAttribute("data-pd-add")) { const v = $("#pdcaNew", this.el).value.trim(); if (!v) return $("#pdcaNew", this.el).focus(); this.put("pdca:" + uid(), { title: v, stage: 0, round: 1, at: Date.now() }); return; }
    if (b.hasAttribute("data-pd-del") && pk) { if (await confirmBox("删除这个 PDCA？", "", "删除", true)) this.put(pk.dataset.pk, null); return; }
    if (b.hasAttribute("data-pd-next") && pk) { const x = this.get(pk.dataset.pk); x.stage = Math.min(3, (x.stage || 0) + 1); this.put(pk.dataset.pk, x); cheer("item"); return; }
    if (b.hasAttribute("data-pd-round") && pk) { const x = this.get(pk.dataset.pk); this.put(pk.dataset.pk, { title: x.title, stage: 0, round: (x.round || 1) + 1, at: Date.now(), p: x.a ? "上一轮的改进：" + x.a : "" }); cheer("item"); return; }
    if (b.hasAttribute("data-sm-add")) { const v = $("#smartNew", this.el).value.trim(); if (!v) return $("#smartNew", this.el).focus(); this.put("smart:" + uid(), { title: v, at: Date.now() }); return; }
    if (b.hasAttribute("data-sm-del") && sk) { if (await confirmBox("删除这个目标？", "", "删除", true)) this.put(sk.dataset.sk, null); return; }
    if (b.hasAttribute("data-sm-done") && sk) { const x = this.get(sk.dataset.sk); x.done = !x.done; this.put(sk.dataset.sk, x); if (x.done) cheer("item"); return; }
    if (b.hasAttribute("data-sm-cal") && sk) {
      const x = this.get(sk.dataset.sk), id = "g" + sk.dataset.sk.slice(6), old = (App.S.mine || []).find((y) => y.id === id);
      await call("mine:upsert", { ...(old || {}), id, subject: "🎯 " + x.title, event_time: x.t, location: "", note: [x.s, x.m && "衡量：" + x.m].filter(Boolean).join("\n"), done: old ? old.done : false });
      toast("已放进日历：" + x.t); return;
    }
    if (b.dataset.ivyDay != null) { this.ivyDay = +b.dataset.ivyDay; this.update(); return; }
    if (b.dataset.ivyDone != null) { const i = +b.dataset.ivyDone; let on = false; this.ivySet((l) => { l[i].done = on = !l[i].done; }); if (on) cheer("item"); return; }
    if (b.dataset.ivyFocus != null) { const l = this.ivyList(todayKey()); App.go("focus", { task: l[+b.dataset.ivyFocus].text }); return; }
    if (b.dataset.ivyUp != null || b.dataset.ivyDn != null) { const i = +(b.dataset.ivyUp ?? b.dataset.ivyDn), j = b.dataset.ivyUp != null ? i - 1 : i + 1; if (j < 0 || j > 5) return; this.ivySet((l) => { [l[i], l[j]] = [l[j], l[i]]; }); return; }
    if (b.hasAttribute("data-ivy-move")) {
      const t = todayKey(), tm = shiftDay(t, 1), today = this.ivyList(t), left = today.filter((x) => x.text && !x.done), nx = this.ivyList(tm).filter((x) => x.text);
      const merged = [...left.map((x) => ({ text: x.text, done: false })), ...nx].slice(0, 6), keep = today.filter((x) => x.text && x.done);
      await call("kv:batch", [["plan_notes_v1", "ivy:" + tm, merged.length ? merged : null], ["plan_notes_v1", "ivy:" + t, keep.length ? keep : null]]);
      this.ivyDay = 1; this.update(); toast(`已把 ${left.length} 件移到明天`); return;
    }
  },
  change(e) {
    const t = e.target;
    if (t.matches("[data-hidedone]")) { kvSet("fun_opts_v1", "_", { ...(KV("fun_opts_v1") || {}), hideDone: t.checked }); return; }
    const pk = t.closest("[data-pk]"), sk = t.closest("[data-sk]");
    if (pk && t.dataset.pdF) { const x = this.get(pk.dataset.pk); if (x) { x[t.dataset.pdF] = t.value.trim(); this.put(pk.dataset.pk, x); } return; }
    if (sk && t.dataset.smF) { const x = this.get(sk.dataset.sk); if (x) { x[t.dataset.smF] = t.value.trim(); this.put(sk.dataset.sk, x); } return; }
    if (t.dataset.ivy != null) { const i = +t.dataset.ivy; this.ivySet((l) => { l[i] = { ...l[i], text: t.value.trim() }; if (!l[i].text) l[i].done = false; }); }
  },
  async keydown(e) {
    const t = e.target; if (e.key !== "Enter" || e.isComposing) return;
    if (t.dataset.qadd) {
      const text = t.value.trim(); if (!text) return;
      const q = +t.dataset.qadd, rec = await call("mine:upsert", { subject: text, event_time: "", location: "", note: "" });
      await kvSet("quad_v1", rec.id, q); t.value = "";
      setTimeout(() => { const n = $(`[data-qadd="${q}"]`, this.el); if (n) n.focus(); }, 120); return;
    }
    if (t.id === "pdcaNew") { e.preventDefault(); $("[data-pd-add]", this.el).click(); return; }
    if (t.id === "smartNew") { e.preventDefault(); $("[data-sm-add]", this.el).click(); return; }
    if (t.dataset.ivy != null) { e.preventDefault(); t.blur(); const nx = $(`[data-ivy="${+t.dataset.ivy + 1}"]`, this.el); if (nx) nx.focus(); }
  },
};
// 四象限：右键换格子
document.addEventListener("contextmenu", (e) => {
  const it = e.target.closest("[data-qk]"); if (!it) return;
  e.preventDefault(); e.stopPropagation();
  const x = App.find(it.dataset.qk); if (!x) return;
  menu(e.clientX, e.clientY, QUADS.map(([n, t]) => ({ label: "移到「" + t + "」", fn: () => kvSet("quad_v1", x.key, n) })).concat(["-", x.mine ? { label: "编辑", icon: "edit", fn: () => editItem(x) } : null, { label: "专注做这件事", icon: "focus", fn: () => App.go("focus", { task: x.title }) }]));
}, true);
