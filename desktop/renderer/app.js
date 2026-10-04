// 捞捞课程表 电脑版 · 界面外壳：登录、侧边栏、页面切换、命令面板、快捷键
"use strict";
// 侧边栏：按用途分组；Ctrl+1…9 依次对应前 9 个
const NAV = [
  ["学习", ["today", "week", "homework", "tasks", "month"]],
  ["班级", ["wall", "people", "rank", "classes"]],
  ["成长", ["plan", "focus", "growth", "countdown", "meta"]],
  ["工具", ["ai", "ingest", "tools", "report"]],
];
const ORDER = NAV.flatMap((g) => g[1]);
// 被老师或管理员关掉的功能（和网页版同一套开关）
const VIEW_FEAT = { homework: ["homework"], wall: ["wall"], plan: ["plan"], growth: ["growth"], ai: ["ask"], tools: ["tools"], rank: ["rank"], meta: ["metaverse"], ingest: ["ingest_local", "ingest_cloud"] };
const viewOn = (id) => !VIEW_FEAT[id] || VIEW_FEAT[id].some((k) => App.feat(k));
const mounted = {}, dirty = {};

function buildNav() {
  let i = 0;
  $("#nav").innerHTML = NAV.map(([g, ids]) => `<div class="nav-g">${g}</div>` + ids.map((id) => {
    const v = App.views[id]; i++;
    return `<button class="nav-item" data-view="${id}" title="${v.title}${i <= 9 ? "（Ctrl+" + i + "）" : ""}">${icon(v.icon || id)}<span>${v.title}</span><span class="cnt hidden"></span></button>`;
  }).join("")).join("");
  $("#navMe").innerHTML = `${icon("me")}<span>我的</span>`;
  $("#navSettings").innerHTML = `${icon("settings")}<span>设置</span><span class="kb">Ctrl ,</span>`;
  $$(".nav-item").forEach((b) => (b.onclick = () => App.go(b.dataset.view)));
}
function navCounts() {
  for (const id of ORDER) {
    const v = App.views[id], btn = $(`.nav-item[data-view="${id}"]`), el = btn && $(".cnt", btn);
    if (!el) continue;
    btn.classList.toggle("hidden", !viewOn(id) || !!(v.navOn && !v.navOn()));
    const c = v.count ? v.count() : null;
    el.classList.toggle("hidden", !c || !c.n);
    if (c && c.n) { el.textContent = c.n > 99 ? "99+" : c.n; el.classList.toggle("hot", !!c.hot); }
  }
  drawBadge();
}
// 任务栏图标上的数字角标（主进程只认图片，这里画好再传过去）
let badgeLast = null;
function drawBadge(n) {
  if (n === undefined) n = App.badgeN;
  if (n == null || n === badgeLast) return;
  badgeLast = n;
  if (!n) { window.cc.call("badge", null, 0).catch(() => {}); return; }
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "#e5484d"; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.font = `bold ${n > 9 ? 17 : 21}px "Segoe UI", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(n > 99 ? "99" : String(n), 16, 17);
  window.cc.call("badge", c.toDataURL("image/png"), n).catch(() => {});
}

App.go = function (id, arg) {
  if (id === "new") { editItem(null); return; }
  if (!App.views[id]) id = "today";
  if (!viewOn(id)) { toast(`「${App.views[id].title}」暂时用不了：${App.featWhy((VIEW_FEAT[id] || [])[0])}`, { bad: true }); id = "today"; }
  closeOverlay();
  const v = App.views[id];
  if (!mounted[id]) { const el = h(`<section class="view" data-v="${id}"></section>`); $("#main").append(el); v.el = el; v.mount(el); mounted[id] = true; dirty[id] = true; }
  $$(".view").forEach((el) => el.classList.toggle("hidden", el.dataset.v !== id));
  $$(".nav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === id));
  document.documentElement.dataset.view = id;
  App.view = id;
  if (dirty[id]) { dirty[id] = false; v.update(); }
  if (v.show) v.show(arg || {});
};

function render() {
  const S = App.S;
  $("#app").classList.remove("booting");
  const login = !S.loggedIn;
  $("#app").classList.toggle("login-mode", login);
  $("#login").classList.toggle("hidden", !login);
  $("#side").classList.toggle("hidden", login);
  $("#main").classList.toggle("hidden", login);
  if (login) { setTimeout(() => !$("#lgAcct").value && $("#lgAcct").focus(), 50); return; }
  const me = S.me || {};
  document.documentElement.dataset.theme = S.settings.theme === "meta" ? "meta" : "";
  document.documentElement.dataset.accent = S.settings.accent || "blue";
  if (!Plugins.started) setTimeout(() => Plugins.start().catch(() => {}), 1500);
  $("#meName").textContent = me.display_name || me.account || "我";
  $("#meAv").textContent = (me.display_name || me.account || "我").slice(-1);
  $("#meClass").textContent = App.className() || "还没加入班级";
  const st = S.status || {};
  const dot = $("#syncDot");
  dot.className = "sync" + (st.syncing ? " busy" : !st.online ? " off" : st.error ? " err" : "");
  dot.title = st.syncing ? "正在同步…" : !st.online ? "没联网：改动先存在本机，联网后自动同步" : st.error ? "同步出错：" + st.error : `已同步${S.lastRefresh ? "（" + new Date(S.lastRefresh).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "）" : ""}${S.pending ? `，还有 ${S.pending} 条改动等待上传` : ""}`;
  for (const id of ORDER.concat("settings", "me")) dirty[id] = true;
  if (me.must_change_pw && !App._pwAsked) { App._pwAsked = true; setTimeout(() => App.views.me.changePw(true), 400); }
  if (!mounted[App.view]) App.go(App.view);
  else { dirty[App.view] = false; App.views[App.view].update(); }
  navCounts();
}

// ---------- 登录 ----------
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#lgBtn"); btn.disabled = true; btn.textContent = "登录中…"; $("#lgErr").textContent = "";
  try { App.S = await window.cc.call("login", $("#lgAcct").value.trim(), $("#lgPw").value); $("#lgPw").value = ""; render(); App.go("today"); }
  catch (err) { $("#lgErr").textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); }
  finally { btn.disabled = false; btn.textContent = "登录"; }
};
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-ext]");
  if (a) { e.preventDefault(); window.cc.call("open:external", a.dataset.ext); }
});

// ---------- 切换班级 ----------
$("#meCard").onclick = (e) => {
  const cls = (App.S.classes || []).filter((c) => c.status !== "pending");
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.left, r.top - 8 - (cls.length + 3) * 34, [
    ...cls.map((c) => ({ label: (c.id === App.S.cid ? "✓ " : "　") + c.name + (c.is_teacher ? "（老师）" : ""), fn: () => c.id !== App.S.cid && call("class:switch", c.id).then(() => toast("已切换到 " + c.name)) })),
    cls.length ? "-" : null,
    { label: "加入或管理班级", icon: "week", fn: () => App.go("classes") },
    { label: "我的主页", icon: "me", fn: () => App.go("people", { uid: App.S.me && App.S.me.id }) },
    { label: "设置", icon: "settings", fn: () => App.go("settings") },
  ]);
};

// ---------- 命令面板 Ctrl+K ----------
function commands() {
  const c = ORDER.map((id, i) => ({ g: "跳转", i: "→", t: "打开「" + App.views[id].title + "」", k: "Ctrl " + (i + 1), fn: () => App.go(id) }));
  c.push({ g: "跳转", i: "⚙", t: "打开设置", k: "Ctrl ,", fn: () => App.go("settings") }, { g: "跳转", i: "👤", t: "打开「我的」", fn: () => App.go("me") });
  c.push(
    { g: "操作", i: "＋", t: "记一件事", k: "Ctrl N", fn: () => editItem(null) },
    { g: "操作", i: "⟳", t: "立即同步", k: "F5", fn: () => call("refresh").then(() => toast("已同步")) },
    { g: "操作", i: "🍅", t: `开始专注 ${App.S.settings.pomoFocus} 分钟`, fn: () => App.go("focus", { start: true }) },
    { g: "操作", i: "▣", t: "打开 / 关闭桌面小窗", fn: () => call("mini:toggle") },
    { g: "操作", i: "⇪", t: "导出到日历（.ics）", fn: () => App.views.settings.exportIcs() },
    { g: "操作", i: "◐", t: "切换深色 / 浅色", fn: () => call("settings", { theme: matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark" }) },
    { g: "操作", i: "✦", t: "问 AI 助手", fn: () => App.go("ai") },
    { g: "操作", i: "✨", t: "整理群消息（粘贴剪贴板）", fn: () => App.go("ingest", { paste: true }) },
    { g: "操作", i: "⏳", t: "添加倒数日", fn: () => App.go("countdown", { add: true }) },
    { g: "操作", i: "🖼", t: "把课程表设成桌面壁纸", fn: () => App.views.week.wallpaper() },
    { g: "操作", i: "🖨", t: "导出本周课表和作业（PDF）", fn: () => App.views.week.exportPdf() },
    { g: "操作", i: "💾", t: "立即备份到「文档」", fn: () => call("backup:now").then((f) => toast("已备份：" + f.split(/[\\/]/).pop())) },
    { g: "操作", i: "☀", t: "打开今日简报", fn: () => call("brief:open") },
    { g: "操作", i: "📊", t: "本周学习报告", fn: () => App.go("report") },
  );
  return c;
}
function palette(initial) {
  const d = h(`<div class="dialog palette" role="dialog"><div class="pin">${icon("search")}<input placeholder="搜索事项，或输入命令（比如「专注」「同步」）" spellcheck="false"><kbd>Esc</kbd></div><div class="plist"></div><div class="phint"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span>输入「+ 内容」直接记一件事</span></div></div>`);
  const inp = d.querySelector("input"), list = d.querySelector(".plist");
  let rows = [], sel = 0;
  const hl = (t, q) => { if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length)); };
  function draw() {
    const q = inp.value.trim(), now = App.now();
    rows = [];
    if (q.startsWith("+") || q.startsWith("＋")) {
      const p = P.parse(q.slice(1), now);
      rows.push({ g: "记一件事", i: "＋", t: p.subject || "（写点内容）", s: [p.date && M.relDay(p.date, now), p.time, p.location && "@" + p.location].filter(Boolean).join(" "), fn: () => p.subject && call("quick:add", q.slice(1)).then(() => toast("已记下：" + p.subject)) });
    } else {
      const cmds = commands().filter((c) => !q || c.t.includes(q) || c.t.toLowerCase().includes(q.toLowerCase()));
      const items = q ? M.sortItems(App.items().filter((x) => (x.title + " " + x.summary + " " + x.location + " " + x.note).toLowerCase().includes(q.toLowerCase()))).slice(0, 30)
        : M.sortItems(App.items().filter((x) => !x.done && !x.hidden && x.day && M.dayDiff(x.day, now) >= 0)).slice(0, 6);
      const courses = q ? (App.S.courses.courses || []).filter((c) => c.name.includes(q) || (c.location || "").includes(q) || (c.teacher || "").includes(q)).slice(0, 5) : [];
      rows = rows.concat(items.map((x) => ({ g: q ? "事项" : "接下来", i: x.done ? "✓" : "•", t: x.title, html: hl(x.title, q), s: x.type + " · " + whenText(x, now), fn: () => App.go("tasks", { key: x.key }) })));
      rows = rows.concat(courses.map((c) => ({ g: "课程", i: "📚", t: c.name, html: hl(c.name, q), s: `周${"一二三四五六日"[c.day]} 第${c.start}${c.end > c.start ? "-" + c.end : ""}节 ${c.location || ""}`, fn: () => App.go("week") })));
      rows = rows.concat(cmds);
      if (q) rows.push({ g: "记一件事", i: "＋", t: "记下「" + q + "」", fn: () => call("quick:add", q).then(() => toast("已记下")) });
    }
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    let g = "", html = "";
    rows.forEach((r, i) => { if (r.g !== g) { g = r.g; html += `<div class="pgrp">${esc(g)}</div>`; } html += `<div class="pit${i === sel ? " sel" : ""}" data-i="${i}"><span class="pi">${esc(r.i)}</span><span class="pt">${r.html || esc(r.t)}</span><span class="ps">${esc(r.s || r.k || "")}</span></div>`; });
    list.innerHTML = html || '<div class="empty">没找到</div>';
    const s = list.querySelector(".sel"); if (s) s.scrollIntoView({ block: "nearest" });
  }
  const run = (i) => { const r = rows[i]; if (!r) return; closeOverlay(); r.fn(); };
  inp.oninput = () => { sel = 0; draw(); };
  inp.onkeydown = (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(rows.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { run(sel); e.preventDefault(); }
  };
  list.onmousemove = (e) => { const it = e.target.closest(".pit"); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; $$(".pit", list).forEach((x) => x.classList.toggle("sel", +x.dataset.i === sel)); } };
  list.onclick = (e) => { const it = e.target.closest(".pit"); if (it) run(+it.dataset.i); };
  openOverlay(d);
  inp.value = initial || ""; draw(); inp.focus();
}
$("#tbSearch").onclick = () => App.S.loggedIn && palette();
$("#navMe").onclick = () => App.go("me");
App.palette = palette;

// ---------- 快捷键 ----------
const typing = (e) => { const t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); };
document.addEventListener("keydown", (e) => {
  if (!App.S || !App.S.loggedIn) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") { if ($(".menu")) { $$(".menu").forEach((m) => m.remove()); return; } if (overlayOpen()) { closeOverlay(); e.preventDefault(); return; } }
  if (ctrl && (e.key === "k" || e.key === "K")) { e.preventDefault(); overlayOpen() ? closeOverlay() : palette(); return; }
  if (overlayOpen()) return;
  if (ctrl && /^[1-9]$/.test(e.key)) { e.preventDefault(); App.go(ORDER[+e.key - 1]); return; }
  if (ctrl && e.key === ",") { e.preventDefault(); App.go("settings"); return; }
  if (ctrl && (e.key === "n" || e.key === "N")) { e.preventDefault(); editItem(null); return; }
  if (e.key === "F5" || (ctrl && (e.key === "r" || e.key === "R"))) { e.preventDefault(); call("refresh").then(() => toast("已同步")); return; }
  const v = App.views[App.view];
  if (v && v.keys && v.keys(e, typing(e))) e.preventDefault();
});
// 防止把文件拖进窗口时被打开
document.addEventListener("dragover", (e) => { if (!e.target.closest("[data-drop]")) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (!e.target.closest("[data-drop]")) e.preventDefault(); });

// ---------- 主进程推过来的事件 ----------
window.cc.on("state", (s) => { const was = App.S && App.S.loggedIn; App.S = s; render(); if (!was && s.loggedIn && App.view === "today") App.go("today"); });
window.cc.on("nav", (v) => { if (!App.S || !App.S.loggedIn) return; if (typeof v === "string") App.go(v); else if (v && v.view) App.go(v.view, v); });
window.cc.on("pomo", (p) => { App.pomo = p; App.views.focus.pomo && App.views.focus.pomo(p); App.views.today.pomo && App.views.today.pomo(p); });
window.cc.on("pomo-done", () => cheer("pomo"));
window.cc.on("badge", (n) => { App.badgeN = n; drawBadge(n); });
window.cc.on("ai-state", (a) => { if (App.S) App.S.ai = a; App.views.ai.aiState && App.views.ai.aiState(a); });
window.cc.on("ai-token", (t) => App.views.ai.token && App.views.ai.token(t));

// 每分钟刷新一次和时间有关的地方（现在上到哪节课、倒计时）
let lastDay = M.dayKey(new Date());
setInterval(() => {
  if (!App.S || !App.S.loggedIn) return;
  const v = App.views[App.view];
  const today = M.dayKey(new Date());
  if (today !== lastDay) { lastDay = today; App._itemsOf = null; render(); App.autoWallpaper(); return; }
  if (v && v.tick) v.tick();
  navCounts();
}, 30000);

(async function boot() {
  buildNav();
  App.S = await window.cc.call("state");
  App.pomo = await window.cc.call("pomo:state");
  render();
  if (App.S.loggedIn) { App.go("today"); setTimeout(() => App.autoWallpaper(), 8000); }
})();
