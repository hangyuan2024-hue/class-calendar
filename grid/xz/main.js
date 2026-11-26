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
    const w = new BrowserWindow({ width: 1280, height: 780, title: title || "播放", backgroundColor: "#000000", autoHideMenuBar: true, icon: require("path").join(__dirname, "..", "app", "renderer", "icon.png"),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" } });
    w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
    w.loadURL(u);
  },
  pickFolder: async () => { const r = await dialog.showOpenDialog(win, { title: "选一个文件夹给捞小智（文件留在原地，用到再读）", properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  // 捞小智做的文件「另存为」：选个地方拷一份过去
  saveCopy: async (f) => { const r = await dialog.showSaveDialog(win, { title: "另存为", defaultPath: require("path").basename(f) }); if (r.canceled || !r.filePath) return null; require("fs").copyFileSync(f, r.filePath); return r.filePath; },
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
function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1100, minHeight: 700, title: "捞小智", backgroundColor: "#ffffff", autoHideMenuBar: true, frame: false,
    icon: path.join(__dirname, "..", "app", "renderer", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "..", "app", "preload.js"), contextIsolation: true, sandbox: true } });
  win.__frameless = true; winEvents(win);
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
