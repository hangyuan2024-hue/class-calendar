// 捞捞算力 · Electron 主进程：开窗口、托盘（关掉窗口后台照样算）、开机自启、空闲时间、控制中心窗口
"use strict";
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, powerMonitor, nativeImage, session, dialog } = require("electron");
const path = require("path");
const { createService } = require("./service");

app.setPath("userData", path.join(app.getPath("appData"), "LaolaoGrid"));
if (!app.requestSingleInstanceLock()) app.quit();
let win = null, tray = null, quitting = false;
const svc = createService({
  user: app.getPath("userData"),
  version: app.getVersion(),
  // 本地大模型的程序（安装包里带的 llama.cpp Vulkan 版）
  llamaExe: app.isPackaged ? path.join(process.resourcesPath, "llama", "llama-server.exe") : process.env.LG_LLAMA || null,
  send: (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); },
  idleSecs: async () => powerMonitor.getSystemIdleTime(),
  setAutostart: (v) => app.setLoginItemSettings({ openAtLogin: v, args: ["--hidden"] }),
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
  if (!process.argv.includes("--hidden")) win.once("ready-to-show", () => win.show());
  // 关窗口 = 藏到托盘，后台接着算；托盘里点「退出」才真的退出
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
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
app.on("before-quit", async () => { quitting = true; await svc.shutdown(); });
