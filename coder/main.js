// 捞捞编程 · Electron 主进程：开窗口，把 core/service.js 的功能接到界面上。
// 界面只能通过 preload 里的 cc.call 调 service 里列出的方法。
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const { createService } = require("./core/service");
const updater = require("./core/updater");

// 数据目录用英文名（编译器在 Windows 上对中文路径不放心）：%APPDATA%\LaolaoCode
app.setPath("userData", path.join(app.getPath("appData"), "LaolaoCode"));

let win = null;
const svc = createService({
  dev: !app.isPackaged,
  res: app.isPackaged ? process.resourcesPath : path.join(__dirname, "resources"),
  user: app.getPath("userData"),
  documents: app.getPath("documents"),
  version: app.getVersion(),
  send: (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); },
  pickDir: async () => { const r = await dialog.showOpenDialog(win, { title: "选一个放代码的文件夹", properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  pickFile: async (exts) => { const r = await dialog.showOpenDialog(win, { title: "打开代码文件", properties: ["openFile"], filters: [{ name: "代码", extensions: exts }, { name: "所有文件", extensions: ["*"] }] }); return r.canceled ? null : r.filePaths[0]; },
  trash: (f) => shell.trashItem(f),
  reveal: (f) => shell.showItemInFolder(f),
  openPath: (d) => shell.openPath(d),
  openExternal: (u) => shell.openExternal(u),
});

ipcMain.handle("call", async (ev, method, args) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method);
  return svc.H[method](...(Array.isArray(args) ? args : []));
});
// 1.1 检查更新（和电脑版同一个 core/updater.js）：官网 download/code-version.json，国内存储 / 加速镜像 / GitHub 测速挑最快的下
const upd = updater.create({
  app, fetch: (u, o) => net.fetch(u, o), tmpDir: path.join(app.getPath("temp"), "laolao-code-update"), spawn,
  log: (...a) => console.warn(...a), send: (st) => { if (win && !win.isDestroyed()) win.webContents.send("update", st); },
  opt: { product: "code", versionFile: "code-version.json", fileName: "LaolaoCode-Setup", installArgs: ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RELAUNCH"],
    latestUrl: "https://github.com/hangyuan2024-hue/class-calendar/releases/download/laolao-code/LaolaoCode-Setup.exe" },
});
ipcMain.handle("upd", async (ev, action) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (action === "check") return upd.check(true);
  if (action === "download") { upd.download(); return upd.state(); }
  if (action === "cancel") { upd.cancel(); return upd.state(); }
  if (action === "install") { win.webContents.send("before-close"); setTimeout(() => upd.install(() => { svc.shutdown(); app.quit(); }), 800); return true; }
  if (action === "page") { shell.openExternal(upd.page); return true; }
  return upd.state();
});
ipcMain.handle("closing-ok", () => { if (win) { win.__canClose = true; win.close(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 560, title: "捞捞编程", backgroundColor: "#f6f5f1", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // 关窗口前让界面把没保存的代码存好（最多等 1.5 秒）
  win.on("close", (e) => {
    if (win.__canClose) return;
    e.preventDefault();
    win.webContents.send("before-close");
    setTimeout(() => { if (win && !win.isDestroyed()) { win.__canClose = true; win.close(); } }, 1500);
  });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); createWindow(); svc.boot();
    // 打开 20 秒后检查一次，之后每 6 小时（开发时不查）
    const auto = () => { if (app.isPackaged) upd.check(false).catch(() => {}); };
    setTimeout(auto, 20000); setInterval(auto, 6 * 3600 * 1000);
  });
  app.on("window-all-closed", () => { svc.shutdown(); app.quit(); });
  app.on("before-quit", () => svc.shutdown());
}
