// 捞捞PPT助手 · Electron 主进程：开窗口，把 core/service.js 的功能接到界面上。
// 界面只能通过 preload 里的 cc.call 调 service 里列出的方法。
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const { createService } = require("./core/service");

app.setPath("userData", path.join(app.getPath("appData"), "LaolaoPPT"));
let win = null;
const svc = createService({
  user: app.getPath("userData"),
  documents: app.getPath("documents"),
  version: app.getVersion(),
  send: (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); },
  pickFile: async (exts, title, kind) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openFile"], filters: [{ name: kind || "文件", extensions: exts }, { name: "所有文件", extensions: ["*"] }] }); return r.canceled ? null : r.filePaths[0]; },
  pickDir: async (title) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  openPath: (f) => shell.openPath(f),
  reveal: (f) => shell.showItemInFolder(f),
  openExternal: (u) => { if (/^https:\/\/(github\.com|www\.laolaokechengbiao\.cn)\//.test(u)) shell.openExternal(u); },
});
ipcMain.handle("call", async (ev, method, args) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method);
  return svc.H[method](...(Array.isArray(args) ? args : []));
});
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 1040, minHeight: 680, title: "捞捞PPT助手", backgroundColor: "#f5f8ff", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { svc.shutdown(); app.quit(); });
app.on("before-quit", () => svc.shutdown());
