// 网页版：思维导图「AI 识别图片」后台任务用的 @napi-rs/canvas（本机的原生绘图库），用浏览器的 OffscreenCanvas 代替。
// 只实现 text-worker.cjs 用到的几样：loadImage(文件路径) → createCanvas → getContext("2d").drawImage / fillRect → toBuffer("image/jpeg", 质量)。
// 浏览器里编码图片是异步的：打包时把 c.toBuffer(...) 改成了 await c.toBuffer(...)（见 runtime/build.js）。
"use strict";
const fs = require("node:fs");
const { Buffer } = require("./buffer.js");
async function loadImage(src) {
  const data = typeof src === "string" ? fs.readFileSync(src) : Buffer.from(src);
  if (typeof createImageBitmap !== "function") throw new Error("这个浏览器不能在后台处理图片，请换用新版 Chrome / Edge");
  const bitmap = await createImageBitmap(new Blob([data]));
  return { width: bitmap.width, height: bitmap.height, __bitmap: bitmap };
}
function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== "function") throw new Error("这个浏览器不能在后台处理图片，请换用新版 Chrome / Edge");
  const c = new OffscreenCanvas(w, h), ctx = c.getContext("2d");
  const wrap = {
    get fillStyle() { return ctx.fillStyle; }, set fillStyle(v) { ctx.fillStyle = v; },
    fillRect: (...a) => ctx.fillRect(...a),
    drawImage: (img, ...a) => ctx.drawImage(img && img.__bitmap ? img.__bitmap : img, ...a),
  };
  return {
    get width() { return c.width; }, get height() { return c.height; },
    getContext: () => wrap,
    async toBuffer(type, quality) {
      const blob = await c.convertToBlob({ type: type || "image/png", quality: typeof quality === "number" ? quality / 100 : undefined });
      return Buffer.from(new Uint8Array(await blob.arrayBuffer()));
    },
  };
}
module.exports = { loadImage, createCanvas };
