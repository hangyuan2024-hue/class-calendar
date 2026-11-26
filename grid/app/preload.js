// 捞捞算力 · 界面和主进程之间的桥：只给界面 lg.call(方法, ...参数) 和 lg.on(事件, 回调)
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const EVENTS = new Set(["agent", "env", "test", "ai", "record", "kicked", "update", "log", "show", "win"]);
contextBridge.exposeInMainWorld("lg", {
  call: (method, ...args) => ipcRenderer.invoke("call", method, args),
  // 自己画的标题栏：min / max / close；传 "state" 只问现在的样子
  win: (a) => ipcRenderer.invoke("win", String(a || "state")),
  on: (ev, fn) => { if (EVENTS.has(ev)) ipcRenderer.on(ev, (_e, d) => fn(d)); },
});
