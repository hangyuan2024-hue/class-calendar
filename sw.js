// 离线缓存（Service Worker）：只缓存网页自己的文件，不缓存任何数据接口的内容
// - 打开页面：先联网拿最新版，4 秒没拿到或断网时用缓存，保证更新能马上生效、没网也能打开
// - 脚本、字体等文件：先用缓存秒开，后台再悄悄更新
const CACHE = "cc-static-v4";
const PRECACHE = ["./", "index.html", "login.html", "boot.js", "guard.js", "auth.js", "config.js", "parse.js", "courses.js", "app.js", "login.js", "sandbox.html", "display.woff", "favicon.svg", "favicon-32.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIC = /\.(?:html|js|css|woff2?|png|jpe?g|svg|webp|ico)$/i;
function fromNetwork(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = timeoutMs ? setTimeout(() => reject(new Error("timeout")), timeoutMs) : 0;
    fetch(req).then((res) => { clearTimeout(t); resolve(res); }, (err) => { clearTimeout(t); reject(err); });
  });
}
async function put(req, res) {
  if (res && res.ok && res.type === "basic") { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;            // 数据库、扣子等外部请求一律不碰
  if (/\/(rest|auth|storage|functions)\/v1\//.test(url.pathname) || url.pathname.endsWith("/sw.js")) return;
  if (req.mode === "navigate") {
    e.respondWith(fromNetwork(req, 4000).then((res) => put(req, res)).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (await caches.match("index.html")) || Response.error()));
    return;
  }
  if (!STATIC.test(url.pathname)) return;
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  }));
});
