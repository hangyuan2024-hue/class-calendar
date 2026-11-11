// 打包前：把 three.js 放进 renderer/vendor（界面不能 require，只能用 <script> 引）
"use strict";
const fs = require("fs"), path = require("path");
const dst = path.join(__dirname, "..", "renderer", "vendor", "three");
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "node_modules", "three", "build", "three.min.js"), path.join(dst, "three.min.js"));
// 读 AI 生成的 3D 形象（.glb）用的（three r147 还带着非模块版的）
fs.copyFileSync(path.join(__dirname, "..", "node_modules", "three", "examples", "js", "loaders", "GLTFLoader.js"), path.join(dst, "GLTFLoader.js"));
console.log("three.js →", dst);
// 认脸、认头发用的 MediaPipe（Apache-2.0，模型都在包里，本机跑，不联网）：face_mesh（478 个点，含虹膜）、selfie_segmentation（人和背景分开）
for (const pkg of ["face_mesh", "selfie_segmentation"]) {
  const src = path.join(__dirname, "..", "node_modules", "@mediapipe", pkg), out = path.join(__dirname, "..", "renderer", "vendor", "mediapipe", pkg);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(src)) if (/\.(js|wasm|data|binarypb|tflite)$/.test(f) && f !== "index.d.ts") fs.copyFileSync(path.join(src, f), path.join(out, f));
  fs.copyFileSync(path.join(src, "README.md"), path.join(out, "README.md"));
  // npm 包里没带许可证全文：Apache-2.0 的全文（和 LatentSync 带的那份一样）放一份进去
  fs.copyFileSync(path.join(__dirname, "..", "ai3d", "third_party", "latentsync", "LICENSE"), path.join(out, "LICENSE-Apache-2.0.txt"));
}
console.log("mediapipe → renderer/vendor/mediapipe");
