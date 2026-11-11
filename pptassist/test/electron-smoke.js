// 在真的 Electron 里（file://、真的安全策略）试一下认脸：npx electron test/electron-smoke.js 照片.jpg
//   照片用 data: 地址塞进界面，调 LaoVision.analyzePhoto（模型在 vision.html 那个小页面里跑），把结果打出来就退出
"use strict";
const { app } = require("electron");
const fs = require("fs"), path = require("path");
const img = process.argv.find((a) => /\.(jpe?g|png)$/i.test(a));
app.on("browser-window-created", (_e, win) => {
  win.webContents.on("console-message", (_e2, level, msg) => { if (level >= 2) console.log("[界面]", msg); });
  win.webContents.once("did-finish-load", async () => {
    try {
      const url = "data:image/" + (/png$/i.test(img) ? "png" : "jpeg") + ";base64," + fs.readFileSync(img).toString("base64");
      const r = await win.webContents.executeJavaScript(`(async () => {
        const im = new Image(); im.src = ${JSON.stringify(url)}; await im.decode();
        const t = performance.now(); const r = await window.LaoVision.analyzePhoto(im);
        if (r.hair) delete r.hair.mask;
        return { ms: Math.round(performance.now() - t), ok: r.ok, error: r.error, yaw: r.face && Math.round(r.face.yaw), marks: r.marks, hair: r.hair && { style: r.hair.style, bangs: r.hair.bangs, text: r.hair.text, color: r.hair.color } };
      })()`);
      console.log("RESULT " + JSON.stringify(r));
    } catch (e) { console.log("FAIL " + e.message); }
    app.quit();
  });
});
require(path.join(__dirname, "..", "main.js"));
