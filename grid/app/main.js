// 捞捞算力 · Electron 主进程：开窗口、托盘（关掉窗口后台照样算）、开机自启、空闲时间、控制中心窗口
"use strict";
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, powerMonitor, powerSaveBlocker, nativeImage, session, dialog, Notification } = require("electron");
const path = require("path");
const { createService } = require("./service");

app.setPath("userData", path.join(app.getPath("appData"), "LaolaoGrid"));
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("cn.laolao.grid");   // Windows 通知要这个
let win = null, tray = null, quitting = false;
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
  restart: () => { quitting = true; app.relaunch({ args: process.argv.slice(1).filter((a) => a !== "--hidden").concat(win && win.isVisible() ? [] : ["--hidden"]) }); app.exit(0); },
  reveal: (f) => shell.showItemInFolder(f),
  openPath: (f) => shell.openPath(f),
  windowHidden: () => !win || win.isDestroyed() || !win.isVisible() || win.isMinimized(),
  // 静默安装新版（/S），装完自己打开（--force-run）；只有装好的软件才自动更新
  install: app.isPackaged ? async (file) => {
    const { spawn } = require("child_process");
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 300);
  } : null,
  pickDir: async (title) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  openAdmin: (u) => {
    const w = new BrowserWindow({ width: 1400, height: 900, title: "捞捞算力 · 控制中心", backgroundColor: "#060a16", autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.loadURL(u);
  },
});
ipcMain.handle("call", async (ev, method, args) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method);
  return svc.H[method](...(Array.isArray(args) ? args : []));
});
// 托盘里改了开关，界面也跟着变
const syncUi = (m) => { if (win && !win.isDestroyed()) win.webContents.send("agent", { k: "manual", v: m }); };
function show() { if (!win) createWindow(); else { win.show(); win.focus(); } }
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1380, height: 880, minWidth: 1100, minHeight: 700, title: "捞捞算力", backgroundColor: "#050914", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
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
app.on("before-quit", async () => {
  quitting = true;
  // 退出时发现新版已经下好：顺手装上（不重新打开）
  try { const u = svc.updater.status(); if (app.isPackaged && u.state === "ready" && u.file) { const { spawn } = require("child_process"); spawn(u.file, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } } catch (e) {}
  await svc.shutdown();
});
// 睡醒了 / 插拔电源：马上看一眼（不用等下一轮）
powerMonitor.on("resume", () => svc.logs.add("电脑睡醒了", "info", "电源"));
powerMonitor.on("on-battery", () => svc.logs.add("拔了电源", "info", "电源"));
powerMonitor.on("on-ac", () => svc.logs.add("插上了电源", "info", "电源"));
process.on("uncaughtException", (e) => { try { svc.logs.add("没接住的错误：" + (e && e.stack || e), "error", "软件"); } catch (e2) {} });
process.on("unhandledRejection", (e) => { try { svc.logs.add("没接住的错误：" + (e && e.stack || e), "error", "软件"); } catch (e2) {} });
