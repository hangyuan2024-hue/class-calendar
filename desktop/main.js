// 捞捞课程表 电脑版（Windows）· 主进程
// 独立的电脑软件：自己的界面和本机数据，和网站用同一个账号、云端同步；
// 托盘常驻、系统通知提醒、全局快捷键快速记事、桌面小窗、内置离线 AI。
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeTheme, shell, dialog, safeStorage, powerMonitor, nativeImage, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { Api, loadSiteConfig } = require("./core/api");
const { Store } = require("./core/store");
const remind = require("./core/remind");
const assistant = require("./core/assistant");
const ai = require("./core/ai");
const { parse: parseQuick } = require("./core/dateparse");
const M = require("./core/model");

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId("com.laolao.kechengbiao");   // Windows 通知上显示软件名

const R = (...p) => path.join(__dirname, ...p);
const DATA = () => app.getPath("userData");
let win = null, quickWin = null, miniWin = null, tray = null, store = null, quitting = false;

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
    for (const w of [win, miniWin]) if (w && !w.isDestroyed()) w.webContents.send("state", st);
    updateTray();
  }, 60);
}
function fullState() { return { ...store.snapshot(), loggedIn: !!sessionStore.load(), ai: aiPublic(), version: app.getVersion() }; }
function send(ch, payload) { for (const w of [win, miniWin, quickWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload); }

// ---------- 窗口 ----------
const themeColors = () => (nativeTheme.shouldUseDarkColors ? { color: "#00000000", symbolColor: "#e8edf6" } : { color: "#00000000", symbolColor: "#1d2b44" });
function createMain() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1360, width - 80), height: Math.min(880, height - 60), minWidth: 980, minHeight: 640, show: false,
    title: "捞捞课程表", icon: R("build", "icon.png"), backgroundColor: nativeTheme.shouldUseDarkColors ? "#14171f" : "#f4f7fb",
    titleBarStyle: "hidden", titleBarOverlay: { ...themeColors(), height: 44 },
    webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(R("renderer", "index.html"));
  win.once("ready-to-show", () => { if (!process.argv.includes("--hidden")) win.show(); });
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
    width: 300, height: 420, x: pos.x, y: pos.y, frame: false, resizable: true, minWidth: 240, minHeight: 200, alwaysOnTop: true, skipTaskbar: true, transparent: true,
    webPreferences: { preload: R("preload.js"), contextIsolation: true, sandbox: true },
  });
  miniWin.loadFile(R("renderer", "mini.html"));
  miniWin.on("moved", () => { const [x, y] = miniWin.getPosition(); store.data.miniPos = { x, y }; store.save(); });
  miniWin.on("closed", () => { miniWin = null; updateTray(); });
  lockNavigation(miniWin);
  updateTray();
}

// ---------- 托盘 ----------
function trayIcon() { const img = nativeImage.createFromPath(R("build", "icon.png")); return img.isEmpty() ? img : img.resize({ width: 16, height: 16 }); }
function updateTray() {
  if (!tray) return;
  const s = store.snapshot(), now = new Date(), today = M.dayKey(now);
  const todo = M.allItems(s).filter((x) => !x.done && !x.hidden && x.day === today).length;
  const next = M.coursesOn(s.courses, now).find((c) => (M.toMin(c.tStart) ?? 0) >= now.getHours() * 60 + now.getMinutes());
  tray.setToolTip(`捞捞课程表\n今天还有 ${todo} 件事${next ? `\n下节课 ${next.tStart} ${next.name}` : ""}${pomo.running ? `\n专注中，还剩 ${Math.ceil(pomo.left / 60)} 分钟` : ""}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开捞捞课程表", click: () => showMain() },
    { label: "快速记一件事", accelerator: store.data.settings.hotkey, click: openQuick },
    { label: miniWin ? "关掉桌面小窗" : "打开桌面小窗", click: toggleMini },
    { type: "separator" },
    { label: pomo.running ? `专注中（还剩 ${Math.ceil(pomo.left / 60)} 分钟）· 停止` : "开始专注 25 分钟", click: () => (pomo.running ? pomoStop() : pomoStart(store.data.settings.pomoFocus)) },
    { label: "同步", click: () => store.refresh() },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- 通知提醒 ----------
const sentFile = () => path.join(DATA(), "reminded.json");
let sent = new Set();
try { const j = JSON.parse(fs.readFileSync(sentFile(), "utf8")); if (j.day === M.dayKey(new Date())) sent = new Set(j.ids); } catch (e) {}
function notify(title, body, view) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: R("build", "icon.png"), silent: false });
  n.on("click", () => showMain(view));
  n.show();
}
function checkReminders() {
  if (!store || !sessionStore.load()) return;
  const now = new Date();
  for (const r of remind.due(store.snapshot(), now, sent)) {
    sent.add(r.id);
    notify(r.title, r.body, r.kind === "course" ? "week" : r.kind === "evening" ? "today" : { view: "tasks", key: r.key });
  }
  try { fs.writeFileSync(sentFile(), JSON.stringify({ day: M.dayKey(now), ids: [...sent].filter((x) => x.includes(M.dayKey(now))) })); } catch (e) {}
  updateTray();
}

// ---------- 专注计时（番茄钟），在主进程里跑，关掉窗口也不停 ----------
const pomo = { running: false, phase: "focus", left: 0, total: 0, timer: 0, task: "" };
function pomoTick() {
  pomo.left -= 1;
  if (pomo.left <= 0) {
    if (pomo.phase === "focus") {
      store.logPomo(Math.round(pomo.total / 60));
      notify("专注完成 🍅", `${pomo.task ? "「" + pomo.task + "」" : ""}休息 ${store.data.settings.pomoBreak} 分钟吧`, "focus");
      pomo.phase = "break"; pomo.total = pomo.left = store.data.settings.pomoBreak * 60;
    } else { notify("休息结束", "准备好就开始下一轮", "focus"); pomoStop(); return; }
  }
  send("pomo", pomoPublic());
  if (pomo.left % 30 === 0) updateTray();
}
function pomoStart(min, task) { clearInterval(pomo.timer); Object.assign(pomo, { running: true, phase: "focus", total: Math.round(min * 60), left: Math.round(min * 60), task: task || "" }); pomo.timer = setInterval(pomoTick, 1000); send("pomo", pomoPublic()); updateTray(); }
function pomoStop() { clearInterval(pomo.timer); Object.assign(pomo, { running: false, left: 0, total: 0 }); send("pomo", pomoPublic()); updateTray(); }
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

// ---------- 界面能调用的功能 ----------
function handle(ch, fn) { ipcMain.handle(ch, async (e, ...a) => { try { return { ok: true, data: await fn(...a) } } catch (err) { return { ok: false, error: err.message || String(err) }; } }); }
handle("state", () => fullState());
handle("login", async (acct, pw) => { await store.login(acct, pw); return fullState(); });
handle("logout", async () => { await store.logout(); return fullState(); });
handle("refresh", () => store.refresh());
handle("mine:upsert", (item) => store.upsertMine(item));
handle("mine:delete", (id) => store.deleteMine(id));
handle("done", (key, done) => store.setDone(key, done));
handle("mark", (key, patch) => store.setMark(key, patch));
handle("move", (id, day) => store.moveMine(id, day));
handle("class:switch", (cid) => store.switchClass(cid));
handle("wall:post", (t, b, n) => store.wallPost(t, b, n));
handle("settings", (patch) => {
  const s = store.setSettings(patch || {});
  if (patch && "theme" in patch) { nativeTheme.themeSource = s.theme; }
  if (patch && "autoStart" in patch) app.setLoginItemSettings({ openAtLogin: !!s.autoStart, args: ["--hidden"] });
  if (patch && "hotkey" in patch) registerHotkey();
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

// ---------- 快捷键 ----------
function registerHotkey() {
  globalShortcut.unregisterAll();
  const k = store.data.settings.hotkey || "CommandOrControl+Alt+Space";
  try { if (!globalShortcut.register(k, openQuick)) console.warn("快捷键被占用：", k); } catch (e) {}
}

// ---------- 启动 ----------
app.on("second-instance", () => showMain());
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const cfg = loadSiteConfig([R("core", "site-config.js"), R("..", "config.js")]);
  const api = new Api({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_ANON_KEY, domain: cfg.AUTH_EMAIL_DOMAIN, store: sessionStore });
  store = new Store({ api, file: path.join(DATA(), "data.json") }).load();
  nativeTheme.themeSource = store.data.settings.theme || "system";
  nativeTheme.on("updated", () => { if (win && !win.isDestroyed()) win.setTitleBarOverlay({ ...themeColors(), height: 44 }); });
  store.on("change", pushState); store.on("status", pushState);
  store.on("auth-expired", () => { sessionStore.save(null); pushState(); });

  createMain();
  tray = new Tray(trayIcon());
  tray.on("click", () => showMain());
  updateTray();
  registerHotkey();

  if (sessionStore.load()) store.refresh();
  setInterval(() => { if (sessionStore.load()) store.refresh(); }, 5 * 60 * 1000);   // 每 5 分钟同步一次
  setInterval(checkReminders, 30 * 1000); setTimeout(checkReminders, 5000);
  powerMonitor.on("resume", () => { if (sessionStore.load()) store.refresh(); });
  if (ai.modelOk(modelFile())) aiPrepare();                                              // 下载过模型：开机就把 AI 准备好
});
app.on("window-all-closed", (e) => { /* 托盘常驻，不退出 */ });
app.on("before-quit", () => { quitting = true; aiAbort.aborted = true; if (aiServer) { try { aiServer.kill(); } catch (e) {} } globalShortcut.unregisterAll(); try { store && store.save(true); } catch (e) {} });
