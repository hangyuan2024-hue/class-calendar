// 界面和主进程之间的小桥：只开放下面这些功能，界面拿不到登录令牌、也碰不到电脑上的文件
const { contextBridge, ipcRenderer } = require("electron");
const CALLS = ["state", "login", "logout", "refresh", "mine:upsert", "mine:delete", "done", "mark", "move", "class:switch", "wall:post", "settings",
  "quick:parse", "quick:add", "quick:hide", "open:main", "open:external", "mini:toggle", "pomo:start", "pomo:stop", "pomo:state",
  "ai:prepare", "ai:cancel", "ai:chat", "ai:stop", "export:ics"];
const EVENTS = ["state", "nav", "ai-state", "ai-token", "pomo", "quick-open"];
contextBridge.exposeInMainWorld("cc", {
  call: async (ch, ...args) => {
    if (!CALLS.includes(ch)) throw new Error("不支持：" + ch);
    const r = await ipcRenderer.invoke(ch, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  on: (ev, fn) => { if (EVENTS.includes(ev)) ipcRenderer.on(ev, (e, data) => fn(data)); },
  platform: process.platform,
});
