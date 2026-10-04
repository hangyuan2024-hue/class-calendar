// 捞捞助手（电脑版）：吉祥物「捞捞」举着一块小屏幕待在窗口右下角，到点冒泡泡提醒；点它弹出对话框。
// 和网站、小程序同一套「智能排序」和问答（core/island-core.js）；
// 电脑上有内置 AI：规则答不上来的问题，直接交给 AI（带着你的课表和作业），回答一个字一个字地出来。
"use strict";
const ISL_SHOW = [["urgent", "⚡", "最急的一件事"], ["course", "📚", "下一节课"], ["progress", "⭕", "今日进度"], ["pomo", "🍅", "专注倒计时（专注时）"]];
const ISL_LV = { late: "late", urgent: "urgent", soon: "soon", now: "now", past: "", normal: "" };
const DIsland = {
  state: "bar", msgs: [], rot: 0, set: false, aiId: null,
  opts() { return { on: true, show: ["pomo", "urgent", "course"], greet: true, screen: true, remind: true, side: "", y: 0, ...(KV("island_v1") || {}) }; },
  save(p) { return kvSet("island_v1", "_", { ...this.opts(), ...p }); },
  ctx() {
    const S = App.S, now = new Date(), t = M.dayKey(now), meta = (S.courses || {}).meta || {};
    const items = App.items().filter((x) => !x.hidden).map((x) => ({ key: x.key, title: x.title, type: x.type, summary: x.summary, day: x.day, time: x.time, location: x.location, done: x.done, needConfirm: x.confirm, mine: x.mine }));
    const on = (k) => M.coursesOn(S.courses, M.fromKey(k)).map((c) => ({ ...c, t0: c.tStart, t1: c.tEnd }));
    const hl = KV("habit_log_v1") || {}, pl = S.pomo || {};
    return { now, name: (S.me || {}).display_name || "", items, courses: on(t).map((c) => ({ ...c, day: t })), coursesOn: on,
      weekOf: (k) => { const w = M.weekOf(meta, M.fromKey(k)); return w >= 1 && w <= 30 ? w : 0; }, hasCourses: !!((S.courses || {}).courses || []).length,
      stats: { habits: (App.fun().habits === false ? [] : KV("habits_v1")).map((h) => ({ name: h.name, done: !!(hl[h.id] || {})[t], streak: typeof habitStreak === "function" ? habitStreak(h.id) : 0 })),
        pomoToday: +pl[t] || 0, pomoWeek: [0, 1, 2, 3, 4, 5, 6].reduce((a, i) => a + (+pl[shiftDay(t, -i)] || 0), 0) } };
  },
  pills(c, ranked) {
    const o = this.opts(), out = [], t = M.dayKey(c.now), hm = `${M.pad(c.now.getHours())}:${M.pad(c.now.getMinutes())}`;
    for (const k of o.show) {
      const p = App.pomo || {};
      if (k === "pomo" && p.running) out.unshift({ ic: p.phase === "focus" ? "🍅" : "☕", text: p.phase === "focus" ? (p.task || "专注中") : "休息一下", sub: `${M.pad(Math.floor(p.left / 60))}:${M.pad(p.left % 60)}`, lv: "now" });
      if (k === "urgent") { const x = ranked.find((y) => y.kind === "item"); out.push(x ? { ic: x.exam ? "📝" : x.type === "作业" ? "✏️" : "📌", text: x.title, sub: x.reason, lv: ISL_LV[x.level] } : { ic: "✨", text: "没有要赶的事", sub: "轻松一下" }); }
      if (k === "course" && c.hasCourses) {
        const cc = c.coursesOn(t).find((x) => !x.t1 || x.t1 > hm), tm = cc ? null : c.coursesOn(shiftDay(t, 1))[0];
        if (cc) out.push({ ic: "📚", text: cc.name, sub: (cc.t0 && cc.t0 <= hm ? "上课中 · " + cc.t1 + " 下课" : cc.t0 + " 上课") + (cc.location ? " · " + cc.location : ""), lv: cc.t0 && cc.t0 <= hm ? "now" : "" });
        else if (tm) out.push({ ic: "📚", text: "明天 " + tm.name, sub: (tm.t0 || "") + (tm.location ? " · " + tm.location : "") });
      }
      if (k === "progress") { const td = c.items.filter((x) => x.day === t), hs = c.stats.habits; out.push({ ic: "⭕", text: `今天完成 ${td.filter((x) => x.done).length}/${td.length}`, sub: hs.length ? `打卡 ${hs.filter((h) => h.done).length}/${hs.length}` : `专注 ${c.stats.pomoToday} 个` }); }
    }
    return out;
  },
  row(x) {
    return `<div class="isr lv-${ISL_LV[x.level] || ""}">${x.kind === "item" ? `<button class="isr-chk" data-isdone="${esc(x.key)}" title="标记完成"></button>` : `<span class="isr-ic">📚</span>`}
      <button class="isr-m" data-isgo="${x.kind === "course" ? "week" : x.type === "作业" ? "homework" : "tasks"}" data-key="${esc(x.key)}"><b>${x.exam ? "📝 " : ""}${esc(x.title)}</b><small>${esc(x.type)} · ${esc(x.when)}${x.location ? " · " + esc(x.location) : ""}</small></button>
      <span class="isr-r">${esc(x.reason)}</span></div>`;
  },
  msgHtml(m) {
    if (m.me) return `<div class="ism me">${esc(m.text)}</div>`;
    return `<div class="ism${m.ai ? " ai" : ""}">${m.typing ? `<span class="is-dots"><i></i><i></i><i></i></span>` : m.ai ? miniMd(m.text) : esc(m.text)}
      ${m.list ? `<div class="ism-list">${m.list.map((x) => this.row(x)).join("")}${m.more ? `<small class="muted">还有 ${m.more} 件…</small>` : ""}</div>` : ""}
      ${m.lines ? `<ul>${m.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${m.chips ? `<div class="is-chips">${m.chips.map((c) => `<button data-isq="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${m.action && m.action !== "farm" ? `<button class="btn sm" data-isact="${esc(m.action)}">${{ growth: "🔥 去打卡", pomo: "🍅 开始专注", rank: "🏆 看排行榜", courses: "📷 导入课程表" }[m.action] || "打开"}</button>` : ""}
      ${m.ai ? `<small class="ism-tag">🤖 内置 AI 回答的</small>` : ""}</div>`;
  },
  render(keepScroll) {
    const el = $("#island"); if (!el || !App.S || !App.S.loggedIn) { if (el) el.classList.add("hidden"); return; }
    const o = this.opts(); el.classList.toggle("hidden", o.on === false); if (o.on === false) return;
    el.dataset.state = this.state;
    el.dataset.side = o.side === "l" ? "l" : "r"; el.style.setProperty("--lao-y", (+o.y || 0) + "px"); el.classList.toggle("noscr", !o.screen);
    const c = this.ctx(), ranked = IslandCore.rank(c.items, c.courses, c.now), pills = this.pills(c, ranked);
    const p = pills.length ? pills[this.rot % pills.length] : { ic: "✨", text: "点我聊聊", sub: "捞捞在这儿" };
    const urgent = ranked.filter((x) => x.level === "late" || x.level === "urgent").length, late = ranked.some((x) => x.level === "late");
    const scr = $("#laoScr"), key = p.text + "|" + p.sub;
    if (scr.dataset.key !== key) { scr.dataset.key = key; scr.className = "lao-scr lv-" + (p.lv || ""); scr.innerHTML = `<span class="lao-line"><i>${p.ic}</i><b>${esc(p.text)}</b></span><small>${esc(p.sub || "")}</small>`; }
    $("#laoN").textContent = urgent || ""; $("#laoN").classList.toggle("hidden", !urgent);
    $("#laoBot").classList.toggle("alert", late);
    if (this.state !== "open") return;
    if (!this.msgs.length || (this.msgs.length === 1 && this.msgs[0].greet)) this.msgs = [{ greet: true, text: IslandCore.greet(c), chips: IslandCore.CHIPS.slice(0, 4) }];
    const chatting = this.msgs.some((m) => m.me), n = chatting ? 3 : 5;
    $("#isTodo").innerHTML = ranked.length ? ranked.slice(0, n).map((x) => this.row(x)).join("") + (ranked.length > n ? `<button class="is-more" data-isq="最急的是什么">看全部 ${ranked.length} 件 ›</button>` : "") : `<div class="is-empty">没有要赶的事 ☕</div>`;
    $("#isTodoN").textContent = ranked.length ? `${ranked.length} 件 · 按轻重缓急排好了` : "";
    const ai = (App.S.ai || {}).ready;
    $("#isSub").innerHTML = `<i></i>${ai ? "内置 AI 已就绪 · 什么都能问" : "学习小助手 · 随便问"}`;
    const body = $("#island .is-body"), atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    $("#isChat").innerHTML = this.msgs.slice(-14).map((m) => this.msgHtml(m)).join("");
    if (chatting && (atEnd || !keepScroll)) body.scrollTop = body.scrollHeight;
    $("#isSet").classList.toggle("hidden", !this.set);
    if (this.set) $("#isSetBody").innerHTML = `<div class="muted">捞捞的小屏幕上显示（勾了好几个就轮流显示）</div>
      ${ISL_SHOW.map(([k, ic, nm]) => `<label class="is-opt"><input type="checkbox" data-isshow="${k}"${o.show.includes(k) ? " checked" : ""}> ${ic} ${nm}</label>`).join("")}
      <label class="is-opt"><input type="checkbox" data-isopt="screen"${o.screen ? " checked" : ""}> 📟 显示小屏幕（关掉只留捞捞）</label>
      <label class="is-opt"><input type="checkbox" data-isopt="remind"${o.remind ? " checked" : ""}> 💬 冒泡泡提醒（快上课、快截止、作业过期、晚上看明天）</label>
      <label class="is-opt"><input type="checkbox" data-isopt="greet"${o.greet ? " checked" : ""}> 👋 打开软件时捞捞先打个招呼</label>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="laoReset">放回右下角</button><button class="btn sm" id="isOff">让捞捞休息（隐藏）</button></div>
      <div class="muted">按住捞捞可以拖到左边或右边、上下挪；隐藏后在「设置」里再叫它出来。</div>`;
  },
  open(quiet) { this.state = "open"; this.set = false; this.hush(); this.render(); if (!quiet) setTimeout(() => $("#isQ").focus(), 50); },
  close() { this.state = "bar"; this.render(); },
  async ask(q) {
    q = String(q || "").trim(); if (!q || this.aiId) return;
    this.msgs.push({ me: true, text: q });
    const c = this.ctx(), a = IslandCore.answer(q, c), m = { typing: true }; this.msgs.push(m); this.render();
    if (a || !(App.S.ai || {}).ready) { setTimeout(() => { Object.assign(m, a || IslandCore.fallback(), { typing: false }); this.render(); }, 320); return; }
    // 规则答不上来，电脑上又有 AI：交给 AI（主进程会把课表、作业一起告诉它）
    const id = "isl" + Date.now(); this.aiId = id; m.id = id;
    try { const full = await call("ai:chat", id, [{ role: "user", content: q }]); Object.assign(m, { typing: false, ai: true, text: full || m.text || "（没有回答）" }); }
    catch (e) { Object.assign(m, IslandCore.fallback(), { typing: false }); }
    this.aiId = null; this.render();
  },
  token(t) { const m = this.msgs.find((x) => x.id === t.id); if (!m) return false; Object.assign(m, { typing: false, ai: true, text: t.text }); this.render(true); return true; },
  // ---------- 对话泡泡 ----------
  say(text, q, ms) {
    const b = $("#laoBub"); if (!b || this.opts().on === false || this.state === "open") return;
    b.innerHTML = `<span>${esc(text)}</span><button class="lao-x" data-laox title="关掉">×</button>`; b.dataset.q = q || "";
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show"); $("#laoBot").classList.add("talk");
    clearTimeout(this.bubT); this.bubT = setTimeout(() => this.hush(), ms || 7000);
  },
  hush() { const b = $("#laoBub"); if (b) b.classList.remove("show"); const bot = $("#laoBot"); if (bot) bot.classList.remove("talk"); },
  once(key) {
    const t = M.dayKey(new Date()), said = JSON.parse(localStorage.getItem("lao_said_v1") || "{}");
    if (said[key]) return false;
    for (const k in said) if (said[k] < shiftDay(t, -3)) delete said[k];
    said[key] = t; localStorage.setItem("lao_said_v1", JSON.stringify(said)); return true;
  },
  // 每分钟看一眼：快上课、快截止、作业过期、晚上看看明天（系统通知之外，再在窗口里说一声）
  watch() {
    const o = this.opts(); if (o.on === false || !o.remind || !App.S || !App.S.loggedIn || this.state === "open" || document.hidden) return;
    const c = this.ctx(), now = c.now, t = M.dayKey(now), ranked = IslandCore.rank(c.items, c.courses, now);
    for (const x of ranked) {
      if (x.kind === "course" && x.mins > 0 && x.mins <= 15 && this.once("c|" + t + "|" + x.title + x.time)) return this.say(`📚 还有 ${Math.round(x.mins)} 分钟上「${x.title}」${x.location ? "，在 " + x.location : ""}`, "下节课在哪");
      if (x.kind === "item" && x.mins != null && x.mins > 0 && x.mins <= 60 && this.once("d|" + x.key + "|" + x.day)) return this.say(`⏰「${x.title}」还剩 ${Math.max(1, Math.round(x.mins))} 分钟${x.type === "作业" ? "就截止了" : ""}！`, "最急的是什么");
    }
    const late = ranked.filter((x) => x.level === "late");
    if (late.length && now.getHours() >= 8 && this.once("late|" + t)) return this.say(`😣 有 ${late.length} 项作业过期了，最早的是「${late[0].title}」，先补上吧`, "有没有过期的作业");
    if (now.getHours() >= 20 && now.getHours() < 23 && this.once("eve|" + t)) {
      const tm = shiftDay(t, 1), n = c.items.filter((x) => x.day === tm && !x.done).length, cs = c.coursesOn(tm);
      if (n || cs.length) return this.say(`🌙 明天${cs.length ? " " + cs.length + " 节课" + (cs[0].t0 ? "，第一节 " + cs[0].t0 : "") : ""}${n ? (cs.length ? "，" : " ") + n + " 件事" : ""}，点我看看`, "明天有什么安排");
    }
  },
  hello() {
    const o = this.opts(); if (this.greeted || o.on === false || !App.S || !App.S.loggedIn) return;
    this.greeted = true;
    if (o.greet) this.say(IslandCore.greet(this.ctx()), "最急的是什么", 8000);
    setTimeout(() => this.watch(), 9000);
  },
};

document.addEventListener("click", (e) => {
  const el = $("#island"); if (!el) return;
  const t = e.target;
  if (!t.closest("#island")) { if (DIsland.state === "open" && !t.closest("#overlay")) DIsland.close(); return; }
  if (el.dataset.dragged) return;
  if (t.closest("[data-laox]")) return DIsland.hush();
  if (t.closest("#laoBub")) { const q = $("#laoBub").dataset.q; DIsland.open(true); if (q) DIsland.ask(q); return; }
  if (t.closest("#laoBot, #laoScr")) return DIsland.state === "open" ? DIsland.close() : DIsland.open();
  if (t.closest("#isClose")) return DIsland.close();
  if (t.closest("#isGear")) { DIsland.set = !DIsland.set; DIsland.render(true); if (DIsland.set) $("#island .is-body").scrollTop = 0; return; }
  if (t.closest("#isOff")) { DIsland.close(); DIsland.save({ on: false }); toast("捞捞去休息了，可以在「设置」里再叫它出来"); return; }
  if (t.closest("#laoReset")) { DIsland.save({ side: "", y: 0 }); return; }
  const q = t.closest("[data-isq]"); if (q) return DIsland.ask(q.dataset.isq);
  const d = t.closest("[data-isdone]"); if (d) { toggleDone(d.dataset.isdone, true); return; }
  const g = t.closest("[data-isgo]"); if (g) { DIsland.close(); App.go(g.dataset.isgo); return; }
  const a = t.closest("[data-isact]");
  if (a) { DIsland.close(); const k = a.dataset.isact; if (k === "pomo") App.go("focus", { start: true }); else if (k === "courses") CourseEd.importShot(); else App.go(k); }
});
document.addEventListener("change", (e) => {
  const s = e.target.closest && e.target.closest("[data-isshow]");
  if (s) { const set = new Set(DIsland.opts().show); s.checked ? set.add(s.dataset.isshow) : set.delete(s.dataset.isshow); DIsland.rot = 0; DIsland.save({ show: ISL_SHOW.map(([k]) => k).filter((k) => set.has(k)) }); }
  const op = e.target.closest && e.target.closest("[data-isopt]");
  if (op) DIsland.save({ [op.dataset.isopt]: op.checked });
});
$("#isForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#isQ").value; $("#isQ").value = ""; DIsland.ask(v); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && DIsland.state === "open") DIsland.close();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") { e.preventDefault(); DIsland.state === "open" ? DIsland.close() : DIsland.open(); }   // Ctrl+J 打开 / 收起
});
// 按住捞捞拖动：左右贴边，上下挪
(() => {
  const el = $("#island"); let st = null;
  el.addEventListener("pointerdown", (e) => { if (!e.target.closest("#laoBot, #laoScr") || DIsland.state === "open") return; st = { x: e.clientX, y: e.clientY, y0: +DIsland.opts().y || 0, moved: false, id: e.pointerId }; });
  window.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    if (!st.moved) { st.moved = true; el.classList.add("drag"); DIsland.hush(); }
    el.style.setProperty("--lao-y", Math.max(-(innerHeight - 280), Math.min(0, st.y0 + dy)) + "px"); el.style.setProperty("--lao-dx", dx + "px");
  });
  window.addEventListener("pointerup", (e) => {
    if (!st || e.pointerId !== st.id) return; const s = st; st = null; if (!s.moved) return;
    el.classList.remove("drag"); el.style.setProperty("--lao-dx", "0px");
    el.dataset.dragged = "1"; setTimeout(() => { delete el.dataset.dragged; }, 50);
    DIsland.save({ side: e.clientX < innerWidth / 2 ? "l" : "r", y: Math.round(Math.max(-(innerHeight - 280), Math.min(0, s.y0 + e.clientY - s.y))) });
  });
})();
setInterval(() => {
  if (!App.S || !App.S.loggedIn || DIsland.state === "open" || document.hidden) return;
  if ((App.pomo || {}).running && DIsland.opts().show.includes("pomo")) { DIsland.render(); return; }
  if (++DIsland._tick % 6 === 0) { DIsland.rot++; DIsland.render(); }
}, 1000);
setInterval(() => DIsland.watch(), 60000);
DIsland._tick = 0;
