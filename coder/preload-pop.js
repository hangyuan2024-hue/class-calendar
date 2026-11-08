// 捞捞编程 · 拖出程序的「实时画面」小窗口和主进程之间的桥
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pop", {
  on: (fn) => ipcRenderer.on("vizpop", (_e, msg) => fn(msg)),
  send: (msg) => ipcRenderer.send("vizpop:to-main", msg),
  close: () => ipcRenderer.send("vizpop:close"),
});
