// 课内学习 · 网页版的「后端」（打包进 learn/sw.js）
// 本机版由 node back/server.js（Express + SQLite）提供 /api 接口。网站上没有这个服务：
// Service Worker 在浏览器里跑同一份 server.js —— Express 换成 runtime/express.js，SQLite 换成 sql.js（WebAssembly），
// 数据库和上传的附件存在本浏览器的 IndexedDB（learn-fs），登录后由页面里的 learn-sync.js 备份到捞捞账号。
"use strict";
const fs = require("node:fs");
const { Buffer } = require("./buffer.js");
const sqlite = require("./sqlite.js");
const DB_FILE = "/app/data/app.db";
const UPLOADS = "/app/back/uploads";

let app = null, bootError = null;
let notify = () => {};
const ready = (async () => {
  try {
    self.__SQL = await initSqlJs({ locateFile: (f) => new URL("courses/vendor/sqljs/" + f, self.registration.scope).href });
    await fs.__ready;
    fs.mkdirSync("/app/back", { recursive: true });              // 本机版这些目录本来就有
    app = require("./server-app.js");   // 打包时指向 back/server.js
  } catch (e) { bootError = e; console.error("[courses-sw] 启动失败", e); }
})();


const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", json: "application/json", mp3: "audio/mpeg", mp4: "video/mp4",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", doc: "application/msword", ppt: "application/vnd.ms-powerpoint" };
const mimeOf = (p) => MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

function makeReq(request, url, path, text, form) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  headers.host = "127.0.0.1:3000";
  const query = {};
  for (const [k, v] of url.searchParams) { if (k in query) query[k] = [].concat(query[k], v); else query[k] = v; }
  const ct = headers["content-type"] || "";
  const req = {
    method: request.method, url: path + url.search, originalUrl: path + url.search, path, headers, query, params: {},
    socket: { remoteAddress: "127.0.0.1" }, connection: { remoteAddress: "127.0.0.1" }, ip: "127.0.0.1", protocol: "http", hostname: "127.0.0.1",
    __text: text, __formData: form,
    get(h) { return headers[String(h).toLowerCase()]; }, header(h) { return headers[String(h).toLowerCase()]; },
    is(type) {
      const t = ct.split(";")[0].trim().toLowerCase(); if (!t) return false;
      const want = String(type).toLowerCase();
      if (want === "json") return t === "application/json" || t.endsWith("+json") ? t : false;
      if (want === "multipart" || want === "multipart/*") return t.startsWith("multipart/") ? t : false;
      return t === want || (want.endsWith("/*") && t.startsWith(want.slice(0, -1))) ? t : false;
    },
  };
  return req;
}
function makeRes() {
  let resolve; const done = new Promise((r) => (resolve = r));
  const listeners = {};
  const res = {
    statusCode: 200, headers: {}, body: null, headersSent: false, writableEnded: false, destroyed: false, finished: false, locals: {}, __done: done,
    status(c) { res.statusCode = c; return res; },
    set(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) res.headers[a.toLowerCase()] = String(b); } else res.headers[String(k).toLowerCase()] = String(v); return res; },
    header(k, v) { return res.set(k, v); }, setHeader(k, v) { res.headers[String(k).toLowerCase()] = String(v); return res; },
    getHeader(k) { return res.headers[String(k).toLowerCase()]; }, removeHeader(k) { delete res.headers[String(k).toLowerCase()]; },
    type(t) { res.headers["content-type"] = t.includes("/") ? t : (MIME[t] || "application/octet-stream"); return res; },
    json(o) { if (!res.headers["content-type"]) res.headers["content-type"] = "application/json; charset=utf-8"; return res.end(o === undefined ? "" : JSON.stringify(o)); },
    send(b) {
      if (b && typeof b === "object" && !(b instanceof Uint8Array)) return res.json(b);
      if (typeof b === "string" && !res.headers["content-type"]) res.headers["content-type"] = "text/html; charset=utf-8";
      return res.end(b);
    },
    sendStatus(c) { res.statusCode = c; return res.end(String(c)); },
    sendFile(p) {
      try { const d = fs.readFileSync(p); if (!res.headers["content-type"]) res.headers["content-type"] = mimeOf(p); return res.end(d); }
      catch (e) { res.statusCode = 404; return res.end(""); }
    },
    write(c) { res.body = res.body == null ? c : Buffer.concat([Buffer.from(res.body), Buffer.from(c)]); return true; },
    end(b) {
      if (res.writableEnded) return res;
      if (b != null) res.body = res.body == null ? b : Buffer.concat([Buffer.from(res.body), typeof b === "string" ? Buffer.from(b) : b]);
      res.writableEnded = res.finished = res.headersSent = true;
      emit("finish"); emit("close"); resolve(); return res;
    },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); return res; },
    once(e, f) { const g = (...a) => { res.off(e, g); f(...a); }; return res.on(e, g); },
    off(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); return res; },
    removeListener(e, f) { return res.off(e, f); }, emit(e, ...a) { emit(e, ...a); return true; },
  };
  function emit(e, ...a) { for (const f of (listeners[e] || []).slice()) { try { f(...a); } catch (x) { console.error(x); } } }
  return res;
}

const MUTATE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let chain = Promise.resolve();   // 一次只处理一个请求：数据库事务（BEGIN/COMMIT）不能交错
function serialize(fn) { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; }

async function serveApi(request, url, path) {
  await ready;
  if (bootError) return new Response(JSON.stringify({ message: "课内学习没能启动：" + (bootError.message || bootError) + "。请刷新页面重试。" }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const ct = request.headers.get("content-type") || "";
  let text = "", form = null;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (/multipart\/form-data/i.test(ct)) { const fd = await request.formData(); form = async () => fd; }
    else text = await request.text();
  }
  return serialize(async () => {
    const req = makeReq(request, url, path, text, form), res = makeRes();
    await app.__dispatch(req, res);
    let saveErr = null;
    try { sqlite.__saveAll(); await fs.__flush(); } catch (e) { saveErr = e; }
    if (saveErr) return new Response(JSON.stringify({ message: "浏览器存储空间不足，刚才的改动没有保存。请删掉一些用不到的附件后重试。" }), { status: 507, headers: { "Content-Type": "application/json; charset=utf-8" } });
    if (MUTATE.has(request.method) && res.statusCode < 400) notify();
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v != null && k !== "content-length") h.set(k, v);
    const body = [204, 304].includes(res.statusCode) || request.method === "HEAD" ? null : res.body;
    return new Response(body, { status: res.statusCode, headers: h });
  });
}
async function serveUpload(request, name) {
  await ready;
  const p = UPLOADS + "/" + decodeURIComponent(name);
  if (!/^[^/]+$/.test(decodeURIComponent(name)) || !fs.existsSync(p)) return new Response("找不到这个附件（可能还没从账号同步下来，稍等一会儿再试）", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const data = fs.readFileSync(p);
  return new Response(data, { headers: { "Content-Type": mimeOf(p), "Cache-Control": "no-cache" } });
}

// 数据库文件被同步替换时：重新打开
// （删掉 = 换了账号：换成一个空库）。换完重新跑一遍建表 / 升级，别的设备上的旧版本数据库也能升到最新
function onSyncWrite(p, data) {
  if (p !== DB_FILE) return;
  for (const d of sqlite.__all) if (d._file === p) {
    d._replace(data && data.length ? new Uint8Array(data) : null);
    try { require("./courses-server/db/schema.js").__runAll(); } catch (e) { console.error("[courses-sw] 数据库升级失败", e); }
    if (data && data.length) d._dirty = false; else d._save();
  }
}
// rest：相对 /learn/courses/ 的路径；root：网站根目录下的 /api、/uploads（课内前端里有几处写死了根路径，导图交接也用根路径）
function route(url, rest, root) {
  const p = root ? url.pathname.slice(1) : rest;
  if (p.startsWith("api/") || p === "api") return (req) => serveApi(req, url, "/" + p);
  if (p.startsWith("uploads/")) return (req) => serveUpload(req, p.slice(8));
  return null;
}
module.exports = { route, onSyncWrite, DB_FILE, UPLOADS, ready, serialize, saveAll: () => sqlite.__saveAll(), setNotify: (f) => { notify = f; } };
