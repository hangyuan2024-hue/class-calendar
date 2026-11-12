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
