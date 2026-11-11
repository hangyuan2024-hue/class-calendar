// 捞捞PPT助手 · 界面和主进程之间的桥：只给界面 cc.call(方法, ...参数) 和 cc.on(事件, 回调)
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const EVENTS = new Set(["voice", "ai3d", "talk", "aiav", "setup", "agent"]);
contextBridge.exposeInMainWorld("cc", {
  call: (method, ...args) => ipcRenderer.invoke("call", method, args),
  on: (ev, fn) => { if (EVENTS.has(ev)) ipcRenderer.on(ev, (_e, d) => fn(d)); },
});
