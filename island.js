// ===== 捞捞助手：网站吉祥物「捞捞」举着一块小屏幕，待在屏幕角落 =====
// · 小屏幕上滚动显示你选的内容：最急的一件事、下一节课、今日进度、番茄钟倒计时、云宠（可以设成轮流显示，也可以把屏幕收起来只留捞捞）；
// · 到点了它会冒一个对话泡泡提醒你：快上课了、作业快截止、有作业过期了、晚上看看明天……同一件事只提醒一次；
// · 点捞捞：弹出对话框，最上面是「智能排序」好的待办（按时间轻重排），还能直接问它问题——不联网也能答；电脑上装了本地 AI 时，听不懂的交给 AI；
// · 不挡东西：往下滑页面时它会缩到屏幕边上，停下来再探出头；还能按住拖到左边或右边、上下挪位置。
// 排序和问答的规则在 island-core.js 里，和小程序、电脑版是同一份。
"use strict";
const LS_ISLAND = "island_v1", LS_LAO_SAID = "lao_said_v1";
const ISLAND_SHOW = [["urgent", "⚡", "最急的一件事"], ["course", "📚", "下一节课"], ["progress", "⭕", "今日进度"], ["pomo", "🍅", "番茄钟倒计时（专注时）"], ["farm", "🐣", "云宠和养料"]];
const islandOpts = () => ({ on: true, show: ["pomo", "urgent", "course"], greet: true, screen: true, remind: true, side: "", y: 0, ...load(LS_ISLAND, {}) });
const islandSave = (patch) => { save(LS_ISLAND, { ...islandOpts(), ...patch }); renderIsland(true); };
let islandState = "bar", islandRot = 0, islandRotT = 0, islandMsgs = [], islandBusy = false, islandSet = false, islandGreeted = false, laoBubT = 0, laoTuckT = 0;

// 把网站的数据整理成 island-core 要的样子
function islandItems() {
  return allItems().filter((r) => !r._plugin && !r._hidden).map((r) => ({ key: r._key, title: r.subject || r.summary || r.msg_type, type: r.msg_type, summary: r.summary || "",
    day: r._p ? r._p.day : "", time: r._p ? r._p.time : "", location: r.location || "", done: !!r._done, needConfirm: !!r.need_confirm, mine: !!r._mine }));
}
function islandCourses(k) { try { return ck().data && ck().data.courses.length ? ck().coursesOn(k) : []; } catch (e) { return []; } }
function islandCtx() {
  const now = new Date(typeof ccNow === "function" ? ccNow() : Date.now()), t = keyOf(now), d = ck().data;
  const weekOf = (k) => { if (!d || !d.week1) return 0; const w = Math.floor((new Date(k + "T00:00:00") - new Date(d.week1 + "T00:00:00")) / 86400000 / 7) + 1; return w >= 1 && w <= 30 ? w : 0; };
  const stats = { habits: funOpts().habits ? habits.map((h) => ({ name: h.name, done: !!(habitLog[h.id] || {})[t], streak: streakOf(h) })) : [],
    pomoToday: +pomoLog[t] || 0, pomoWeek: [...Array(7)].reduce((a, _, i) => a + (+pomoLog[shiftDay(t, -i)] || 0), 0) };
  try { if (farmOn()) { const n = farmNumbers(), s = farmState(); Object.assign(stats, { food: n.left, petName: s.name, petLevel: s.level }); } } catch (e) {}
  if (rankCache && currentClass && rankCache.cid === currentClass.id && rankCache.period === "week") { const me = rankCache.data.rows.find((r) => r.me); if (me) Object.assign(stats, { growth: me.points, rank: me.rank }); }
  return { now, name: currentUser ? currentUser.display_name : "", items: islandItems(), courses: islandCourses(t).map((c) => ({ ...c, day: t })),
    coursesOn: islandCourses, weekOf, hasCourses: !!(d && d.courses && d.courses.length), stats };
}

// ---------- 小屏幕上显示什么 ----------
function islandPills(ctx, ranked) {
  const o = islandOpts(), out = [];
  for (const k of o.show) {
    if (k === "pomo" && typeof pomo !== "undefined" && (pomo.mode === "focus" || pomo.mode === "break") && pomo.end) {
      out.unshift({ k, ic: pomo.mode === "focus" ? "🍅" : "☕", text: pomo.mode === "focus" ? "专注中" : "休息一下", sub: fmtMs(pomo.end - Date.now()), level: "now" });
    }
    if (k === "urgent") { const x = ranked.find((y) => y.kind === "item"); out.push(x ? { k, ic: x.exam ? "📝" : x.type === "作业" ? "✏️" : "📌", text: x.title, sub: x.reason, level: x.level } : { k, ic: "✨", text: "没有要赶的事", sub: "轻松一下" }); }
    if (k === "course" && ctx.hasCourses) {
      const t = keyOf(ctx.now), hmNow = `${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}`;
      const c = islandCourses(t).find((x) => !x.t1 || x.t1 > hmNow), tm = c ? null : islandCourses(shiftDay(t, 1))[0];
      if (c) out.push({ k, ic: "📚", text: c.name, sub: (c.t0 && c.t0 <= hmNow ? "上课中 · " + c.t1 + " 下课" : c.t0 + " 上课") + (c.location ? " · " + c.location : ""), level: c.t0 && c.t0 <= hmNow ? "now" : "" });
      else if (tm) out.push({ k, ic: "📚", text: "明天 " + tm.name, sub: (tm.t0 || "") + (tm.location ? " · " + tm.location : "") });
    }
    if (k === "progress") { const t = keyOf(ctx.now), today = ctx.items.filter((x) => x.day === t), hs = ctx.stats.habits; out.push({ k, ic: "⭕", text: `今天完成 ${today.filter((x) => x.done).length}/${today.length}`, sub: hs.length ? `打卡 ${hs.filter((h) => h.done).length}/${hs.length}` : `番茄 ${ctx.stats.pomoToday}` }); }
    if (k === "farm" && ctx.stats.petName) out.push({ k, ic: "🐣", text: `${ctx.stats.petName} Lv.${ctx.stats.petLevel}`, sub: `养料 ${ctx.stats.food}${ctx.stats.food >= 10 ? " · 可以喂了" : ""}` });
  }
  return out;
}

// ---------- 画出来 ----------
function islandRow(x) {
  const go = x.kind === "course" ? "course" : x.type === "作业" ? "homework" : "calendar";
  return `<div class="isr lv-${x.level}">
    ${x.kind === "item" ? `<button class="chk" data-act="done" data-k="${esc(x.key)}" title="标记完成" aria-label="完成「${esc(x.title)}」"></button>` : `<span class="isr-ic">📚</span>`}
    <button class="isr-m" data-isgo="${go}" data-day="${esc(x.day)}"><b>${x.exam ? "📝 " : ""}${esc(x.title)}</b><small>${esc(x.type)} · ${esc(x.when)}${x.location ? " · " + esc(x.location) : ""}</small></button>
    <span class="isr-r">${esc(x.reason)}</span></div>`;
}
function islandMsgHtml(m) {
  if (m.me) return `<div class="ism me">${esc(m.text)}</div>`;
  return `<div class="ism">${m.typing ? `<span class="is-dots"><i></i><i></i><i></i></span>` : m.html ? m.html : esc(m.text)}
    ${m.list ? `<div class="ism-list">${m.list.map(islandRow).join("")}${m.more ? `<small class="meta">还有 ${m.more} 件…</small>` : ""}</div>` : ""}
    ${m.lines ? `<ul>${m.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    ${m.chips ? `<div class="is-chips">${m.chips.map((c) => `<button data-isq="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
    ${m.action ? `<button class="small" data-isact="${esc(m.action)}">${{ farm: "🐣 去喂云宠", growth: "🔥 去打卡", pomo: "🍅 开始专注", rank: "🏆 看排行榜", courses: "📷 导入课程表" }[m.action] || "打开"}</button>` : ""}</div>`;
}
const laoSide = () => { const s = islandOpts().side; return s === "l" || s === "r" ? s : matchMedia("(max-width: 700px)").matches ? "l" : "r"; };

function renderIsland(force) {
  const el = $("lao"); if (!el) return;
  const o = islandOpts(), on = o.on !== false;
  el.classList.toggle("hidden", !on);
  $("optIsland") && ($("optIsland").checked = on);
  if (!on) return;
  el.dataset.side = laoSide(); el.style.setProperty("--lao-y", (+o.y || 0) + "px");
  el.classList.toggle("noscr", !o.screen);
  el.classList.toggle("open", islandState === "open");
  const ctx = islandCtx(), ranked = IslandCore.rank(ctx.items, ctx.courses, ctx.now);
  const pills = islandPills(ctx, ranked);
  const urgent = ranked.filter((x) => x.level === "late" || x.level === "urgent").length, late = ranked.some((x) => x.level === "late");
  // 小屏幕（黑板）平时收起来，只有正在上课、快上课、快截止、过期、番茄钟进行中才亮出来
  const loud = pills.filter((x) => x.k === "pomo" || x.level === "now" || x.level === "urgent" || x.level === "late");
  el.classList.toggle("quiet", !loud.length);
  const p = loud.length ? loud[islandRot % loud.length] : pills.length ? pills[islandRot % pills.length] : { ic: "✨", text: "点我聊聊", sub: "捞捞在这儿" };
  const scr = $("laoScr");
  const key = p.text + "|" + p.sub;
  if (scr.dataset.key !== key) {
    scr.dataset.key = key;
    scr.className = "lao-scr lv-" + (p.level || "");
    scr.innerHTML = `<span class="lao-line"><i>${p.ic}</i><b>${esc(p.text)}</b></span><small>${esc(p.sub || "")}</small>`;
  }
  scr.setAttribute("aria-label", `捞捞的屏幕：${p.text} ${p.sub || ""}`);
  $("laoN").textContent = urgent || ""; $("laoN").classList.toggle("hidden", !urgent);
  $("laoBot").classList.toggle("alert", late);
  if (islandState !== "open") return;
  // 对话框
  if (!islandMsgs.length || (islandMsgs.length === 1 && islandMsgs[0].greet)) islandMsgs = [{ greet: true, text: IslandCore.greet(ctx), chips: IslandCore.CHIPS.slice(0, 4) }];
  const chatting = islandMsgs.some((m) => m.me), nTop = chatting ? 3 : 5;
  $("isTodo").innerHTML = ranked.length ? ranked.slice(0, nTop).map(islandRow).join("") + (ranked.length > nTop ? `<button class="is-more" data-isq="最急的是什么">看全部 ${ranked.length} 件 ›</button>` : "")
    : `<div class="is-empty">没有要赶的事 ☕</div>`;
  $("isTodoN").textContent = ranked.length ? `${ranked.length} 件 · 按轻重缓急排好了` : "";
  $("isSub").textContent = typeof laiReady === "function" && laiReady() ? "本地 AI 已连上 · 什么都能问" : "你的学习小助手 · 随便问";
  const box = $("isBody"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  $("isChat").innerHTML = islandMsgs.slice(-12).map(islandMsgHtml).join("");
  if (chatting && (atEnd || force !== true)) box.scrollTop = box.scrollHeight;
  $("isSet").classList.toggle("hidden", !islandSet);
  if (islandSet) $("isSetBody").innerHTML = `<div class="meta">捞捞的小屏幕上显示（勾了好几个就轮流显示）</div>
    ${ISLAND_SHOW.map(([k, ic, n]) => `<label class="is-opt"><input type="checkbox" data-isshow="${k}"${o.show.includes(k) ? " checked" : ""}> ${ic} ${n}</label>`).join("")}
    <label class="is-opt"><input type="checkbox" data-isopt="screen"${o.screen ? " checked" : ""}> 📟 显示小屏幕（关掉只留捞捞）</label>
    <label class="is-opt"><input type="checkbox" data-isopt="remind"${o.remind ? " checked" : ""}> 💬 到点冒泡泡提醒（上课、截止、过期）</label>
    <label class="is-opt"><input type="checkbox" data-isopt="greet"${o.greet ? " checked" : ""}> 👋 打开网站时捞捞先打个招呼</label>
    <div class="is-set-f"><button class="small" id="laoReset">放回原来的位置</button><button class="small" id="isOff">让捞捞休息（隐藏）</button></div>
    <div class="meta">按住捞捞可以拖到左边或右边、上下挪；隐藏后在「我的 → 趣味功能」里再叫它出来。</div>`;
}

// ---------- 对话泡泡 ----------
function laoSay(text, opts = {}) {
  const b = $("laoBub"); if (!b || islandOpts().on === false || islandState === "open") return;
  laoTuck(false);
  b.innerHTML = `<span>${esc(text)}</span><button class="lao-x" data-laox aria-label="关掉">×</button>`;
  b.dataset.q = opts.q || "";
  b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
  $("laoBot").classList.add("talk"); $("lao").classList.add("talking");
  clearTimeout(laoBubT); laoBubT = setTimeout(laoHush, opts.ms || 7000);
}
function laoHush() { const b = $("laoBub"); if (b) b.classList.remove("show"); $("laoBot") && $("laoBot").classList.remove("talk"); $("lao") && $("lao").classList.remove("talking"); }
// 同一件事只提醒一次
function laoOnce(key) {
  const said = load(LS_LAO_SAID, {}), t = todayKey();
  if (said[key]) return false;
  for (const k in said) if (said[k] < shiftDay(t, -3)) delete said[k];
  said[key] = t; try { localStorage.setItem(LS_LAO_SAID, JSON.stringify(said)); } catch (e) {}
  return true;
}
// 每分钟看一眼：有没有该提醒的
function laoWatch() {
  const o = islandOpts(); if (o.on === false || !o.remind || !currentUser || islandState === "open" || document.hidden) return;
  const ctx = islandCtx(), now = ctx.now, t = keyOf(now), ranked = IslandCore.rank(ctx.items, ctx.courses, now);
  for (const x of ranked) {
    if (x.kind === "course" && x.mins > 0 && x.mins <= 15 && laoOnce("c|" + t + "|" + x.title + x.time)) return laoSay(`📚 还有 ${Math.round(x.mins)} 分钟上「${x.title}」${x.location ? "，在 " + x.location : ""}`, { q: "下节课在哪" });
    if (x.kind === "item" && x.mins != null && x.mins > 0 && x.mins <= 60 && laoOnce("d|" + x.key + "|" + x.day)) return laoSay(`⏰「${x.title}」还剩 ${Math.max(1, Math.round(x.mins))} 分钟${x.type === "作业" ? "就截止了" : ""}！`, { q: "最急的是什么" });
  }
  const late = ranked.filter((x) => x.level === "late");
  if (late.length && now.getHours() >= 8 && laoOnce("late|" + t)) return laoSay(`😣 有 ${late.length} 项作业过期了，最早的是「${late[0].title}」，先补上吧`, { q: "有没有过期的作业" });
  if (now.getHours() >= 20 && now.getHours() < 23 && laoOnce("eve|" + t)) {
    const tm = shiftDay(t, 1), n = ctx.items.filter((x) => x.day === tm && !x.done).length, c = islandCourses(tm);
    if (n || c.length) return laoSay(`🌙 明天${c.length ? " " + c.length + " 节课" + (c[0].t0 ? "，第一节 " + c[0].t0 : "") : ""}${n ? (c.length ? "，" : " ") + n + " 件事" : ""}，点我看看`, { q: "明天有什么安排" });
  }
}

// ---------- 往下滑的时候缩到边上，不挡内容 ----------
function laoTuck(on) {
  const el = $("lao"); if (!el || islandState === "open") return;
  el.classList.toggle("tuck", on);
}
document.addEventListener("scroll", (e) => {   // 页面里任何地方在滚动都算（有的页面是里面一块在滚）
  if (islandState === "open" || ($("laoBub") && $("laoBub").classList.contains("show")) || (e.target.closest && e.target.closest("#lao"))) return;
  laoTuck(true); clearTimeout(laoTuckT); laoTuckT = setTimeout(() => laoTuck(false), 2500);
}, { passive: true, capture: true });

// ---------- 按住拖动：左右贴边，上下随便放 ----------
(() => {
  const el = $("lao"); if (!el) return;
  let st = null;
  el.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#laoBot, #laoScr") || islandState === "open") return;
    st = { x: e.clientX, y: e.clientY, y0: +islandOpts().y || 0, moved: false, id: e.pointerId };
  });
  window.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 8) return;
    if (!st.moved) { st.moved = true; el.classList.add("drag"); laoHush(); }
    el.style.setProperty("--lao-y", Math.max(-(innerHeight - 260), Math.min(0, st.y0 + dy)) + "px");
    el.style.setProperty("--lao-dx", dx + "px");
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.moved) return;
    el.classList.remove("drag"); el.style.setProperty("--lao-dx", "0px");
    const side = e.clientX < innerWidth / 2 ? "l" : "r", y = Math.max(-(innerHeight - 260), Math.min(0, s.y0 + (e.clientY - s.y)));
    el.dataset.dragged = "1"; setTimeout(() => { delete el.dataset.dragged; }, 50);
    islandSave({ side, y: Math.round(y) });
  };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
})();

function islandOpen(open, quiet) {
  islandState = open ? "open" : "bar";
  if (open) { islandSet = false; laoHush(); }
  renderIsland();
  if (open && !quiet) setTimeout(() => { if (!matchMedia("(max-width: 700px)").matches) $("isQ").focus(); }, 60);
}

// ---------- 问答 ----------
async function islandAsk(q) {
  q = String(q || "").trim(); if (!q || islandBusy) return;
  islandMsgs.push({ me: true, text: q });
  const ctx = islandCtx();
  const a = IslandCore.answer(q, ctx);
  if (!a && typeof laiReady === "function" && laiReady()) {
    // 电脑上装了本地 AI：听不懂的问题交给 AI（带上日历和课表）
    const m = { text: "", typing: true }; islandMsgs.push(m); islandBusy = true; renderIsland();
    try {
      let out = "";
      await laiChat([{ role: "system", content: askContext() }, { role: "user", content: q }], { onToken: (t) => { out += t; m.typing = false; m.html = mdLite(out); renderIsland(); } });
      if (!out) { m.typing = false; Object.assign(m, IslandCore.fallback()); }
    } catch (e) { m.typing = false; Object.assign(m, IslandCore.fallback()); }
    islandBusy = false; renderIsland(); return;
  }
  const m = { text: "", typing: true }; islandMsgs.push(m); renderIsland();
  setTimeout(() => { Object.assign(m, a || IslandCore.fallback(), { typing: false }); renderIsland(); }, 380);   // 停顿一下，像在想
}

// ---------- 事件 ----------
document.addEventListener("click", (e) => {
  const el = $("lao"); if (!el) return;
  const t = e.target;
  if (!t.closest("#lao")) { if (islandState === "open" && !t.closest("dialog, .modal2")) islandOpen(false); return; }
  if (el.dataset.dragged) return;
  if (t.closest("[data-laox]")) { laoHush(); return; }
  if (t.closest("#laoBub")) { const q = $("laoBub").dataset.q; islandOpen(true, true); if (q) islandAsk(q); return; }
  if (t.closest("#laoBot, #laoScr")) return islandOpen(islandState !== "open");
  if (t.closest("#isClose")) return islandOpen(false);
  if (t.closest("#isGear")) { islandSet = !islandSet; renderIsland(true); if (islandSet) $("isBody").scrollTop = 0; return; }
  if (t.closest("#isOff")) { islandOpen(false); islandSave({ on: false }); return; }
  if (t.closest("#laoReset")) { islandSave({ side: "", y: 0 }); return; }
  const q = t.closest("[data-isq]"); if (q) return islandAsk(q.dataset.isq);
  const g = t.closest("[data-isgo]");
  if (g) {
    islandOpen(false);
    if (g.dataset.isgo === "course") { const tl = typeof courseTool === "function" && courseTool(); showView(tl ? tl.view : "calendar"); }
    else if (g.dataset.isgo === "calendar" && g.dataset.day) { selectedKey = g.dataset.day; showView("calendar"); try { renderAll(); } catch (err) {} }
    else showView(g.dataset.isgo);
    return;
  }
  const a = t.closest("[data-isact]");
  if (a) { islandOpen(false); const k = a.dataset.isact; if (k === "pomo") $("qPomo").click(); else if (k === "courses") ck().openImport && ck().openImport(); else showView(k); return; }
  // 勾完成（data-act="done"）交给网站本来的处理，这里勾完再刷新一下
  if (t.closest('[data-act="done"]')) setTimeout(() => renderIsland(true), 50);
});
document.addEventListener("change", (e) => {
  const s = e.target.closest && e.target.closest("[data-isshow]");
  if (s) { const o = islandOpts(), set = new Set(o.show); s.checked ? set.add(s.dataset.isshow) : set.delete(s.dataset.isshow); islandRot = 0; islandSave({ show: ISLAND_SHOW.map(([k]) => k).filter((k) => set.has(k)) }); return; }
  const op = e.target.closest && e.target.closest("[data-isopt]");
  if (op) { islandSave({ [op.dataset.isopt]: op.checked }); return; }
  if (e.target.id === "optIsland") { islandState = "bar"; islandSave({ on: e.target.checked }); if (e.target.checked) setTimeout(() => laoSay("我回来啦 👋 点我可以问问题"), 300); }
});
$("isForm").onsubmit = (e) => { e.preventDefault(); const v = $("isQ").value; $("isQ").value = ""; islandAsk(v); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && islandState === "open") islandOpen(false); });
// 每秒：番茄钟倒计时；每 6 秒：屏幕换一个内容；每分钟：看看有没有要提醒的
setInterval(() => {
  if (islandState === "open" || document.hidden) return;
  const live = typeof pomo !== "undefined" && (pomo.mode === "focus" || pomo.mode === "break") && islandOpts().show.includes("pomo");
  if (live) { renderIsland(true); }
  else if (Date.now() - islandRotT > 6000) { islandRotT = Date.now(); islandRot++; renderIsland(true); }
}, 1000);
setInterval(laoWatch, 60000);

// 进来时打个招呼：每次打开网站一次，冒个泡泡说最该先做什么
function islandHello() {
  if (islandGreeted || islandOpts().on === false) return;
  islandGreeted = true;
  if (!islandOpts().greet || !currentUser) { laoWatch(); return; }
  try { if (sessionStorage.getItem("island_hi")) { laoWatch(); return; } sessionStorage.setItem("island_hi", "1"); } catch (e) {}
  if (heroInView) { laoWatch(); return; }   // 首页问候卡已经写了，不再重复冒泡
  laoSay(IslandCore.greet(islandCtx()), { ms: 8000, q: "最急的是什么" });
  setTimeout(laoWatch, 9000);
}
let heroInView = false;
// 首页问候卡里本来就有捞捞：卡片在屏幕上时，右下角那个先躲起来（点卡片里的捞捞一样能聊天）
(() => {
  const hero = $("hero"); if (!hero || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([en]) => {
    // 用户希望捞捞一直在：不再因为首页问候卡在屏幕上就躲起来（只是不重复打招呼）
    heroInView = en.isIntersecting && document.documentElement.dataset.skin === "fresh" && !!hero.querySelector(".hero.fx");
  }, { threshold: 0.35 }).observe(hero);
})();
document.addEventListener("click", (e) => {
  if (!e.target.closest(".hx-lao")) return;
  if (islandOpts().on === false) { showView("me"); return; }
  islandOpen(true);
});
renderIsland();
try { renderAgenda(); } catch (e) {}   // 首页的「接下来」卡片也用这里的数据，加载好后画一次
setTimeout(islandHello, 2200);
