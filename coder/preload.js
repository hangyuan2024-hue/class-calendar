// 捞捞编程 · 界面和主进程之间的桥：只给界面一个 cc.call(方法, ...参数) 和 cc.on(事件, 回调)
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const EVENTS = new Set(["run", "install", "ai", "ai-state", "progress", "me", "before-close"]);
contextBridge.exposeInMainWorld("cc", {
  call: (method, ...args) => ipcRenderer.invoke("call", method, args),
  on: (ev, fn) => { if (!EVENTS.has(ev)) return; ipcRenderer.on(ev, (_e, data) => fn(data)); },
  closingOk: () => ipcRenderer.invoke("closing-ok"),
});
