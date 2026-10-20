// 捞捞思维导图 · 网页版的「本机服务」
// 桌面版 / 本机版由 node server.js 提供 api/maps（导图文件、草稿、图片 PDF 附件）和 api/ai（大模型）。
// 网站上没有这个服务：这个 Service Worker 在浏览器里跑同一套代码（js/map-files.cjs、js/ai-server.cjs），
// 文件存在本浏览器的 IndexedDB（见 memfs.js）。只拦截本页面目录下的 api/ 请求，其余照常从网站拿。
"use strict";
const fs = require("node:fs");
const { Buffer } = require("./buffer.js");
const mapFiles = require("../js/map-files.cjs");
const ai = require("../js/ai-server.cjs");
const PORT = 8794;
const ready = fs.__load().catch((e) => { console.error("[mm-sw] 读取本地存储失败", e); });

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function fakeReq(request, body, path) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  delete headers.origin;                       // 同源请求；原服务只允许本机页面，这里冒充成本机
  headers.host = "127.0.0.1:" + PORT;
  return {
    method: request.method, url: path, headers,
    resume() {}, on() { return this; },
    async *[Symbol.asyncIterator]() { if (body && body.length) yield body; },
  };
}
function fakeRes() {
  let resolve; const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200, headers: {}, chunks: [], headersSent: false, destroyed: false, finished: false,
    setHeader(k, v) { res.headers[k] = v; }, getHeader(k) { return res.headers[k]; },
    writeHead(code, h) { res.statusCode = code; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
    write(c) { if (c != null) res.chunks.push(typeof c === "string" ? Buffer.from(c) : c); res.headersSent = true; return true; },
    end(c) { if (c != null) res.write(c); if (!res.finished) { res.finished = true; resolve(); } return res; },
    destroy() { res.destroyed = true; if (!res.finished) { res.statusCode = res.headersSent ? res.statusCode : 500; res.finished = true; resolve(); } },
    on() { return res; }, once() { return res; }, off() { return res; }, addListener() { return res; }, removeListener() { return res; }, removeAllListeners() { return res; }, emit() { return false; },
    done,
  };
  return res;
}
async function serve(request, path) {
  await ready;
  const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(new Uint8Array(await request.arrayBuffer()));
  const req = fakeReq(request, body, path), res = fakeRes();
  const h = path === "/api/maps" || path.startsWith("/api/maps/") ? mapFiles.handle : ai.handle;
  try { await h(req, res, PORT); } catch (e) { if (!res.finished) { res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: e.message || "出错了" })); } }
  await res.done;
  try { await fs.__flush(); } catch (e) {
    return new Response(JSON.stringify({ error: "浏览器存储空间不足，刚才的改动没有保存。请删掉一些用不到的导图或附件后重试。" }), { status: 507, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) if (v != null && !/^content-length$/i.test(k)) headers.set(k, String(v));
  let data = res.chunks.length ? Buffer.concat(res.chunks) : null;
  // 网页版是浏览器直接连大模型平台：连不上时多半是平台不允许网页直接调用（跨域），提示换一家或用电脑版
  if (path.startsWith("/api/ai/") && data && /application\/json/.test(String(res.headers["Content-Type"] || "")) && res.statusCode >= 500) {
    try {
      const j = JSON.parse(data.toString());
      if (j && typeof j.error === "string" && /无法连接|连接.*失败|网络/.test(j.error) && !/网页版/.test(j.error)) { j.error += "。网页版由浏览器直接连接大模型平台，个别平台不允许网页直接调用；可以换 DeepSeek 等平台，或使用捞捞电脑版。"; data = Buffer.from(JSON.stringify(j)); }
    } catch (e) {}
  }
  return new Response([204, 304].includes(res.statusCode) || request.method === "HEAD" ? null : data, { status: res.statusCode, headers });
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL("./", self.registration.scope).pathname;
  if (!url.pathname.startsWith(base + "api/")) return;
  const path = "/" + url.pathname.slice(base.length) + url.search;
  event.respondWith(serve(event.request, path));
});
