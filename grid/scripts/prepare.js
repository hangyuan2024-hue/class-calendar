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
// 成品展示「捞小智」（讲题 + 做 PPT + 办教务的事 + 说话）：也是和捞捞PPT助手同一份代码
for (const f of ["chat.js", "agent.js", "xiaozhi.js", "campus.js", "checkup.js", "pptedit.js", "pptx.js", "deck.js", "pptview.js", "latex2omml.js", "gridmodels.js", "voice.js", "media.js", "systts.js", "ai3d.js", "websearch.js", "ground.js", "mindmap.js", "kbfiles.js", "webexam.js", "voiceexam.js"]) fs.copyFileSync(path.join(ppt, f), path.join(pout, f));
// 展示里的 PPT 预览（大图 + 缩略图）
fs.copyFileSync(path.join(R, "..", "pptassist", "renderer", "deckview.js"), path.join(R, "app", "renderer", "deckview.js"));
// 展示里的形象：捞小智（app/renderer/zhi3d.js，自带）+ three.js
// 老师的 3D 小人（捞捞形象工坊做的 avatar.glb）：和捞捞PPT助手同一份渲染代码 + 工坊的 Python 代码
fs.copyFileSync(path.join(R, "..", "pptassist", "renderer", "avatar3d.js"), path.join(R, "app", "renderer", "avatar3d.js"));
fs.rmSync(path.join(R, "app", "ai3d"), { recursive: true, force: true });
fs.cpSync(path.join(R, "..", "pptassist", "ai3d", "lao3d"), path.join(R, "app", "ai3d", "lao3d"), { recursive: true, filter: (f) => !/__pycache__|\.pyc$/.test(f) });
fs.mkdirSync(path.join(R, "app", "renderer", "vendor", "three"), { recursive: true });
fs.copyFileSync(path.join(R, "node_modules", "three", "build", "three.min.js"), path.join(R, "app", "renderer", "vendor", "three", "three.min.js"));
fs.copyFileSync(path.join(R, "node_modules", "three", "examples", "js", "loaders", "GLTFLoader.js"), path.join(R, "app", "renderer", "vendor", "three", "GLTFLoader.js"));
console.log("成品展示的代码、three.js → app/ppt、app/renderer");
