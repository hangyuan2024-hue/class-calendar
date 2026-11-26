// 捞捞算力 · Electron 主进程：开窗口、托盘（关掉窗口后台照样算）、开机自启、空闲时间、控制中心窗口
"use strict";
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, powerMonitor, powerSaveBlocker, nativeImage, session, dialog, Notification, desktopCapturer, screen } = require("electron");
const path = require("path");
const { createService } = require("./service");

const EDITION = require("./edition");   // 通用版和内部版装在同一台电脑上也互不干扰：各用各的数据文件夹
app.setPath("userData", path.join(app.getPath("appData"), EDITION.open ? "LaolaoGridOpen" : "LaolaoGrid"));
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId(EDITION.open ? "cn.laolao.grid.open" : "cn.laolao.grid");   // Windows 通知要这个
let win = null, tray = null, quitting = false, bar = null;
const hidden = process.argv.includes("--hidden");
// 上次下好还没装的新版：一开机就装（大约 20 秒，装完自己打开），免得一直用旧版
const Updater = require("./updater");
if (app.isPackaged) {
  const pend = Updater.create({ dir: () => require("./service").dataBaseOf(app.getPath("userData")), version: app.getVersion() }).pending();
  if (pend) {
    const { spawn } = require("child_process");
    spawn(pend.file, ["/S", "--force-run", ...(hidden ? ["--hidden"] : [])], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    app.exit(0);
  }
}
const svc = createService({
  user: app.getPath("userData"),
  autoDrive: true,
  version: app.getVersion(),
  // 本地大模型的程序（安装包里带的 llama.cpp Vulkan 版）
  llamaExe: app.isPackaged ? path.join(process.resourcesPath, "llama", "llama-server.exe") : process.env.LG_LLAMA || null,
  send: (ch, d) => {
    if (win && !win.isDestroyed()) win.webContents.send(ch, d);
    if (ch === "agent" && d && d.k === "state" && tray) { const N = { busy: "在算", idle: "在等任务", waiting: "等着", paused: "停了", offline: "连不上调度中心", starting: "启动中" }; try { tray.setToolTip(`捞捞算力 · ${N[d.v.state] || d.v.state}${d.v.why ? "：" + String(d.v.why).slice(0, 60) : ""}`); } catch (e) {} }
  },
  idleSecs: async () => powerMonitor.getSystemIdleTime(),
  setAutostart: (v) => app.setLoginItemSettings({ openAtLogin: v, args: ["--hidden"] }),
  hidden,
  powerSaveBlocker,
  onBattery: async () => { try { return powerMonitor.isOnBatteryPower(); } catch (e) { return false; } },
  notify: (title, body) => { try { if (Notification.isSupported()) { const n = new Notification({ title, body, icon: path.join(__dirname, "renderer", "icon.png"), silent: false }); n.on("click", show); n.show(); } } catch (e) {} },
  // 重启：先把正在跑的配方停掉（最多等 15 秒）再重开，不然它在后台成了孤儿，一直占着显卡
  restart: () => { quitting = true; const args = process.argv.slice(1).filter((a) => a !== "--hidden").concat(win && win.isVisible() ? [] : ["--hidden"]); shutdownOnce().finally(() => { app.relaunch({ args }); app.exit(0); }); },
  reveal: (f) => shell.showItemInFolder(f),
  openPath: (f) => shell.openPath(f),
  // 「看屏幕」：发这句话的时候截一张主屏幕（缩到 1600 宽），跟着这句话给模型看；只在打开了开关时截
  captureScreen: async () => {
    const { desktopCapturer, screen } = require("electron");
    const d = screen.getPrimaryDisplay(), k = Math.min(1, 1600 / (d.size.width * d.scaleFactor));
    const srcs = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor * k), height: Math.round(d.size.height * d.scaleFactor * k) } });
    const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error("截不到屏幕（系统没给权限？）");
    return "data:image/jpeg;base64," + src.thumbnail.toJPEG(72).toString("base64");
  },
  // 新闻、视频：「打开原文」用系统浏览器；「播放」开一个小窗口直接放（只放国内网站的页面）
  openExternal: (u) => shell.openExternal(u),
  openVideo: (u, title) => {
    const w = new BrowserWindow({ width: 1280, height: 780, title: title || "播放", backgroundColor: "#000000", autoHideMenuBar: true, icon: require("path").join(__dirname, "renderer", "icon.png"),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" } });
    w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
    w.loadURL(u);
  },
  pickFolder: async () => { const r = await dialog.showOpenDialog(win, { title: "选一个文件夹给捞小智（文件留在原地，用到再读）", properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  // 捞小智做的文件「另存为」：选个地方拷一份过去
  saveCopy: async (f) => { const r = await dialog.showSaveDialog(win, { title: "另存为", defaultPath: require("path").basename(f) }); if (r.canceled || !r.filePath) return null; require("fs").copyFileSync(f, r.filePath); return r.filePath; },
  // 成品展示的全屏模式
  fullscreen: (v) => { if (win && !win.isDestroyed()) win.setFullScreen(!!v); },
  isFullscreen: () => !!(win && !win.isDestroyed() && win.isFullScreen()),
  windowHidden: () => !win || win.isDestroyed() || !win.isVisible() || win.isMinimized(),
  // 静默安装新版（/S），装完自己打开（--force-run）；只有装好的软件才自动更新
  install: app.isPackaged ? async (file) => {
    const { spawn } = require("child_process");
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 300);
  } : null,
  pickDir: async (title) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  pickFile: async (exts, title, kind) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openFile"], filters: [{ name: kind || "文件", extensions: exts }] }); return r.canceled ? null : r.filePaths[0]; },
  openAdmin: (u) => {
    const w = new BrowserWindow({ width: 1400, height: 900, title: "捞捞算力 · 控制中心", backgroundColor: "#060a16", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
    // 控制中心里点「远程协助」会开一个新窗口看画面：只放行这一种
    const origin = new URL(u).origin;
    w.webContents.setWindowOpenHandler(({ url }) => (url === "about:blank" || url.startsWith(origin + "/admin/assist.html") ? { action: "allow", overrideBrowserWindowOptions: { width: 1280, height: 820, backgroundColor: "#060a16", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } } } : { action: "deny" }));
    w.loadURL(u);
  },
  // ---- 远程协助（被协助的这一边）：弹窗问、截主屏幕、屏幕上方的红条 ----
  assistAsk: async ({ by, mode, where, timeoutMs }) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs || 85000);
    try { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); win.flashFrame(true); } catch (e) {}
    const buttons = mode === "view" ? ["允许他看我的屏幕", "拒绝"] : ["允许查看和操控", "只允许查看", "拒绝"];
    try {
      const r = await dialog.showMessageBox(win, { type: "question", title: "远程协助请求", message: `${by} 想远程协助你的电脑`,
        detail: `${where ? where + "\n\n" : ""}${mode === "view" ? "对方只能看你的屏幕，不能动你的电脑。" : "「允许查看和操控」：对方能看你的屏幕、动你的鼠标和键盘。\n「只允许查看」：对方只能看。"}\n\n同意后屏幕上方会一直显示红条，你随时可以点「结束协助」。85 秒不回应自动拒绝。`,
        buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true, signal: ac.signal });
      const i = r.response;
      return mode === "view" ? (i === 0 ? "view" : null) : i === 0 ? "control" : i === 1 ? "view" : null;
    } finally { clearTimeout(t); try { win.flashFrame(false); } catch (e) {} }
  },
  capture: async (maxW) => {
    const d = screen.getPrimaryDisplay();
    const W = Math.min(maxW || 1600, Math.round(d.size.width * d.scaleFactor)), H = Math.round((W * d.size.height) / d.size.width);
    const srcs = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: W, height: H } });
    const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[0];
    if (!src) throw new Error("找不到屏幕");
    const sz = src.thumbnail.getSize();
    return { jpeg: src.thumbnail.toJPEG(60), w: sz.width, h: sz.height };
  },
  assistLive: ({ by, mode }) => {
    try { if (bar && !bar.isDestroyed()) bar.destroy(); } catch (e) {}
    const wa = screen.getPrimaryDisplay().workArea;
    bar = new BrowserWindow({ width: 600, height: 46, x: Math.round(wa.x + wa.width / 2 - 300), y: wa.y + 4, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#7f1d1d",
      webPreferences: { preload: path.join(__dirname, "bar-preload.js"), contextIsolation: true, sandbox: true } });
    bar.setAlwaysOnTop(true, "screen-saver");
    bar.on("close", (e) => { if (!quitting && svc.assistDev.current()) e.preventDefault(); });   // 红条关不掉：要结束点「结束协助」
    bar.loadFile(path.join(__dirname, "renderer", "assist-bar.html"), { query: { by: String(by || ""), mode: String(mode || "") } });
  },
  assistEnd: () => { try { if (bar && !bar.isDestroyed()) bar.destroy(); } catch (e) {} bar = null; },
  // 同局域网发起协助：本机开一个窗口看对方画面（页面由本机的捞捞算力提供，只给本机）
  openViewer: (url, title) => {
    const w = new BrowserWindow({ width: 1280, height: 820, title: title || "远程协助", backgroundColor: "#060a16", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.loadURL(url);
  },
});
ipcMain.on("assist-end", (ev) => { if (bar && !bar.isDestroyed() && ev.sender === bar.webContents) svc.H.assistEnd(); });
ipcMain.handle("call", async (ev, method, args) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method);
  return svc.H[method](...(Array.isArray(args) ? args : []));
});
// 自己画的标题栏（最小化 / 最大化 / 关闭）：窗口没有系统边框，界面上的三个按钮走这里
function winCtl(ev, a) {
  const w = BrowserWindow.fromWebContents(ev.sender); if (!w || w.isDestroyed()) return null;
  if (a === "min") w.minimize();
  else if (a === "max") { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
  else if (a === "close") w.close();
  return { frameless: !!w.__frameless, max: w.isMaximized(), full: w.isFullScreen() };
}
ipcMain.handle("win", (ev, a) => winCtl(ev, a));
const winEvents = (w) => { const s = () => { if (!w.isDestroyed()) w.webContents.send("win", { max: w.isMaximized(), full: w.isFullScreen() }); }; for (const e of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) w.on(e, s); };
// 托盘里改了开关，界面也跟着变
const syncUi = (m) => { if (win && !win.isDestroyed()) win.webContents.send("agent", { k: "manual", v: m }); };
function show() { if (!win) createWindow(); else { win.show(); win.focus(); } }
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1380, height: 880, minWidth: 1100, minHeight: 700, title: EDITION.open ? "捞捞算力 通用版" : "捞小智", backgroundColor: EDITION.open ? "#050914" : "#ffffff", show: false,
    // 捞小智版：不用系统的标题栏，界面顶上自己画（黑白、和界面一体）；通用版照旧
    ...(EDITION.open ? {} : { frame: false, icon: path.join(__dirname, "renderer", "icon.png") }),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.__frameless = !EDITION.open; winEvents(win);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  if (!hidden) win.once("ready-to-show", () => win.show());
  // 关窗口 = 藏到托盘，后台接着算；托盘里点「退出」才真的退出
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // 界面崩了 / 卡死：自己重新载入（后台的算力不受影响）
  win.webContents.on("render-process-gone", (e, d) => { svc.logs.add("界面崩了（" + d.reason + "）：重新载入", "error", "看门狗"); setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 1000); });
  win.on("unresponsive", () => { svc.logs.add("界面没响应：30 秒后还不好就重新载入", "warn", "看门狗"); setTimeout(() => { if (win && !win.isDestroyed()) { try { win.webContents.forcefullyCrashRenderer(); } catch (e) {} win.reload(); } }, 30000); });
}
app.on("second-instance", show);
app.whenReady().then(() => {
  // 录表情要摄像头和麦克风：只给本软件自己的页面
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(["media"].includes(perm) && wc.getURL().startsWith("file://")));
  createWindow();
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "renderer", "icon.png")).resize({ width: 16, height: 16 }));
    tray.setToolTip("捞捞算力");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开捞捞算力", click: show },
      { label: "▶ 开始（一直算）", click: () => svc.H.setManual("on").then(syncUi) },
      { label: "⟳ 自动（按挂机设置）", click: () => svc.H.setManual("auto").then(syncUi) },
      { label: "■ 停止", click: () => svc.H.setManual("off").then(syncUi) },
      { type: "separator" },
      { label: "退出（不再帮忙算）", click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("click", show);
  } catch (e) {}
});
app.on("window-all-closed", () => {});
// 退出：Electron 不会等 async 的 before-quit 做完——以前软件已经退出了，正在跑的配方还没停，Windows 上它就成了没人管的孤儿，
//   一直在后台训练、占着显卡（重新打开软件显示「现在没有要算的」，显卡却在忙）。现在先拦下退出，停完（最多 15 秒）再真的退
let quitReady = false, shutP = null;
function shutdownOnce() { if (!shutP) shutP = Promise.race([Promise.resolve().then(() => svc.shutdown()).catch(() => {}), new Promise((r) => setTimeout(r, 15000))]); return shutP; }
app.on("before-quit", (e) => {
  quitting = true;
  if (quitReady) return;
  e.preventDefault();
  shutdownOnce().finally(() => {
    // 退出时发现新版已经下好：顺手装上（不重新打开）——配方都停了再装
    try { const u = svc.updater.status(); if (app.isPackaged && u.state === "ready" && u.file && u.state !== "installing") { const { spawn } = require("child_process"); spawn(u.file, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } } catch (e2) {}
    quitReady = true; app.quit();
  });
});
// 睡醒了 / 插拔电源：马上看一眼（不用等下一轮）
powerMonitor.on("resume", () => svc.logs.add("电脑睡醒了", "info", "电源"));
powerMonitor.on("on-battery", () => svc.logs.add("拔了电源", "info", "电源"));
powerMonitor.on("on-ac", () => svc.logs.add("插上了电源", "info", "电源"));
process.on("uncaughtException", (e) => { try { svc.logs.add("没接住的错误：" + (e && e.stack || e), "error", "软件"); } catch (e2) {} });
process.on("unhandledRejection", (e) => { try { svc.logs.add("没接住的错误：" + (e && e.stack || e), "error", "软件"); } catch (e2) {} });
