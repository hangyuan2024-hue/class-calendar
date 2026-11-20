// 远程协助时屏幕上方红条的桥：只有一个「结束」
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bar", { end: () => ipcRenderer.send("assist-end") });
