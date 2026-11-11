// 捞捞编程 · Electron 主进程：开窗口，把 core/service.js 的功能接到界面上。
// 界面只能通过 preload 里的 cc.call 调 service 里列出的方法。
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, session, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { createService } = require("./core/service");
const updater = require("./core/updater");

// 数据目录用英文名（编译器在 Windows 上对中文路径不放心）：%APPDATA%\LaolaoCode
app.setPath("userData", path.join(app.getPath("appData"), "LaolaoCode"));

let win = null;
const LC_PART = "persist:leetcode";
function lcLogin() {
  return new Promise((resolve) => {
    const ses = session.fromPartition(LC_PART);
    const w = new BrowserWindow({ width: 480, height: 760, parent: win || undefined, title: "登录力扣（leetcode.cn）", autoHideMenuBar: true, backgroundColor: "#ffffff",
      webPreferences: { partition: LC_PART, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    let fin = false;
    const done = (ok) => { if (fin) return; fin = true; ses.cookies.removeListener("changed", onCookie); if (!w.isDestroyed()) w.close(); resolve(ok); };
    const onCookie = (_e, c, _cause, removed) => { if (!removed && c.name === "LEETCODE_SESSION" && /leetcode\.cn$/.test(c.domain.replace(/^\./, ""))) setTimeout(() => done(true), 800); };
    ses.cookies.on("changed", onCookie);
    // 只在力扣自己的页面里转（第三方登录会跳到微信、QQ 等，在同一个窗口里打开）
    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) w.loadURL(url); return { action: "deny" }; });
    w.on("closed", () => done(false));
    // 用普通 Chrome 的 User-Agent（带着 Electron 字样有的网站会当成机器人）
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s(LaolaoCode|laolao-code|Electron)\/\S+/gi, ""));
    w.loadURL("https://leetcode.cn/accounts/login/?next=%2Fproblemset%2F");
  });
}
const svc = createService({
  dev: !app.isPackaged,
  res: app.isPackaged ? process.resourcesPath : path.join(__dirname, "resources"),
  user: app.getPath("userData"),
  documents: app.getPath("documents"),
  version: app.getVersion(),
  send: (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); },
  pickDir: async () => { const r = await dialog.showOpenDialog(win, { title: "选一个放代码的文件夹", properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; },
  pickFile: async (exts, title, kind) => { const r = await dialog.showOpenDialog(win, { title: title || "打开代码文件", properties: ["openFile"], filters: [{ name: kind || "代码", extensions: exts }, { name: "所有文件", extensions: ["*"] }] }); return r.canceled ? null : r.filePaths[0]; },
  trash: (f) => shell.trashItem(f),
  reveal: (f) => shell.showItemInFolder(f),
  openPath: (d) => shell.openPath(d),
  openExternal: (u) => shell.openExternal(u),
  // 力扣登录：开一个小窗口打开力扣的登录页（扫码 / 密码都行），登录后的 cookie 只存在这个窗口专用的分区里，
  // 软件用它代你「运行 / 提交」；密码不经过捞捞编程
  lcCookies: () => session.fromPartition(LC_PART).cookies.get({ url: "https://leetcode.cn" }),
  lcLogin: () => lcLogin(),
  lcLogout: () => session.fromPartition(LC_PART).clearStorageData(),
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
  // 安装参数：/SILENT 有进度窗口（以前 /VERYSILENT 什么都不显示，1.5 GB 要装好几分钟，看起来像没反应）；
  // /WAITPID 让安装程序等这个软件完全退出再开始装（不然文件被占用，静默模式下直接放弃）；/LOG 出错了下次打开能看到原因
  opt: { product: "code", versionFile: "code-version.json", fileName: "LaolaoCode-Setup",
    installArgs: ({ log, pid }) => ["/SILENT", "/SP-", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS", "/RELAUNCH", "/WAITPID=" + pid, "/LOG=" + log],
    openInstaller: (f) => shell.openPath(f),
    latestUrl: "https://github.com/hangyuan2024-hue/class-calendar/releases/download/laolao-code/LaolaoCode-Setup.exe" },
});
ipcMain.handle("upd", async (ev, action) => {
  if (!win || ev.sender !== win.webContents) throw new Error("拒绝");
  if (action === "check") return upd.check(true);
  if (action === "download") { upd.download(); return upd.state(); }
  if (action === "cancel") { upd.cancel(); return upd.state(); }
  if (action === "install") { win.webContents.send("before-close"); svc.shutdown(); setTimeout(() => { try { upd.install(() => { win.__canClose = true; app.quit(); }); } catch (e) { win.webContents.send("update", { ...upd.state(), state: "failed", error: e.message }); } }, 800); return true; }
  if (action === "manual") { win.webContents.send("before-close"); svc.shutdown(); upd.openInstaller(() => { win.__canClose = true; app.quit(); }); return true; }
  if (action === "page") { shell.openExternal(upd.page); return true; }
  return upd.state();
});
ipcMain.handle("closing-ok", () => { if (win) { win.__canClose = true; win.close(); } });

// ---------- 实时画面拖出程序：单独的一个小窗口，置顶，可以放在屏幕任何地方 ----------
// 主界面负责追踪、把结果（每一步的变量）发过来；小窗口自己播放，按钮（放大、收回）发回主界面
let pop = null;
const popFile = () => path.join(app.getPath("userData"), "viz-pop.json");
function popBounds(want) {
  let b = want;
  if (!b) { try { b = JSON.parse(fs.readFileSync(popFile(), "utf8")); } catch (e) {} }
  if (!b) { const wb = win ? win.getBounds() : { x: 100, y: 100, width: 1200, height: 800 }; b = { x: wb.x + wb.width - 400, y: wb.y + wb.height - 360, width: 380, height: 330 }; }
  b = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(280, Math.round(b.width || 380)), height: Math.max(200, Math.round(b.height || 330)) };
  // 屏幕换了（拔了外接显示器）：拉回到能看见的地方
  const wa = screen.getDisplayMatching(b).workArea;
  b.x = Math.min(Math.max(b.x, wa.x - b.width + 80), wa.x + wa.width - 80);
  b.y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - 60);
  return b;
}
let popSave = 0;
function openPop(want) {
  if (pop && !pop.isDestroyed()) { if (want) pop.setBounds(popBounds(want)); pop.showInactive(); return true; }
  pop = new BrowserWindow({ ...popBounds(want), minWidth: 280, minHeight: 200, frame: false, alwaysOnTop: true, skipTaskbar: false, resizable: true, fullscreenable: false, maximizable: false,
    title: "实时画面 · 捞捞编程", backgroundColor: "#060b16", show: false, icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload-pop.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  pop.setAlwaysOnTop(true, "floating");
  pop.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  pop.webContents.on("will-navigate", (e) => e.preventDefault());
  pop.loadFile(path.join(__dirname, "renderer", "vizpop.html"));
  pop.once("ready-to-show", () => { if (pop && !pop.isDestroyed()) pop.showInactive(); });
  const save = () => { clearTimeout(popSave); popSave = setTimeout(() => { try { if (pop && !pop.isDestroyed()) fs.writeFileSync(popFile(), JSON.stringify(pop.getBounds())); } catch (e) {} }, 400); };
  pop.on("move", save); pop.on("resize", save);
  pop.on("closed", () => { pop = null; if (win && !win.isDestroyed()) win.webContents.send("vizpop-cmd", { type: "closed" }); });
  return true;
}
const fromMain = (ev) => win && ev.sender === win.webContents;
const fromPop = (ev) => pop && !pop.isDestroyed() && ev.sender === pop.webContents;
ipcMain.handle("vizpop:open", (ev, b) => { if (!fromMain(ev)) throw new Error("拒绝"); return openPop(b && typeof b === "object" ? b : null); });
ipcMain.on("vizpop:move", (ev, x, y) => { if (fromMain(ev) && pop && !pop.isDestroyed()) { const b = pop.getBounds(); pop.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height }); } });
ipcMain.on("vizpop:close", (ev) => { if ((fromMain(ev) || fromPop(ev)) && pop && !pop.isDestroyed()) pop.close(); });
// 主界面 → 小窗口：追踪结果、状态
ipcMain.on("vizpop:to-pop", (ev, msg) => { if (fromMain(ev) && pop && !pop.isDestroyed()) pop.webContents.send("vizpop", msg); });
// 小窗口 → 主界面：放大、收回、播到第几步（编辑器里跟着标行）
ipcMain.on("vizpop:to-main", (ev, msg) => {
  if (!fromPop(ev) || !win || win.isDestroyed()) return;
  if (msg && msg.type === "expand") { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  win.webContents.send("vizpop-cmd", msg);
});

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
  win.on("closed", () => { if (pop && !pop.isDestroyed()) pop.destroy(); });
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
    // 上次点了「重启并更新」：看看装上没有
    setTimeout(() => { try { const r = upd.checkPending(); if (r && r.updated && win && !win.isDestroyed()) win.webContents.send("update", { ...upd.state(), state: "latest", justUpdated: r.updated }); } catch (e) {} }, 2500);
    // 打开 20 秒后检查一次，之后每 6 小时（开发时不查）
    const auto = () => { if (app.isPackaged) upd.check(false).catch(() => {}); };
    setTimeout(auto, 20000); setInterval(auto, 6 * 3600 * 1000);
  });
  app.on("window-all-closed", () => { svc.shutdown(); app.quit(); });
  app.on("before-quit", () => svc.shutdown());
}
