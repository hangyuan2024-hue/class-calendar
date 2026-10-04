// 离线缓存（Service Worker）：只缓存网页自己的文件，不缓存任何数据接口的内容
// - 打开页面：有缓存就立刻用缓存打开（几乎不用等），同时在后台拿最新版；拿到新版就提示「有新版本」，下次打开就是新的
// - 第一次打开、还没缓存时：照常联网
// - 脚本、样式、字体：文件名带版本号，先用缓存秒开，后台再悄悄更新
// - 装好时：把首页、登录页里引用的脚本和样式（带版本号的真实地址）提前存好
const CACHE = "cc-static-v18";
const PAGES = ["./", "index.html", "app.html", "login.html"];
const EXTRA = ["fonts.css?v=1", "fonts/fd-00.woff2", "fonts/bricolage.woff", "favicon.svg", "favicon-32.png", "apple-touch-icon.png", "manifest.webmanifest"];

async function precache() {
  const c = await caches.open(CACHE);
  const urls = new Set(EXTRA);
  for (const p of PAGES) {
    try {
      const res = await fetch(new Request(p, { cache: "reload" }));
      if (!res.ok) continue;
      await c.put(p, res.clone());
      const html = await res.text();
      // 页面里引用的本站脚本、样式（带 ?v= 的真实地址）
      for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"#:]+)"/g)) {
        if (/\.(?:js|css)(?:\?|$)/.test(m[1])) urls.add(m[1]);
      }
    } catch (e) {}
  }
  await Promise.all([...urls].map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
}

self.addEventListener("install", (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIC = /\.(?:html|js|css|woff2?|png|jpe?g|svg|webp|ico|webmanifest)$/i;
function withTimeout(p, ms) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); }); }
async function put(key, res) {
  if (res && res.ok && res.type === "basic") { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
  return res;
}
// 页面地址去掉 ?guest=1 这类参数再存，同一个页面只存一份
const pageKey = (url) => url.origin + url.pathname;

async function notifyIfChanged(key, fresh) {
  try {
    const old = await caches.match(key);
    const [a, b] = await Promise.all([old ? old.clone().text() : "", fresh.clone().text()]);
    await put(key, fresh);
    if (old && a !== b) {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      list.forEach((c) => c.postMessage("cc-updated"));
    }
  } catch (e) {}
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;            // 数据库、扣子等外部请求一律不碰
  if (/\/(rest|auth|storage|functions)\/v1\//.test(url.pathname) || url.pathname.endsWith("/sw.js") || url.pathname.includes("/download/")) return;
  if (req.mode === "navigate") {
    const key = pageKey(url);
    e.respondWith((async () => {
      const hit = await caches.match(key);
      const net = fetch(url.href, { cache: "no-cache", credentials: "same-origin" });      // 跟服务器核对一下有没有新版（没变时只回一个很小的 304）
      if (hit) {                                                                     // 有缓存：立刻打开，后台更新
        e.waitUntil(net.then((res) => (res.ok && res.type === "basic" ? notifyIfChanged(key, res) : null)).catch(() => {}));
        return hit;
      }
      try { return await put(key, await withTimeout(net, 15000)); }                    // 没缓存：联网
      catch (err) { return (await caches.match(url.origin + "/index.html")) || (await caches.match(url.origin + "/")) || Response.error(); }
    })());
    return;
  }
  if (!STATIC.test(url.pathname)) return;
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
    if (hit) {
      // 带版本号的文件内容不会变，不用再问服务器；不带版本号的，后台更新一下
      if (!url.search) e.waitUntil(net);
      return hit;
    }
    return net;
  }));
});
