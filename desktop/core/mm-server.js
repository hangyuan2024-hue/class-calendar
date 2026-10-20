// 电脑版 · 思维导图的本机服务（6.8）
// 新版思维导图（网站 learn/mindmap/，sync-web 拷到 renderer/web/mindmap/）原本靠 `node server.js` 提供
// api/maps（导图文件、草稿、图片和 PDF）和 api/ai（大模型）。电脑版在主进程里跑同一套代码，
// 导图存在 %APPDATA%\捞捞课程表\mindmap\maps，大模型配置存在 mindmap\ai-config.json，只监听本机。
// 端口固定（18097 起），这样页面的地址不变，浏览器存储里的草稿每次打开都还在。
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon", ".pdf": "application/pdf", ".map": "application/json; charset=utf-8" };

function start({ root, dataDir, port = 18097, tries = 5 }) {
  fs.mkdirSync(path.join(dataDir, "maps"), { recursive: true });
  process.env.MM_STORAGE_DIR = path.join(dataDir, "maps");
  process.env.MM_AI_CONFIG_FILE = path.join(dataDir, "ai-config.json");
  const mapFiles = require(path.join(root, "js", "map-files.cjs"));
  const ai = require(path.join(root, "js", "ai-server.cjs"));
  return new Promise((resolve, reject) => {
    let cur = port;
    const server = http.createServer((req, res) => {
      if (req.url === "/api/maps" || req.url.startsWith("/api/maps/")) return mapFiles.handle(req, res, cur);
      if (req.url.startsWith("/api/ai/")) return ai.handle(req, res, cur);
      let rel; try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rel = "/"; }
      if (rel.split(/[\\/]/).some((p) => p.startsWith(".")) || /\.(?:cjs|local)$/i.test(rel)) { res.writeHead(403); return res.end("403"); }
      if (rel === "/" || rel.endsWith("/")) rel += "index.html";
      const file = path.resolve(root, "." + rel);
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("403"); }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404"); }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-store" });
        fs.createReadStream(file).pipe(res);
      });
    });
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE" && cur < port + tries) { cur++; server.listen(cur, "127.0.0.1"); }
      else reject(e);
    });
    server.listen(cur, "127.0.0.1", () => resolve({ port: cur, server }));
  });
}
module.exports = { start };
