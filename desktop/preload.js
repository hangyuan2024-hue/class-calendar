// 界面和主进程之间的小桥：只开放下面这些功能，界面拿不到登录令牌、也碰不到电脑上的文件
const { contextBridge, ipcRenderer, webUtils } = require("electron");
const CALLS = ["state", "login", "logout", "refresh", "class:reload", "mine:upsert", "mine:delete", "done", "mark", "move", "kv:set", "kv:batch", "habit", "growth",
  "class:switch", "wall:post", "courses:save", "api:rpc", "api:get", "api:del", "settings",
  "quick:parse", "quick:add", "quick:hide", "open:main", "open:external", "mini:toggle", "brief:open", "brief:close", "pomo:start", "pomo:stop", "pomo:state",
  "ai:prepare", "ai:cancel", "ai:chat", "ai:stop", "ai:extract", "export:ics", "export:pdf", "export:image", "print", "wallpaper:set", "wallpaper:restore", "wallpaper:state",
  "attach:pick", "attach:add", "attach:remove", "attach:open", "attach:show", "attach:exists", "backup:now", "backup:list", "backup:open", "backup:restore",
  "badge", "clip:read", "clip:image"];
const EVENTS = ["state", "nav", "ai-state", "ai-token", "pomo", "pomo-done", "quick-open", "badge"];
contextBridge.exposeInMainWorld("cc", {
  call: async (ch, ...args) => {
    if (!CALLS.includes(ch)) throw new Error("不支持：" + ch);
    const r = await ipcRenderer.invoke(ch, ...args);
    if (!r.ok) { const e = new Error(r.error); e.status = r.status; throw e; }
    return r.data;
  },
  on: (ev, fn) => { if (EVENTS.includes(ev)) ipcRenderer.on(ev, (e, data) => fn(data)); },
  // 拖进窗口的文件在电脑上的位置（作业附件用）
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ""; } catch (e) { return ""; } },
  platform: process.platform,
});
