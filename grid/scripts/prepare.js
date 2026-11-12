// 打包前：认脸用的 MediaPipe face_mesh（Apache-2.0，模型在包里，本机跑）拷进界面；表情参数标准（shared/expr.js）给录表情页面用
"use strict";
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..");
const src = path.join(R, "node_modules", "@mediapipe", "face_mesh"), out = path.join(R, "app", "renderer", "vendor", "mediapipe", "face_mesh");
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) if (/\.(js|wasm|data|binarypb|tflite)$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(out, f));
for (const f of ["README.md", "LICENSE"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.copyFileSync(path.join(R, "shared", "expr.js"), path.join(R, "app", "renderer", "expr.js"));
console.log("mediapipe face_mesh、expr.js → app/renderer");
// AI 引擎（ComfyUI）的安装、启动、下模型、交节点图：和捞捞PPT助手用同一套代码（只维护一份）
const ppt = path.join(R, "..", "pptassist", "core"), pout = path.join(R, "app", "ppt");
fs.mkdirSync(pout, { recursive: true });
for (const f of ["engine.js", "workflows.js", "dl.js", "installer.js", "mirror.js"]) fs.copyFileSync(path.join(ppt, f), path.join(pout, f));
console.log("pptassist/core 的 AI 引擎代码 → app/ppt");
