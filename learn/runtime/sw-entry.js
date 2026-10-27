// 捞捞学习 · 网页版的 Service Worker（learn/sw.js，管 /learn/ 下面所有页面）
// 两个工具原来都要在电脑上开一个本机服务：思维导图（node server.js，8794）、课内学习（node back/server.js，3000）。
// 网站上没有这些服务，这里在浏览器里跑同一套代码，数据存在本浏览器的 IndexedDB（learn-fs），登录后由 learn-sync.js 备份到账号。
// 两个工具在同一个 Service Worker 里，「在导图中编辑」的交接（/api/mindmap-handoffs）可以直接互通。
"use strict";
self.__MEMFS_NAME = "learn-fs";
self.__MEMFS_IMPORT = ["mm-fs"];                    // 6.8 版思维导图的数据（见 memfs.js）
try { importScripts("courses/vendor/sqljs/sql-wasm.js"); } catch (e) { console.error("[learn-sw] 数据库组件加载失败", e); }
const fs = require("node:fs");
fs.__ready = fs.__load().catch((e) => { console.error("[learn-sw] 读取本地存储失败", e); });
const mindmap = require("./mindmap-part.js");
const courses = require("./courses-part.js");
const sync = require("./sync-sw.js")({
  roots: ["/app/storage/", courses.DB_FILE, courses.UPLOADS + "/"],
  skip: /\/\.draft\//,
  onWrite: (p, data) => courses.onSyncWrite(p, data),
});
mindmap.setNotify(sync.notify);
courses.setNotify(sync.notify);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL("./", self.registration.scope).pathname;   // /learn/
  const path = url.pathname;
  if (/\/api\/__sync\/[a-z]+$/.test(path) && path.startsWith(base)) {
    event.respondWith(fs.__ready.then(() => courses.ready).then(() => courses.serialize(() => { courses.saveAll(); return sync.handle(event.request, url); })));
    return;
  }
  let h = null;
  if (path.startsWith(base + "mindmap/")) h = mindmap.route(url, path.slice(base.length + 8));
  else if (path.startsWith(base + "courses/")) h = courses.route(url, path.slice(base.length + 8), false);
  else if (!path.startsWith(base) && /^\/(api|uploads)\//.test(path)) {
    // 网站根目录的 /api、/uploads：只有 /learn/ 下的页面发出的请求才会到这里（课内前端有几处写死了根路径；导图交接也走根路径）
    h = courses.route(url, "", true);
  }
  if (h) { event.respondWith(h(event.request)); return; }
  // 7.6.2 网站在海外，国内有时连得很慢：页面和静态文件先上网拿最新的，5 秒（页面 8 秒）没回来就用上次存下的
  if (event.request.method === "GET" && path.startsWith(base) && (event.request.mode === "navigate" || STATIC_RE.test(path))) {
    event.respondWith(netFirst(event.request, event.request.mode === "navigate" ? 8000 : 5000));
  }
});

const STATIC_CACHE = "learn-static-v1";
const STATIC_RE = /\.(?:js|mjs|cjs|css|wasm|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|json|html)$/i;
async function netFirst(req, ms) {
  let cache = null;
  try { cache = await caches.open(STATIC_CACHE); } catch (e) { return fetch(req); }
  const net = fetch(req).then((r) => {
    if (r && r.ok && r.type === "basic") cache.put(req, r.clone()).catch(() => {});
    return r;
  });
  const hit = await cache.match(req, { ignoreVary: true }).catch(() => null);
  if (!hit) return net;
  return Promise.race([net.catch(() => hit), new Promise((res) => setTimeout(() => res(hit), ms))]);
}
