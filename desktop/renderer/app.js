// 捞捞课程表 电脑版 · 界面外壳：登录 / 注册 / 找回密码、侧栏、标题栏（页面名 + 课铃线）、详情栏、命令面板、快捷键
"use strict";
// 侧栏：按用途分组；Ctrl+1…9 依次对应前 9 个
const NAV = [
  ["今天", ["today", "week", "homework", "tasks", "month"]],
  ["学习", ["study", "mindmap", "focus", "plan", "ai"]],
  ["班级", ["wall", "people", "rank", "classes", "ingest"]],
  ["成长", ["growth", "farm", "countdown", "report", "meta"]],
  ["更多", ["tools"]],
];
const ORDER = NAV.flatMap((g) => g[1]);
const EXTRA_VIEWS = ["settings", "me", "intro", "credits"];   // 不在侧栏里，但能跳过去（我的、命令面板）
// 被老师或管理员关掉的功能（和网页版同一套开关）
const VIEW_FEAT = { homework: ["homework"], wall: ["wall"], plan: ["plan"], growth: ["growth"], ai: ["ask"], tools: ["tools"], rank: ["rank"], meta: ["metaverse"], ingest: ["ingest_local", "ingest_cloud"], farm: ["growth"] };
const viewOn = (id) => !VIEW_FEAT[id] || VIEW_FEAT[id].some((k) => App.feat(k));
const mounted = {}, dirty = {};
// 单独开出来的窗口（index.html#pop=week）：只显示这一页，没有侧栏
const POP = (/[#&]pop=([a-z]+)/.exec(location.hash) || [])[1] || "";
if (POP) document.documentElement.classList.add("popout");

function buildNav() {
  let i = 0;
  $("#nav").innerHTML = NAV.map(([g, ids]) => `<div class="nav-g">${g}</div>` + ids.filter((id) => App.views[id]).map((id) => {
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
  drawBadge(); crumb(); bell();
  if (typeof DIsland !== "undefined") DIsland.render(true);
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
  g.fillStyle = "#f0702a"; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.font = `bold ${n > 9 ? 17 : 21}px "Segoe UI", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(n > 99 ? "99" : String(n), 16, 17);
  window.cc.call("badge", c.toDataURL("image/png"), n).catch(() => {});
}

// ---------- 标题栏：页面名 + 今天是第几周、正在上什么 ----------
function crumb() {
  const el = $("#tbCrumb"); if (!el || !App.S || !App.S.loggedIn) return;
  const v = App.views[App.view] || {}, now = App.now(), wk = M.weekOf((App.S.courses || {}).meta, now);
  const st = nowCourse(now);
  el.innerHTML = `<b>${esc(v.title || "")}</b><span>${now.getMonth() + 1}月${now.getDate()}日 周${M.WEEK[now.getDay()]}${wk ? ` · 第 <span class="num">${wk}</span> 周` : ""}</span>${st ? `<span>${esc(st)}</span>` : ""}`;
}
// 现在在上哪节 / 下节是什么（标题栏、课铃线都用）
function nowCourse(now) {
  const list = M.coursesOn(App.S.courses, now), nm = now.getHours() * 60 + now.getMinutes();
  const cur = list.find((c) => M.toMin(c.tStart) <= nm && nm < M.toMin(c.tEnd));
  if (cur) return `正在上 ${cur.name} · 还剩 ${untilText(M.toMin(cur.tEnd) - nm)}`;
  const nx = list.find((c) => M.toMin(c.tStart) > nm);
  if (nx && M.toMin(nx.tStart) - nm <= 90) return `${untilText(M.toMin(nx.tStart) - nm)}后 ${nx.name}${nx.location ? " · " + nx.location : ""}`;
  return "";
}
// 课铃线：今天每一节课一段（中间没课的空档也占位），上过的填满，正在上的那节有走针
function bell() {
  const el = $("#bell"); if (!el || !App.S) return;
  const now = App.now(), meta = (App.S.courses || {}).meta || {}, times = M.periodTimes(meta), list = M.coursesOn(App.S.courses, now), nm = now.getHours() * 60 + now.getMinutes();
  if (!list.length) { el.className = "bell none"; el.innerHTML = ""; el.title = (App.S.courses.courses || []).length ? "今天没课" : "还没有课程表"; return; }
  const last = Math.max(...list.map((c) => c.end || c.start), 8);
  const by = {}; for (const c of list) for (let p = c.start; p <= (c.end || c.start); p++) by[p] = c;
  let html = "";
  for (let p = 1; p <= last; p++) {
    if (p > 1) { const a = M.toMin((times[p - 2] || "").split("-")[1]), b = M.toMin((times[p - 1] || "").split("-")[0]); if (a != null && b != null && b - a >= 40) html += `<i class="gap"></i>`; }
    const c = by[p], [a, b] = (times[p - 1] || "").split("-").map(M.toMin);
    const cls = !c ? "" : nm >= b ? "c past" : nm >= a ? "c on" : "c";
    const pct = c && nm >= a && nm < b ? Math.round(((nm - a) / (b - a)) * 100) : 0;
    html += `<i class="${cls}" style="${c ? `--c:${c.color};` : ""}${pct ? `--p:${pct}%` : ""}" title="第 ${p} 节 ${times[p - 1] || ""}${c ? " · " + esc(c.name) : ""}"></i>`;
  }
  el.className = "bell"; el.innerHTML = html;
  el.title = `今天 ${list.length} 节课` + (nowCourse(now) ? " · " + nowCourse(now) : "");
}
$("#bell").onclick = () => App.S && App.S.loggedIn && App.go("week");

App.go = function (id, arg) {
  if (id === "new") { editItem(null); return; }
  if (id === "intro" || id === "credits") { arg = { ...(arg || {}), tab: id }; id = "me"; }   // 功能介绍、感谢名单是「我的」里的两页
  if (!App.views[id]) id = "today";
  if (!viewOn(id)) { toast(`「${App.views[id].title}」暂时用不了：${App.featWhy((VIEW_FEAT[id] || [])[0])}`, { bad: true }); id = "today"; }
  closeOverlay();
  if (App.view !== id && typeof App.views[App.view]?.leave === "function") { try { App.views[App.view].leave(); } catch (e) {} }
  const v = App.views[id];
  if (!mounted[id]) {
    if (!v.premounted) { const el = h(`<section class="view" data-v="${id}"></section>`); $("#main").append(el); v.el = el; v.mount(el); }
    mounted[id] = true; dirty[id] = true;
  }
  $$(".view").forEach((el) => el.classList.toggle("hidden", el.dataset.v !== id));
  $$(".nav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === id));
  document.documentElement.dataset.view = id;
  if (App.view !== id) Insp.close();
  App.view = id;
  if (dirty[id]) { dirty[id] = false; v.update(); }
  if (v.show) v.show(arg || {});
  crumb();
};

function render() {
  const S = App.S;
  $("#app").classList.remove("booting");
  const login = !S.loggedIn;
  $("#app").classList.toggle("login-mode", login);
  $("#login").classList.toggle("hidden", !login);
  $("#side").classList.toggle("hidden", login);
  $("#main").classList.toggle("hidden", login);
  if (login) { Insp.close(); setTimeout(() => { const f = $(".lg-form:not(.hidden) input"); if (f && !f.value) f.focus(); }, 50); return; }
  const me = S.me || {};
  document.documentElement.dataset.theme = S.settings.theme === "meta" ? "meta" : "";
  document.documentElement.dataset.accent = S.settings.accent || "jade";
  if (!Plugins.started && !POP) setTimeout(() => Plugins.start().catch(() => {}), 1500);   // 单独的窗口不再启动一遍工具
  $("#meName").textContent = me.display_name || me.account || "我";
  $("#meAv").textContent = [...(me.display_name || me.account || "我")].slice(-1)[0];
  $("#meAv").style.background = me.gender === "f" ? "#e0457b" : me.gender === "m" ? "#2f6fd6" : "";
  $("#meClass").textContent = App.className() || "还没加入班级";
  const st = S.status || {};
  const dot = $("#syncDot");
  dot.className = "sync" + (st.syncing ? " busy" : !st.online ? " off" : st.error ? " err" : "");
  dot.title = st.syncing ? "正在同步…" : !st.online ? "没联网：改动先存在本机，联网后自动同步" : st.error ? "同步出错：" + st.error
    : `已同步${S.lastRefresh ? "（" + new Date(S.lastRefresh).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "）" : ""}${S.live ? "，实时同步开着：别的设备改了几秒内就过来" : ""}${S.pending ? `，还有 ${S.pending} 条改动等待上传` : ""}`;
  for (const id of ORDER.concat(EXTRA_VIEWS)) dirty[id] = true;
  if (me.must_change_pw && !App._pwAsked) { App._pwAsked = true; setTimeout(() => App.views.me.changePw(true), 400); }
  if (!mounted[App.view]) App.go(App.view);
  else { dirty[App.view] = false; App.views[App.view].update(); }
  Insp.refresh();
  navCounts();
}

// ---------- 登录 / 注册 / 找回密码 ----------
const lgErr = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
function lgMode(m) {
  for (const [id, k] of [["#loginForm", "login"], ["#signupForm", "signup"], ["#forgotForm", "forgot"]]) $(id).classList.toggle("hidden", m !== k);
  if (m === "forgot") { $("#fgAcct").value = $("#lgAcct").value.trim().toLowerCase(); $("#fg2").classList.add("hidden"); $("#fgBtn").textContent = "发送验证码"; $("#fgHelp").textContent = "验证码会发到你绑定的邮箱"; }
  if (m === "signup" && !$("#suSchools").childElementCount && window.CC_SCHOOLS) $("#suSchools").innerHTML = window.CC_SCHOOLS.p.flatMap(([, l]) => l.map((x) => `<option value="${esc(x[0])}">`)).join("");
  setTimeout(() => { const f = $(".lg-form:not(.hidden) input"); if (f) f.focus(); }, 30);
}
document.addEventListener("click", (e) => { const a = e.target.closest("[data-lg]"); if (a) { e.preventDefault(); lgMode(a.dataset.lg); } });
async function afterLogin(s) { App.S = s; render(); App.go(POP || "today"); if (!POP) setTimeout(() => DIsland.hello(), 1500); }
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#lgBtn"); btn.disabled = true; btn.textContent = "登录中…"; $("#lgErr").textContent = "";
  try { const s = await window.cc.call("login", $("#lgAcct").value.trim(), $("#lgPw").value); $("#lgPw").value = ""; afterLogin(s); }
  catch (err) { $("#lgErr").textContent = lgErr(err); }
  finally { btn.disabled = false; btn.textContent = "登录"; }
};
// 注册：账号边输边查有没有被注册
let suTimer = 0;
$("#suAcct").oninput = () => {
  const v = $("#suAcct").value.trim().toLowerCase(), hint = $("#suAcctHint");
  clearTimeout(suTimer); hint.className = "lg-hint";
  if (!v) { hint.textContent = ""; return; }
  if (!/^[a-z0-9_]{3,20}$/.test(v)) { hint.textContent = "只能用 3~20 位小写字母、数字或下划线"; hint.className = "lg-hint err"; return; }
  hint.textContent = "正在检查有没有被注册…";
  suTimer = setTimeout(async () => {
    try { const ok = await window.cc.call("api:anon", "account_available", { acct: v }); hint.textContent = ok === false ? "这个账号已经被注册了，换一个，或者去登录" : "这个账号可以用"; hint.className = "lg-hint " + (ok === false ? "err" : "ok"); }
    catch (e) { hint.textContent = "格式没问题"; }
  }, 400);
};
$("#signupForm").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("#suErr"); err.textContent = "";
  const acct = $("#suAcct").value.trim().toLowerCase(), pw = $("#suPw").value, g = (document.querySelector("input[name=sug]:checked") || {}).value;
  if (!/^[a-z0-9_]{3,20}$/.test(acct)) { err.textContent = "账号格式不对"; return $("#suAcct").focus(); }
  if (!g) { err.textContent = "请选择男生还是女生"; return; }
  if (pw.length < 8) { err.textContent = "密码至少 8 位"; return $("#suPw").focus(); }
  if (pw !== $("#suPw2").value) { err.textContent = "两次输入的密码不一样"; return $("#suPw2").focus(); }
  if (!$("#suAgree").checked) { err.textContent = "请先阅读并同意用户协议和隐私政策"; return; }
  const btn = $("#suBtn"); btn.disabled = true; btn.textContent = "注册中…";
  try {
    const org = $("#suOrgT").value ? { type: $("#suOrgT").value, name: $("#suOrgN").value.trim() } : null;
    const s = await window.cc.call("signup", acct, pw, { name: $("#suName").value.trim(), role: $("#suRole").value, gender: g, org });
    $("#suPw").value = $("#suPw2").value = "";
    afterLogin(s); toast("注册好了，欢迎 🎉 去「班级」里加入你的班级吧");
  } catch (e2) { err.textContent = lgErr(e2); }
  finally { btn.disabled = false; btn.textContent = "注册并登录"; }
};
// 忘记密码：先发验证码到绑定的邮箱，再填验证码和新密码
$("#forgotForm").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("#fgErr"), acct = $("#fgAcct").value.trim().toLowerCase(), btn = $("#fgBtn"); err.textContent = "";
  if (!/^[a-z0-9_]{3,20}$/.test(acct)) { err.textContent = "请输入正确的账号"; return; }
  btn.disabled = true;
  try {
    if ($("#fg2").classList.contains("hidden")) {
      const r = await window.cc.call("api:anon", "pw_reset_start", { acct });
      if (r && r.ok) { $("#fg2").classList.remove("hidden"); btn.textContent = "设置新密码并登录"; $("#fgHelp").innerHTML = `验证码已发到 <b>${esc(r.email)}</b>，15 分钟内有效`; $("#fgCode").focus(); }
      else $("#fgHelp").textContent = r && r.why === "no_email" ? "这个账号没有绑定邮箱，没法自己找回。请联系班主任：老师在你的个人主页可以给你重置一个临时密码。" : "网站还没开通邮件发送，请联系班主任给你重置临时密码。";
    } else {
      const code = $("#fgCode").value.trim(), pw = $("#fgPw").value;
      if (!/^\d{6}$/.test(code)) { err.textContent = "验证码是 6 位数字"; return; }
      if (pw.length < 8) { err.textContent = "新密码至少 8 位"; return; }
      if (pw !== $("#fgPw2").value) { err.textContent = "两次输入的新密码不一样"; return; }
      await window.cc.call("api:anon", "pw_reset_finish", { acct, code, newpw: pw });
      const s = await window.cc.call("login", acct, pw); afterLogin(s); toast("新密码设置好了");
    }
  } catch (e2) { err.textContent = lgErr(e2); }
  finally { btn.disabled = false; }
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
    { label: "加入或管理班级", icon: "classes", fn: () => App.go("classes") },
    { label: "我的主页", icon: "me", fn: () => App.go("people", { uid: App.S.me && App.S.me.id }) },
    { label: "设置", icon: "settings", fn: () => App.go("settings") },
  ]);
};

// ---------- 命令面板 Ctrl+K ----------
function commands() {
  const c = ORDER.filter((id) => App.views[id] && viewOn(id)).map((id, i) => ({ g: "跳转", i: "→", t: "打开「" + App.views[id].title + "」", k: i < 9 ? "Ctrl " + (i + 1) : "", fn: () => App.go(id) }));
  c.push({ g: "跳转", i: "⚙", t: "打开设置", k: "Ctrl ,", fn: () => App.go("settings") }, { g: "跳转", i: "👤", t: "打开「我的」", fn: () => App.go("me") },
    { g: "跳转", i: "📖", t: "功能介绍", fn: () => App.go("intro") }, { g: "跳转", i: "💛", t: "感谢名单", fn: () => App.go("credits") });
  c.push(
    { g: "操作", i: "＋", t: "记一件事", k: "Ctrl N", fn: () => editItem(null) },
    { g: "操作", i: "📝", t: "记一项自己的作业", fn: () => editItem(null, { kind: "作业" }) },
    App.canAddItem() ? { g: "操作", i: "📣", t: "发布班级事项", fn: () => editClassItem(null) } : null,
    { g: "操作", i: "⟳", t: "立即同步", k: "F5", fn: () => call("refresh").then(() => toast("已同步")) },
    { g: "操作", i: "🍅", t: `开始专注 ${App.S.settings.pomoFocus} 分钟`, fn: () => App.go("focus", { start: true }) },
    { g: "操作", i: "▣", t: "打开 / 关闭桌面小窗", fn: () => call("mini:toggle") },
    { g: "操作", i: "⧉", t: "把当前页面单独开一个窗口", fn: () => popOut(App.view) },
    { g: "操作", i: "⇪", t: "导出到日历（.ics）", fn: () => App.views.settings.exportIcs() },
    { g: "操作", i: "▦", t: "导出事项表格（Excel 能打开）", fn: () => exportCsv("items") },
    { g: "操作", i: "▦", t: "导出课程表表格（Excel 能打开）", fn: () => exportCsv("courses") },
    { g: "操作", i: "◐", t: "切换深色 / 浅色", fn: () => call("settings", { theme: matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark" }) },
    { g: "操作", i: "✦", t: "问 AI 助手", fn: () => App.go("ai") },
    { g: "操作", i: "✨", t: "整理群消息（粘贴剪贴板）", fn: () => App.go("ingest", { paste: true }) },
    { g: "操作", i: "🔁", t: "调课 / 调休", fn: () => CourseEd.adjust() },
    { g: "操作", i: "⏳", t: "添加倒数日", fn: () => App.go("countdown", { add: true }) },
    { g: "操作", i: "🧠", t: "新建思维导图", fn: () => App.go("mindmap", { create: true }) },
    { g: "操作", i: "🖼", t: "把课程表设成桌面壁纸", fn: () => App.views.week.wallpaper() },
    { g: "操作", i: "🖨", t: "导出本周课表和作业（PDF）", fn: () => App.views.week.exportPdf() },
    { g: "操作", i: "💾", t: "立即备份到「文档」", fn: () => call("backup:now").then((f) => toast("已备份：" + f.split(/[\\/]/).pop())) },
    { g: "操作", i: "☀", t: "打开今日简报", fn: () => call("brief:open") },
    { g: "操作", i: "📊", t: "本周学习报告", fn: () => App.go("report") },
    { g: "操作", i: "📰", t: "打开人民日报网站", fn: () => window.cc.call("open:external", "https://www.people.com.cn/") },
    { g: "操作", i: "🌐", t: "打开捞捞课程表网站", fn: () => window.cc.call("open:external", "https://www.laolaokechengbiao.cn/") },
  );
  // 工具箱里的工具也能直接打开
  for (const t of (typeof Plugins !== "undefined" && Plugins.list ? Plugins.list() : [])) c.push({ g: "工具", i: t.icon || "🧩", t: "打开「" + t.name + "」", fn: () => App.go("tools", { open: t.key }) });
  return c.filter(Boolean);
}
function palette(initial) {
  const d = h(`<div class="dialog palette" role="dialog"><div class="pin">${icon("search")}<input placeholder="搜索事项、课程，或输入命令（比如「专注」「同步」「导图」）" spellcheck="false"><kbd>Esc</kbd></div><div class="plist"></div><div class="phint"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span>输入「+ 内容」直接记一件事</span></div></div>`);
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
      rows = rows.concat(items.map((x) => ({ g: q ? "事项" : "接下来", i: x.done ? "✓" : "•", t: x.title, html: hl(x.title, q), s: x.type + " · " + whenText(x, now), fn: () => Insp.open(x.key) })));
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
  // 思维导图自己处理快捷键（它的输入框、Tab、Delete 都有用）
  const own = App.views[App.view] && App.views[App.view].ownKeys && !overlayOpen();
  if (e.key === "Escape") { if ($(".menu")) { $$(".menu").forEach((m) => m.remove()); return; } if (overlayOpen()) { closeOverlay(); e.preventDefault(); return; } if (Insp.isOpen() && !own) { Insp.close(); e.preventDefault(); return; } }
  if (ctrl && (e.key === "k" || e.key === "K")) { e.preventDefault(); overlayOpen() ? closeOverlay() : palette(); return; }
  if (overlayOpen()) return;
  if (ctrl && /^[1-9]$/.test(e.key)) { e.preventDefault(); const vis = ORDER.filter((id) => viewOn(id)); if (vis[+e.key - 1]) App.go(vis[+e.key - 1]); return; }
  if (ctrl && e.key === ",") { e.preventDefault(); App.go("settings"); return; }
  if (own) return;
  if (ctrl && (e.key === "n" || e.key === "N")) { e.preventDefault(); editItem(null); return; }
  if (e.key === "F5" || (ctrl && (e.key === "r" || e.key === "R"))) { e.preventDefault(); call("refresh").then(() => toast("已同步")); return; }
  const v = App.views[App.view];
  if (v && v.keys && v.keys(e, typing(e))) e.preventDefault();
});
// 有人在用：主进程把实时同步问得勤一点
let activeAt = 0;
["pointerdown", "keydown", "wheel"].forEach((t) => document.addEventListener(t, () => { if (Date.now() - activeAt > 20000) { activeAt = Date.now(); window.cc.active && window.cc.active(); } }, { passive: true, capture: true }));
// 防止把文件拖进窗口时被打开
document.addEventListener("dragover", (e) => { if (!e.target.closest("[data-drop]")) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (!e.target.closest("[data-drop]")) e.preventDefault(); });

// ---------- 主进程推过来的事件 ----------
window.cc.on("state", (s) => { const was = App.S && App.S.loggedIn; if (typeof s.clockOff === "number") M.setClock(s.clockOff); App.S = s; App._itemsOf = null; render(); if (!was && s.loggedIn && App.view === "today") App.go("today"); if (!was && s.loggedIn) setTimeout(() => DIsland.hello(), 1500); });
window.cc.on("nav", (v) => { if (!App.S || !App.S.loggedIn) return; if (typeof v === "string") App.go(v); else if (v && v.key) Insp.open(v.key); else if (v && v.view) App.go(v.view, v); });
window.cc.on("pomo", (p) => { App.pomo = p; if (typeof DIsland !== "undefined" && DIsland.state !== "open") DIsland.render(); App.views.focus.pomo && App.views.focus.pomo(p); App.views.today.pomo && App.views.today.pomo(p); });
window.cc.on("pomo-done", () => cheer("pomo"));
window.cc.on("badge", (n) => { App.badgeN = n; drawBadge(n); });
window.cc.on("ai-state", (a) => { if (App.S) App.S.ai = a; App.views.ai.aiState && App.views.ai.aiState(a); });
window.cc.on("ai-token", (t) => { if (typeof DIsland !== "undefined" && DIsland.token(t)) return; App.views.ai.token && App.views.ai.token(t); });

// 每 30 秒刷新一次和时间有关的地方（现在上到哪节课、倒计时、课铃线）
let lastDay = M.dayKey(App.now());
setInterval(() => {
  if (!App.S || !App.S.loggedIn) return;
  const v = App.views[App.view];
  const today = M.dayKey(App.now());
  if (today !== lastDay) { lastDay = today; App._itemsOf = null; render(); App.autoWallpaper(); return; }
  if (v && v.tick) v.tick();
  navCounts();
}, 30000);

(async function boot() {
  buildNav();
  App.S = await window.cc.call("state");
  if (typeof App.S.clockOff === "number") M.setClock(App.S.clockOff);
  App.pomo = await window.cc.call("pomo:state");
  render();
  if (App.S.loggedIn) {
    if (POP) { App.go(POP); return; }
    App.go(App.view || "today"); setTimeout(() => App.autoWallpaper(), 8000); setTimeout(() => DIsland.hello(), 1500);
  }
})();
