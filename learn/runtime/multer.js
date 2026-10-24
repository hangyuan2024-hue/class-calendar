// 网页版用的 multer 替身：从 Service Worker 收到的 FormData 里取文件，存进浏览器里的虚拟磁盘（memfs）
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Buffer } = require("./buffer.js");

function diskStorage(opt) { return { kind: "disk", opt }; }
function memoryStorage() { return { kind: "memory" }; }

function multer(options = {}) {
  const storage = options.storage || memoryStorage();
  const limit = options.limits && options.limits.fileSize || 100 * 1024 * 1024;
  async function parse(req, field) {
    const fd = req.__formData ? await req.__formData() : null;
    const body = {};
    let file = null;
    if (fd) {
      for (const [k, v] of fd.entries()) {
        if (typeof v === "string") { if (k in body) body[k] = [].concat(body[k], v); else body[k] = v; continue; }
        if (k !== field || file) continue;
        const data = Buffer.from(new Uint8Array(await v.arrayBuffer()));
        if (data.length > limit) throw Object.assign(new Error("文件太大了"), { status: 413, code: "LIMIT_FILE_SIZE" });
        file = { fieldname: k, originalname: v.name || "file", encoding: "7bit", mimetype: v.type || "application/octet-stream", size: data.length };
        if (storage.kind === "disk") {
          const o = storage.opt || {};
          const dest = await new Promise((res, rej) => typeof o.destination === "function" ? o.destination(req, file, (e, d) => (e ? rej(e) : res(d))) : res(o.destination || "/tmp/uploads"));
          const name = await new Promise((res, rej) => typeof o.filename === "function" ? o.filename(req, file, (e, n) => (e ? rej(e) : res(n))) : res(Date.now() + "-" + Math.round(Math.random() * 1e9)));
          fs.mkdirSync(dest, { recursive: true });
          const p = path.join(dest, name);
          fs.writeFileSync(p, data);
          Object.assign(file, { destination: dest, filename: name, path: p });
        } else file.buffer = data;
      }
    }
    req.body = Object.assign({}, req.body && typeof req.body === "object" ? req.body : {}, body);
    req.__bodyParsed = true;
    if (file) req.file = file;
  }
  const mw = (field) => (req, res, next) => { if (!req.is("multipart/form-data")) return next(); parse(req, field).then(() => next(), (e) => next(e)); };
  return { single: mw, any: () => mw("__any__"), none: () => mw("__none__"), array: (f) => mw(f), fields: (list) => mw((list && list[0] && list[0].name) || "file") };
}
multer.diskStorage = diskStorage;
multer.memoryStorage = memoryStorage;
module.exports = multer;
