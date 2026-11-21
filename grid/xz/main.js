// 捞小智电脑版 · Electron 主进程：一个窗口，就是捞小智（讲题、做 PPT、办教务的事、打电话、检测报告）
"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog, session, Menu } = require("electron");
const path = require("path");
const { createXz } = require("./service");

app.setPath("userData", path.join(app.getPath("appData"), "LaolaoXiaozhi"));
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("cn.laolao.xiaozhi");
let win = null;

const xz = createXz({
  user: app.getPath("userData"),
  version: app.getVersion(),
  llamaExe: app.isPackaged ? path.join(process.resourcesPath, "llama", "llama-server.exe") : process.env.LG_LLAMA || null,
  send: (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); },
  reveal: (f) => shell.showItemInFolder(f),
  openPath: (f) => shell.openPath(f),
  openExternal: (u) => { if (/^https:\/\/www\.laolaokechengbiao\.cn\//.test(u)) shell.openExternal(u); },
  fullscreen: (v) => { if (win && !win.isDestroyed()) win.setFullScreen(!!v); },
  isFullscreen: () => !!(win && !win.isDestroyed() && win.isFullScreen()),
  pickFile: async (exts, title, kind) => { const r = await dialog.showOpenDialog(win, { title, properties: ["openFile"], filters: [{ name: kind || "文件", extensions: exts }] }); return r.canceled ? null : r.filePaths[0]; },
});

ipcMain.handle("call", async (_e, method, args) => {
  const fn = xz.H[method];
  if (typeof fn !== "function") throw new Error("没有这个功能：" + method);
  return fn(...(Array.isArray(args) ? args : []));
});

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1100, minHeight: 700, title: "捞小智", backgroundColor: "#060a16", autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "app", "renderer", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "..", "app", "preload.js"), contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // 打电话要用麦克风：只给自己的页面
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" && wc.getURL().startsWith("file://")));
  createWindow();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { try { xz.shutdown(); } catch (e) {} });
