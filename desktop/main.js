// 捞捞课程表 电脑版（Windows）· 主进程
// 独立的电脑软件：自己的界面和本机数据，和网站用同一个账号、云端同步；
// 托盘常驻、系统通知提醒、全局快捷键快速记事、桌面小窗、内置离线 AI，
// 以及任务栏按钮和角标、跳转列表、剪贴板识别群通知、课表壁纸、导出 PDF、自动备份、晨间简报、勿扰。
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeTheme, shell, dialog, safeStorage, powerMonitor, nativeImage, screen, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { Api, loadSiteConfig } = require("./core/api");
const { Store, KINDS } = require("./core/store");
const remote = require("./core/remote");
const remind = require("./core/remind");
const assistant = require("./core/assistant");
const ai = require("./core/ai");
const LaoParse = require("./core/parse");
const { parse: parseQuick } = require("./core/dateparse");
const M = require("./core/model");

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId("com.laolao.kechengbiao");   // Windows 通知上显示软件名

const R = (...p) => path.join(__dirname, ...p);
const DATA = () => app.getPath("userData");
const WIN = process.platform === "win32";
let siteCfg = {};
let win = null, quickWin = null, miniWin = null, briefWin = null, tray = null, store = null, quitting = false;

// ---------- 登录信息：用系统加密存在本机 ----------
const sessFile = () => path.join(DATA(), "session.bin");
const sessionStore = {
  load() {
    try {
      const b = fs.readFileSync(sessFile());
      const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString("utf8");
      return JSON.parse(txt);
    } catch (e) { return null; }
  },
  save(s) {
    try {
      if (!s) { fs.rmSync(sessFile(), { force: true }); return; }
      const txt = JSON.stringify(s);
      fs.mkdirSync(DATA(), { recursive: true });
      fs.writeFileSync(sessFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
    } catch (e) { console.error(e); }
  },
};

// ---------- 发给界面 ----------
let pushTimer = 0;
function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const st = fullState();
    for (const w of [win, miniWin, briefWin]) if (w && !w.isDestroyed()) w.webContents.send("state", st);
    updateTray(); updateTaskbar();
  }, 60);
}
function fullState() { return { ...store.snapshot(), loggedIn: !!sessionStore.load(), ai: aiPublic(), version: app.getVersion(), platform: process.platform, siteUrl: siteCfg.SUPABASE_URL || "", anonKey: siteCfg.SUPABASE_ANON_KEY || "", inClass: store ? remind.inClass(store.snapshot(), new Date()) : false }; }
function send(ch, payload) { for (const w of [win, miniWin, quickWin, briefWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload); }

// ---------- 窗口 ----------
const themeColors = () => (nativeTheme.shouldUseDarkColors ? { color: "#00000000", symbolColor: "#e8edf6" } : { color: "#00000000", symbolColor: "#1d2b44" });
function createMain(show) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1360, width - 80), height: Math.min(880, height - 60), minWidth: 980, minHeight: 640, show: false,
    title: "捞捞课程表", icon: R("build", "icon.png"), backgroundColor: nativeTheme.shouldUseDarkColors ? "#14171f" : "#f4f7fb",
    titleBarStyle: "hidden", titleBarOverlay: { ...themeColors(), height: 44 },
    webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(R("renderer", "index.html"));
  win.once("ready-to-show", () => { if (show !== false) win.show(); });
  win.on("show", () => setTimeout(updateThumbar, 300));
  win.on("close", (e) => {
    if (!quitting && store.data.settings.closeToTray) {
      e.preventDefault(); win.hide();
      if (!store.data.trayTipShown) { store.data.trayTipShown = true; store.save(); notify("捞捞课程表还在右下角", "到点会继续提醒你。想彻底退出，右键托盘图标选「退出」。"); }
    }
  });
  lockNavigation(win);
}
function lockNavigation(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  // 插件运行在 sandbox.html 隔离间里（不同源的 iframe），只允许它被嵌进来，不允许它打开别的页面
  w.webContents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !/^file:.*\/sandbox\.html$/.test(e.url) && !/^about:/.test(e.url)) e.preventDefault(); });
}
function showMain(view) {
  if (!win || win.isDestroyed()) createMain();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (view) win.webContents.send("nav", view);
}

// 全局快捷键弹出的「快速记一件事」
function openQuick() {
  if (!quickWin || quickWin.isDestroyed()) {
    quickWin = new BrowserWindow({
      width: 560, height: 168, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true,
      webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true },
    });
    quickWin.loadFile(R("renderer", "quick.html"));
    quickWin.on("blur", () => quickWin && !quickWin.isDestroyed() && quickWin.hide());
    lockNavigation(quickWin);
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  quickWin.setPosition(Math.round(d.x + (d.width - 560) / 2), Math.round(d.y + d.height * 0.22));
  quickWin.show(); quickWin.focus(); quickWin.webContents.send("quick-open");
}

// 桌面小窗：今天的课和待办，一直浮在最上面
function toggleMini() {
  if (miniWin && !miniWin.isDestroyed()) { miniWin.close(); return; }
  const d = screen.getPrimaryDisplay().workArea, pos = store.data.miniPos || { x: d.x + d.width - 320, y: d.y + 24 };
  miniWin = new BrowserWindow({
    width: 300, height: 460, x: pos.x, y: pos.y, frame: false, resizable: true, minWidth: 240, minHeight: 200, alwaysOnTop: true, skipTaskbar: true, transparent: true,
    webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true },
  });
  miniWin.loadFile(R("renderer", "mini.html"));
  miniWin.on("moved", () => { const [x, y] = miniWin.getPosition(); store.data.miniPos = { x, y }; store.save(); });
  miniWin.on("closed", () => { miniWin = null; updateTray(); });
  lockNavigation(miniWin);
  updateTray();
}

// 晨间简报：每天第一次用电脑时，在右下角弹出今天的课、要交的作业、倒数日
function openBrief(force) {
  if (!store || !sessionStore.load()) return;
  const today = M.dayKey(new Date()), h = new Date().getHours();
  if (!force && (!store.data.settings.morningBrief || store.data.flags.briefDay === today || h < 5 || h >= 14)) return;
  store.data.flags.briefDay = today; store.save();
  if (briefWin && !briefWin.isDestroyed()) { briefWin.show(); return; }
  const d = screen.getPrimaryDisplay().workArea;
  briefWin = new BrowserWindow({
    width: 380, height: 520, x: d.x + d.width - 396, y: d.y + d.height - 536, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, transparent: true, show: false,
    webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true },
  });
  briefWin.loadFile(R("renderer", "brief.html"));
  briefWin.once("ready-to-show", () => briefWin.showInactive());
  briefWin.on("closed", () => { briefWin = null; });
  lockNavigation(briefWin);
}

// ---------- 托盘 ----------
function trayIcon() { const img = nativeImage.createFromPath(R("build", "icon.png")); return img.isEmpty() ? img : img.resize({ width: 16, height: 16 }); }
function todoLeft() {
  const s = store.snapshot(), now = new Date(), today = M.dayKey(now);
  return M.allItems(s).filter((x) => !x.done && !x.hidden && x.day && (x.day === today || (x.day < today && M.dayDiff(x.day, now) >= -7))).length;
}
function updateTray() {
  if (!tray) return;
  const s = store.snapshot(), now = new Date();
  const todo = todoLeft();
  const next = M.coursesOn(s.courses, now).find((c) => (M.toMin(c.tStart) ?? 0) >= now.getHours() * 60 + now.getMinutes());
  const cd = ((s.kv || {}).countdown_v1 || []).filter((c) => c && c.date && M.dayDiff(c.date, now) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
  tray.setToolTip(`捞捞课程表\n今天还有 ${todo} 件事${next ? `\n下节课 ${next.tStart} ${next.name}` : ""}${cd ? `\n距离「${cd.title}」${M.dayDiff(cd.date, now)} 天` : ""}${pomo.running ? `\n专注中，还剩 ${Math.ceil(pomo.left / 60)} 分钟` : ""}`.slice(0, 127));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开捞捞课程表", click: () => showMain() },
    { label: "快速记一件事", accelerator: store.data.settings.hotkey, click: openQuick },
    { label: miniWin ? "关掉桌面小窗" : "打开桌面小窗", click: toggleMini },
    { label: "今日简报", click: () => openBrief(true) },
    { type: "separator" },
    { label: pomo.running ? `专注中（还剩 ${Math.ceil(pomo.left / 60)} 分钟）· 停止` : `开始专注 ${store.data.settings.pomoFocus} 分钟`, click: () => (pomo.running ? pomoStop() : pomoStart(store.data.settings.pomoFocus)) },
    { label: "同步", click: () => store.refresh() },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- 任务栏：缩略图下面的按钮、图标角标、专注进度条 ----------
function tbIcon(n) { const img = nativeImage.createFromPath(R("build", `tb-${n}.png`)); return img; }
function updateThumbar() {
  if (!WIN || !win || win.isDestroyed()) return;
  try {
    win.setThumbarButtons([
      { tooltip: "记一件事", icon: tbIcon("add"), click: () => { showMain(); win.webContents.send("nav", { view: "new" }); } },
      pomo.running ? { tooltip: "停止专注", icon: tbIcon("stop"), click: () => pomoStop() } : { tooltip: `开始专注 ${store.data.settings.pomoFocus} 分钟`, icon: tbIcon("focus"), click: () => pomoStart(store.data.settings.pomoFocus) },
      { tooltip: "同步", icon: tbIcon("sync"), click: () => store.refresh() },
    ]);
  } catch (e) {}
}
let badgeN = -1;
function updateTaskbar() {
  if (!win || win.isDestroyed()) return;
  const n = store.data.settings.taskbarBadge && sessionStore.load() ? todoLeft() : 0;
  if (n !== badgeN) { badgeN = n; win.webContents.send("badge", n); }   // 界面画好数字图片再传回来（setOverlayIcon 只认图片）
}
function setProgress() {
  if (!win || win.isDestroyed()) return;
  try {
    if (!pomo.running) win.setProgressBar(-1);
    else win.setProgressBar(Math.max(0.01, 1 - pomo.left / (pomo.total || 1)), { mode: pomo.phase === "break" ? "paused" : "normal" });
  } catch (e) {}
}
// Windows 跳转列表：右键任务栏图标就能直接记事、专注、打开课程表
function setJumpList() {
  if (!WIN) return;
  try {
    app.setUserTasks([
      { program: process.execPath, arguments: (app.isPackaged ? "" : `"${app.getAppPath()}" `) + "--quick", iconPath: process.execPath, iconIndex: 0, title: "快速记一件事", description: "弹出小框，一句话记一件事" },
      { program: process.execPath, arguments: (app.isPackaged ? "" : `"${app.getAppPath()}" `) + "--focus", iconPath: process.execPath, iconIndex: 0, title: "开始专注", description: "开始一个番茄钟" },
      { program: process.execPath, arguments: (app.isPackaged ? "" : `"${app.getAppPath()}" `) + "--view=week", iconPath: process.execPath, iconIndex: 0, title: "课程表", description: "打开这周的课程表" },
      { program: process.execPath, arguments: (app.isPackaged ? "" : `"${app.getAppPath()}" `) + "--view=homework", iconPath: process.execPath, iconIndex: 0, title: "作业", description: "看看这周要交的作业" },
    ]);
  } catch (e) {}
}
function handleArgs(argv, first) {
  const a = argv || [];
  if (a.includes("--quick")) { openQuick(); return true; }
  if (a.includes("--focus")) { pomoStart(store.data.settings.pomoFocus); if (!first) showMain("focus"); return true; }
  const v = a.find((x) => x.startsWith("--view="));
  if (v) { showMain(v.slice(7)); return true; }
  return false;
}

// ---------- 通知提醒 ----------
const sentFile = () => path.join(DATA(), "reminded.json");
let sent = new Set(), held = [];
try { const j = JSON.parse(fs.readFileSync(sentFile(), "utf8")); if (j.day === M.dayKey(new Date())) sent = new Set(j.ids); } catch (e) {}
function notify(title, body, view) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: R("build", "icon.png"), silent: false });
  n.on("click", () => (typeof view === "function" ? view() : showMain(view)));
  n.show();
}
function checkReminders() {
  if (!store || !sessionStore.load()) return;
  const now = new Date(), snap = store.snapshot(), st = snap.settings;
  const quietFocus = st.focusQuiet && pomo.running && pomo.phase === "focus";
  const quietClass = st.classQuiet && remind.inClass(snap, now);
  for (const r of remind.due(snap, now, sent)) {
    sent.add(r.id);
    if ((quietFocus || quietClass) && r.kind !== "course") { held.push(r); continue; }   // 勿扰：先攒着，结束后一起说
    notify(r.title, r.body, r.kind === "course" ? "week" : r.kind === "evening" ? "today" : r.kind === "countdown" ? "countdown" : { view: "tasks", key: r.key });
  }
  if (held.length && !quietFocus && !quietClass) releaseHeld();
  try { fs.writeFileSync(sentFile(), JSON.stringify({ day: M.dayKey(now), ids: [...sent].filter((x) => x.includes(M.dayKey(now))) })); } catch (e) {}
  weeklyCheck(now); backupCheck(now);
  updateTray(); updateTaskbar();
}
function releaseHeld() {
  const list = held; held = [];
  if (!list.length) return;
  if (list.length === 1) return notify(list[0].title, list[0].body, list[0].kind === "countdown" ? "countdown" : { view: "tasks", key: list[0].key });
  notify(`刚才有 ${list.length} 条提醒`, list.map((r) => r.title).slice(0, 4).join("\n"), "today");
}

// 每周学习报告：周日晚上 7 点以后提醒一次
function weeklyCheck(now) {
  if (!store.data.settings.weeklyReport || now.getDay() !== 0 || now.getHours() < 19) return;
  const k = M.dayKey(now);
  if (store.data.flags.reportDay === k) return;
  store.data.flags.reportDay = k; store.save();
  notify("本周学习报告出来了 📊", "看看这周完成了多少作业、专注了多久", "report");
}

// ---------- 自动备份：每天一份，放在「文档 / 捞捞课程表备份」，留最近 14 份 ----------
const backupDir = () => path.join(app.getPath("documents"), "捞捞课程表备份");
function backupData() {
  const d = store.data;
  return { app: "laolao-kechengbiao", version: 2, at: new Date().toISOString(), account: d.me ? d.me.account : "", ns: d.ns, attach: d.attach, courses: d.courses };
}
function writeBackup(manual) {
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const k = M.dayKey(new Date()), f = path.join(dir, `备份-${k}${manual ? "-" + new Date().toTimeString().slice(0, 8).replace(/:/g, "") : ""}.json`);
  fs.writeFileSync(f, JSON.stringify(backupData(), null, 1));
  const all = fs.readdirSync(dir).filter((x) => /^备份-\d{4}-\d{2}-\d{2}.*\.json$/.test(x)).sort();
  for (const x of all.slice(0, Math.max(0, all.length - 14))) { try { fs.rmSync(path.join(dir, x)); } catch (e) {} }
  store.data.flags.backupDay = k; store.save();
  return f;
}
function backupCheck(now) {
  if (!store.data.settings.autoBackup || !store.data.uid || store.data.flags.backupDay === M.dayKey(now)) return;
  try { writeBackup(false); } catch (e) { console.error("自动备份失败", e); }
}
function listBackups() {
  try {
    const dir = backupDir();
    return fs.readdirSync(dir).filter((x) => /\.json$/.test(x)).sort().reverse().slice(0, 30)
      .map((x) => { const st = fs.statSync(path.join(dir, x)); return { name: x, size: st.size, at: st.mtimeMs }; });
  } catch (e) { return []; }
}
// 从备份恢复：一条条写回去（算作新的修改，会同步到云端；不会删掉备份之后新增的东西）
function restoreBackup(j) {
  if (!j || j.app !== "laolao-kechengbiao" || typeof j.ns !== "object") throw new Error("这不是捞捞课程表的备份文件");
  let n = 0;
  for (const [ns, kind] of Object.entries(KINDS)) {
    const v = j.ns[ns]; if (v == null) continue;
    if (kind === "list") for (const x of Array.isArray(v) ? v : []) { if (x && x.id != null) { store.kvSet(ns, String(x.id), x, true); n++; } }
    else if (kind === "one") { store.kvSet(ns, "_", v, true); n++; }
    else if (kind === "map2") { for (const a in v) for (const b in v[a] || {}) { store.kvSet(ns, [a, b], v[a][b], true); n++; } }
    else for (const k in v) { store.kvSet(ns, k, v[k], true); n++; }
  }
  if (j.attach && typeof j.attach === "object") for (const k in j.attach) if (Array.isArray(j.attach[k])) store.data.attach[k] = j.attach[k];
  store.changed("restore");
  return n;
}

// ---------- 专注计时（番茄钟），在主进程里跑，关掉窗口也不停 ----------
const pomo = { running: false, phase: "focus", left: 0, total: 0, timer: 0, task: "", startedAt: 0 };
function pomoTick() {
  pomo.left -= 1;
  if (pomo.left <= 0) {
    if (pomo.phase === "focus") {
      store.logPomo(Math.round(pomo.total / 60));
      notify("专注完成 🍅", `${pomo.task ? "「" + pomo.task + "」" : ""}休息 ${store.data.settings.pomoBreak} 分钟吧`, "focus");
      pomo.phase = "break"; pomo.total = pomo.left = store.data.settings.pomoBreak * 60;
      releaseHeld(); send("pomo-done", { task: pomo.task });
    } else { notify("休息结束", "准备好就开始下一轮", "focus"); pomoStop(); return; }
  }
  send("pomo", pomoPublic()); setProgress();
  if (pomo.left % 30 === 0) updateTray();
}
function pomoStart(min, task) {
  clearInterval(pomo.timer);
  Object.assign(pomo, { running: true, phase: "focus", total: Math.round(min * 60), left: Math.round(min * 60), task: task || "", startedAt: Date.now() });
  pomo.timer = setInterval(pomoTick, 1000); send("pomo", pomoPublic()); updateTray(); updateThumbar(); setProgress();
}
function pomoStop() {
  clearInterval(pomo.timer);
  const wasFocus = pomo.running && pomo.phase === "focus";
  Object.assign(pomo, { running: false, left: 0, total: 0 });
  send("pomo", pomoPublic()); updateTray(); updateThumbar(); setProgress();
  if (wasFocus) releaseHeld();
}
const pomoPublic = () => ({ running: pomo.running, phase: pomo.phase, left: pomo.left, total: pomo.total, task: pomo.task });

// ---------- 本地 AI ----------
const aiState = { status: "idle", got: 0, total: 0, error: "", ready: false };
const aiAbort = { aborted: false };
let aiServer = null;
const aiPublic = () => ({ ...aiState, model: ai.MODEL.name });
const modelFile = () => path.join(DATA(), "models", ai.MODEL.file);
const serverExe = () => path.join(app.isPackaged ? path.join(process.resourcesPath, "llama") : R("llama"), process.platform === "win32" ? "llama-server.exe" : "llama-server");
function aiPush() { send("ai-state", aiPublic()); }
async function aiPrepare() {
  if (["downloading", "starting"].includes(aiState.status) || aiState.ready) return;
  aiAbort.aborted = false;
  if (!fs.existsSync(serverExe())) { Object.assign(aiState, { status: "error", error: "安装包里缺少 AI 程序，请重新安装电脑版" }); return aiPush(); }
  try {
    if (!ai.modelOk(modelFile())) {
      Object.assign(aiState, { status: "downloading", error: "" }); aiPush();
      await ai.downloadModel(path.dirname(modelFile()), (got, total) => { aiState.got = got; aiState.total = total; aiPush(); }, aiAbort);
    }
    aiState.status = "starting"; aiPush();
    aiServer = await ai.startServer(serverExe(), modelFile());
    aiServer.on("exit", () => { aiServer = null; if (aiState.ready) Object.assign(aiState, { ready: false, status: "error", error: "AI 程序意外退出了，点「重试」" }); aiPush(); });
    Object.assign(aiState, { ready: true, status: "ready" }); aiPush();
  } catch (e) { Object.assign(aiState, { status: aiAbort.aborted ? "idle" : "error", error: aiAbort.aborted ? "" : e.message }); aiPush(); }
}
const chats = new Map();

// ---------- 剪贴板：复制了像作业通知的群消息，提示一键整理 ----------
let clipLast = "", clipAsked = new Set();
function clipCheck() {
  if (!store || !store.data.settings.clipWatch || !sessionStore.load()) return;
  let t = "";
  try { t = clipboard.readText(); } catch (e) { return; }
  if (!t || t === clipLast) return;
  clipLast = t;
  if (t.length < 12 || t.length > 6000 || win && win.isFocused()) return;   // 在软件里面复制的不算
  const sig = t.replace(/\s+/g, "").slice(0, 200);
  if (clipAsked.has(sig)) return;
  let r = null;
  try { r = LaoParse.parse(t, M.dayKey(new Date())); } catch (e) { return; }
  const items = (r && r.items) || [];
  if (!items.length || !items.some((x) => x.event_time || /作业|截止|提交|考试|开会|班会|通知/.test(x.subject + x.summary))) return;
  clipAsked.add(sig);
  const first = items[0];
  notify(`复制的消息里有 ${items.length} 件事`, `${first.msg_type}：${first.subject || first.summary}${first.event_time ? "（" + first.event_time + "）" : ""}\n点这里整理进日历`, () => showMain({ view: "ingest", text: t }));
}

// ---------- 导出 PDF / 图片、设置壁纸：在看不见的窗口里排好版再打印或截图 ----------
async function renderHidden(html, { width = 1123, height = 794, offscreen = false } = {}) {
  const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { javascript: false, offscreen, sandbox: true } });
  // 写成临时文件再打开：data: 地址太长（课表里有很多内容）会打不开
  const f = path.join(app.getPath("temp"), `laolao-render-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(f, html, "utf8");
  w.on("closed", () => fs.rm(f, () => {}));
  await Promise.race([w.loadFile(f), new Promise((r) => setTimeout(r, 8000))]);
  await new Promise((r) => setTimeout(r, 400));
  return w;
}
async function exportPdf(html, name, landscape) {
  const r = await dialog.showSaveDialog(win, { title: "导出 PDF", defaultPath: path.join(app.getPath("desktop"), (name || "捞捞课程表") + ".pdf"), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled || !r.filePath) return false;
  const w = await renderHidden(html);
  try {
    const buf = await w.webContents.printToPDF({ landscape: !!landscape, printBackground: true, pageSize: "A4", margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    fs.writeFileSync(r.filePath, buf);
  } finally { w.destroy(); }
  shell.openPath(r.filePath);
  return r.filePath;
}
async function printHtml(html) {
  const w = await renderHidden(html);
  return new Promise((res) => w.webContents.print({ printBackground: true }, (ok, why) => { w.destroy(); res(ok ? true : why || false); }));
}
async function snapImage(html, width, height) {
  const w = await renderHidden(html, { width, height, offscreen: true });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const img = await w.webContents.capturePage();
    return img.toPNG();
  } finally { w.destroy(); }
}
async function exportImage(html, name, width, height) {
  const r = await dialog.showSaveDialog(win, { title: "保存图片", defaultPath: path.join(app.getPath("pictures"), (name || "捞捞课程表") + ".png"), filters: [{ name: "图片", extensions: ["png"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, await snapImage(html, width || 1200, height || 900));
  shell.showItemInFolder(r.filePath);
  return r.filePath;
}
// 课程表壁纸：生成一张和屏幕一样大的图，设成桌面背景（原来的壁纸记下来，可以一键换回去）
function runPs(script, args) {
  return new Promise((resolve, reject) => {
    const f = path.join(os.tmpdir(), `laolao-${Date.now()}.ps1`);
    fs.writeFileSync(f, "﻿" + script, "utf8");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f, ...(args || [])], { windowsHide: true, timeout: 20000 }, (err, out, errOut) => {
      try { fs.rmSync(f, { force: true }); } catch (e) {}
      if (err) reject(new Error((errOut || err.message || "").trim().slice(0, 200) || "设置失败")); else resolve(String(out).trim());
    });
  });
}
const PS_GET_WP = `(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallPaper).WallPaper`;
const PS_SET_WP = `param([string]$p)
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class LaolaoWp { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int SystemParametersInfo(int a, int b, string c, int d); }
"@
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value 10
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value 0
[LaolaoWp]::SystemParametersInfo(20, 0, $p, 3) | Out-Null
"ok"`;
async function setWallpaper(html) {
  if (!WIN) throw new Error("设置壁纸只支持 Windows");
  const disp = screen.getPrimaryDisplay(), sf = disp.scaleFactor || 1;
  const w = Math.round(disp.size.width * sf), h = Math.round(disp.size.height * sf);
  const png = await snapImage(html.replace(/__W__/g, w).replace(/__H__/g, h), w, h);
  const f = path.join(DATA(), `wallpaper-${Date.now()}.png`);
  for (const x of fs.readdirSync(DATA()).filter((n) => /^wallpaper-\d+\.png$/.test(n))) { try { fs.rmSync(path.join(DATA(), x)); } catch (e) {} }
  fs.writeFileSync(f, png);
  if (!store.data.flags.oldWallpaper) {
    try { const old = await runPs(PS_GET_WP); if (old && !/wallpaper-\d+\.png$/.test(old)) { store.data.flags.oldWallpaper = old; store.save(); } } catch (e) {}
  }
  await runPs(PS_SET_WP, [f]);
  store.data.flags.wallpaperOn = true; store.data.flags.wallpaperAt = Date.now(); store.save();
  return f;
}
async function restoreWallpaper() {
  if (!WIN) return false;
  const old = store.data.flags.oldWallpaper || "";
  await runPs(PS_SET_WP, [old]);
  store.data.flags.wallpaperOn = false; store.save();
  return true;
}

// ---------- 界面能调用的功能 ----------
function handle(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) } } catch (err) { return { ok: false, error: err.message || String(err), status: err.status || 0 }; } }); }
handle("state", () => fullState());
handle("login", async (acct, pw) => { await store.login(acct, pw); setTimeout(() => openBrief(false), 1500); return fullState(); });
handle("logout", async () => { await store.logout(); return fullState(); });
handle("refresh", () => store.refresh());
handle("class:reload", () => store.reloadClass());
handle("mine:upsert", (item) => store.upsertMine(item));
handle("mine:delete", (id) => store.deleteMine(id));
handle("done", (key, done) => store.setDone(key, done));
handle("mark", (key, patch) => store.setMark(key, patch));
handle("move", (id, day) => store.moveMine(id, day));
handle("kv:set", (ns, k, v) => store.kvSet(ns, k, v));
handle("kv:batch", (ops) => store.kvBatch(ops));
handle("habit", (id, day) => store.toggleHabit(id, day));
handle("growth", (kind, ref, undo) => store.growth(kind, ref, undo));
handle("class:switch", (cid) => store.switchClass(cid));
handle("wall:post", (t, b, n, gid) => store.wallPost(t, b, n, gid));
handle("courses:save", (courses, meta) => store.saveCourses(courses, meta));
// 服务器接口（白名单）
handle("api:rpc", async (fn, args) => { remote.checkRpc(fn); return store.api.rpc(fn, args || {}); });
handle("api:get", async (p) => { remote.checkGet(p); return store.api.rest(p); });
handle("api:del", async (p) => { remote.checkDel(p); return store.api.rest(p, { method: "DELETE" }); });
handle("settings", (patch) => {
  const s = store.setSettings(patch || {});
  if (patch && "theme" in patch) { nativeTheme.themeSource = s.theme === "meta" ? "dark" : s.theme; }
  if (patch && "autoStart" in patch) app.setLoginItemSettings({ openAtLogin: !!s.autoStart, args: ["--hidden"] });
  if (patch && "hotkey" in patch) registerHotkey();
  if (patch && "taskbarBadge" in patch) { badgeN = -1; updateTaskbar(); }
  return s;
});
handle("quick:parse", (text) => parseQuick(text, new Date()));
handle("quick:add", (text) => {
  const p = parseQuick(text, new Date()); if (!p.subject) throw new Error("写一下要做什么");
  const rec = store.upsertMine({ subject: p.subject, event_time: p.date ? p.date + (p.time ? " " + p.time : "") : "", location: p.location });
  return rec;
});
handle("quick:hide", () => quickWin && !quickWin.isDestroyed() && quickWin.hide());
handle("open:main", (view) => showMain(view));
handle("open:external", (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
handle("mini:toggle", () => toggleMini());
handle("brief:open", () => openBrief(true));
handle("brief:close", () => briefWin && !briefWin.isDestroyed() && briefWin.close());
handle("pomo:start", (min, task) => pomoStart(min || store.data.settings.pomoFocus, task));
handle("pomo:stop", () => pomoStop());
handle("pomo:state", () => pomoPublic());
handle("ai:prepare", () => { aiPrepare(); return aiPublic(); });
handle("ai:cancel", () => { aiAbort.aborted = true; });
handle("ai:chat", async (id, history) => {
  if (!aiState.ready) throw new Error("AI 助手还没准备好");
  const msgs = [{ role: "system", content: assistant.systemPrompt(store.snapshot(), new Date()) }, ...(history || []).slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "").slice(0, 4000) }))];
  const job = ai.chat(msgs, (full) => win && !win.isDestroyed() && win.webContents.send("ai-token", { id, text: full }));
  chats.set(id, job);
  try { return await job; } finally { chats.delete(id); }
});
handle("ai:stop", (id) => { const j = chats.get(id); if (j) j.abort(); });
// 用内置 AI 整理群消息（不联网、不花 token）
handle("ai:extract", async (text, pub) => {
  if (!aiState.ready) throw new Error("AI 助手还没准备好，先到「AI 助手」里下载并启动");
  const job = ai.chat([{ role: "system", content: LaoParse.extractPrompt(pub) }, { role: "user", content: String(text || "").slice(0, 6000) }], null, { temperature: 0.1, maxTokens: 1500 });
  return await job;
});
handle("export:ics", async () => {
  const s = store.snapshot();
  const items = M.allItems(s).filter((x) => x.day && !x.hidden);
  const esc = (t) => String(t || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//laolao//kechengbiao desktop//CN", "X-WR-CALNAME:捞捞课程表"];
  for (const x of items) {
    const d = x.day.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${x.key}@laolaokechengbiao`, `SUMMARY:${esc((x.type === "作业" ? "【作业】" : "") + x.title)}`);
    if (x.time) { const t = x.time.replace(":", "") + "00"; lines.push(`DTSTART:${d}T${t}`, `DTEND:${d}T${t}`); } else lines.push(`DTSTART;VALUE=DATE:${d}`);
    if (x.location) lines.push(`LOCATION:${esc(x.location)}`);
    if (x.summary || x.note) lines.push(`DESCRIPTION:${esc([x.summary, x.note].filter(Boolean).join("\n"))}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const r = await dialog.showSaveDialog(win, { title: "导出到日历", defaultPath: path.join(app.getPath("desktop"), `捞捞课程表-${M.dayKey(new Date())}.ics`), filters: [{ name: "日历文件", extensions: ["ics"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, lines.join("\r\n"));
  shell.showItemInFolder(r.filePath);
  return items.length;
});
// 导出、打印、壁纸
handle("export:pdf", (html, name, landscape) => exportPdf(String(html), name, landscape));
handle("export:image", (html, name, w, h) => exportImage(String(html), name, w, h));
handle("print", (html) => printHtml(String(html)));
handle("wallpaper:set", (html) => setWallpaper(String(html)));
handle("wallpaper:restore", () => restoreWallpaper());
handle("wallpaper:state", () => ({ on: !!store.data.flags.wallpaperOn, at: store.data.flags.wallpaperAt || 0, windows: WIN }));
// 作业附件
handle("attach:pick", async (key) => {
  const r = await dialog.showOpenDialog(win, { title: "选择附件（作业要求、参考资料……）", properties: ["openFile", "multiSelections"] });
  if (r.canceled) return store.data.attach[key] || [];
  const cur = store.data.attach[key] || [];
  store.setAttach(key, cur.concat(r.filePaths.filter((p) => !cur.includes(p))));
  return store.data.attach[key] || [];
});
handle("attach:add", (key, paths) => {
  const cur = store.data.attach[key] || [];
  const add = (paths || []).filter((p) => typeof p === "string" && path.isAbsolute(p) && fs.existsSync(p) && !cur.includes(p));
  store.setAttach(key, cur.concat(add));
  return store.data.attach[key] || [];
});
handle("attach:remove", (key, p) => { store.setAttach(key, (store.data.attach[key] || []).filter((x) => x !== p)); return store.data.attach[key] || []; });
handle("attach:open", async (key, p) => { if (!(store.data.attach[key] || []).includes(p)) throw new Error("没有这个附件"); if (!fs.existsSync(p)) throw new Error("文件找不到了，可能被移动或删除了"); const err = await shell.openPath(p); if (err) throw new Error(err); return true; });
handle("attach:show", (key, p) => { if ((store.data.attach[key] || []).includes(p)) shell.showItemInFolder(p); return true; });
handle("attach:exists", (paths) => (paths || []).map((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }));
// 备份
handle("backup:now", () => writeBackup(true));
handle("backup:list", () => ({ dir: backupDir(), list: listBackups() }));
handle("backup:open", () => { fs.mkdirSync(backupDir(), { recursive: true }); shell.openPath(backupDir()); return true; });
handle("backup:restore", async (name) => {
  let f = name ? path.join(backupDir(), path.basename(name)) : null;
  if (!f) {
    const r = await dialog.showOpenDialog(win, { title: "选择备份文件", defaultPath: backupDir(), filters: [{ name: "备份", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return false;
    f = r.filePaths[0];
  }
  return restoreBackup(JSON.parse(fs.readFileSync(f, "utf8")));
});
handle("badge", (dataUrl, n) => {
  if (!win || win.isDestroyed() || !WIN) return;
  try { win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, n ? `今天还有 ${n} 件事` : ""); } catch (e) {}
});
handle("clip:read", () => { try { return clipboard.readText().slice(0, 20000); } catch (e) { return ""; } });
handle("clip:image", () => {
  try { const img = clipboard.readImage(); if (img.isEmpty()) return null; return img.toJPEG(90).toString("base64"); } catch (e) { return null; }
});

// ---------- 快捷键 ----------
function registerHotkey() {
  globalShortcut.unregisterAll();
  const k = store.data.settings.hotkey || "CommandOrControl+Alt+Space";
  try { if (!globalShortcut.register(k, openQuick)) console.warn("快捷键被占用：", k); } catch (e) {}
}

// ---------- 启动 ----------
app.on("second-instance", (e, argv) => { if (!handleArgs(argv)) showMain(); });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const cfg = siteCfg = loadSiteConfig([R("core", "site-config.js"), R("..", "config.js")]);
  const api = new Api({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_ANON_KEY, domain: cfg.AUTH_EMAIL_DOMAIN, store: sessionStore });
  store = new Store({ api, file: path.join(DATA(), "data.json") }).load();
  nativeTheme.themeSource = store.data.settings.theme === "meta" ? "dark" : store.data.settings.theme || "system";
  nativeTheme.on("updated", () => { if (win && !win.isDestroyed()) win.setTitleBarOverlay({ ...themeColors(), height: 44 }); });
  store.on("change", pushState); store.on("status", pushState);
  store.on("auth-expired", () => { sessionStore.save(null); pushState(); });

  const quiet = process.argv.includes("--hidden") || process.argv.includes("--quick");
  createMain(!quiet);
  tray = new Tray(trayIcon());
  tray.on("click", () => showMain());
  updateTray();
  registerHotkey();
  setJumpList();
  handleArgs(process.argv, true);

  if (sessionStore.load()) store.refresh().then(() => setTimeout(() => openBrief(false), 2500));
  setInterval(() => { if (sessionStore.load()) store.refresh(); }, 5 * 60 * 1000);   // 每 5 分钟同步一次
  setInterval(checkReminders, 30 * 1000); setTimeout(checkReminders, 5000);
  setInterval(clipCheck, 1500);
  setInterval(() => { if (sessionStore.load() && store.data.cid) store.api.rpc("mail_tick", {}).catch(() => {}); }, (10 + Math.random() * 5) * 60 * 1000);   // 帮服务器把该发的邮件提醒发出去
  powerMonitor.on("resume", () => { if (sessionStore.load()) store.refresh(); openBrief(false); });
  powerMonitor.on("unlock-screen", () => openBrief(false));
  try { clipLast = clipboard.readText(); } catch (e) {}                                 // 打开软件之前就在剪贴板里的不算
  if (ai.modelOk(modelFile())) aiPrepare();                                              // 下载过模型：开机就把 AI 准备好
});
app.on("window-all-closed", (e) => { /* 托盘常驻，不退出 */ });
app.on("before-quit", () => { quitting = true; aiAbort.aborted = true; if (aiServer) { try { aiServer.kill(); } catch (e) {} } globalShortcut.unregisterAll(); try { store && store.save(true); } catch (e) {} });
