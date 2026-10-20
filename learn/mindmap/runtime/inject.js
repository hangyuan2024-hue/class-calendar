// 打包时注入到每个模块：Node 里的全局 Buffer、process.env
export const Buffer = require("./buffer.js").Buffer;
export const process = { env: {}, platform: "browser", nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) };
