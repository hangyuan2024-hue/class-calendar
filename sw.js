// 离线缓存（Service Worker）：只缓存网页自己的文件，不缓存任何数据接口的内容
// 2026-10-08：注册时选择学校 / 单位；界面细节打磨（字号、焦点、图标）。
const CACHE = "cc-static-v114-rank";   // 7.6：首页宣传视频（laolao-promo-*）、捞捞学习（learn-*）的缓存各自管，这里不删
const PAGES = ["./", "index.html", "app.html", "login.html"];
const EXTRA = [
  "campus-ui.css?v=20261008-org1",
  "fonts.css?v=1",
  "fonts/fd-00.woff2",
  "fonts/bricolage.woff",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "manifest.webmanifest",
  "studio-v2.css?v=20261008-org1",
  "workspace-v2.css?v=20261008-org1",
  "workspace-v3.js?v=20261005-native3",
  "workspace-hotfix.css?v=20261005-fix1",
  "metaverse-v3.css?v=20261008-org1",
  "metaverse-v3.js?v=20261005-native3",
  "campus-tools.css?v=20261008-org1",
  "campus-tools.js?v=20261006-tools1",
  "sandbox.html?v=20261018-v64",
  "plugins/random-draw.html?v=20261018-v64",
  "plugins/error-notebook.html?v=20261006-tools1",
  "plugins/tools.css?v=20261006-tools1",
  "plugins/vendor/pako_inflate.min.js?v=1.0.11",
  "auxiliary-v2.css?v=20261008-org1",
  "embedded-auth-v2.css?v=20261008-org1",
  "landing-v2.js?v=20261005-studio2",
  "i18n.js?v=20261030-v717",
  "i18n-en.js?v=20261030-v717",
  "home-v6.css?v=20261019-v65",
  "home-v6.js?v=20261023-v716",
  "home-v8.css?v=20261023-v716",
  "workspace-fit.css?v=20261023-v714",
  "site-account.js?v=20261023-v700",
  "home-v8.js?v=20261023-v711",
  "site-config.js?v=20261028-v77",
  "org.css?v=20261008-org1",
  "org.js?v=20261008-org1",
  "auth-polish.css?v=20261008-org1",
  "polish.css?v=20261009-tl2",
  "live.js?v=20261009-live1"
];

async function precache() {
  const c = await caches.open(CACHE);
  const urls = new Set(EXTRA);
  for (const p of PAGES) {
    try {
      const res = await fetch(new Request(p, { cache: "reload" }));
      if (!res.ok) continue;
      await c.put(p, res.clone());
      const html = await res.text();
      for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"#:]+)"/g)) {
        if (/\.(?:js|css)(?:\?|$)/.test(m[1])) urls.add(m[1]);
      }
    } catch (e) {}
  }
  await Promise.all([...urls].map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
}

self.addEventListener("install", (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !k.startsWith("laolao-promo") && !k.startsWith("learn-")).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIC = /\.(?:html|js|css|woff2?|png|jpe?g|svg|webp|ico|webmanifest)$/i;
function withTimeout(p, ms) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); }); }
async function put(key, res) {
  if (res && res.ok && res.type === "basic") { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
  return res;
}
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
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (/\/(rest|auth|storage|functions)\/v1\//.test(url.pathname) || url.pathname.endsWith("/sw.js") || url.pathname.includes("/download/")) return;
  // 7.6.3 捞捞学习（learn/）、捞捞编程（code/）是单独的网页应用，有自己的 Service Worker 和更新方式，这里一概不管。
  // 以前这里把它们的 js / css 也按「先用缓存」存了：网站更新后，新页面配上旧脚本，思维导图、课内学习打开一片空白
  if (/^(learn|code)\//.test(url.pathname.slice(new URL("./", self.registration.scope).pathname.length))) return;
  // 6.10 打开网页：先从网上拿最新版（4 秒内拿到就用新的，网站更新后第一次打开就是新版）；
  //      断网、网太慢才用这台设备上存着的那份。以前是先给旧的、后台再更新，每次更新都要刷新两遍
  if (req.mode === "navigate") {
    const key = pageKey(url);
    e.respondWith((async () => {
      const net = fetch(url.href, { cache: "no-cache", credentials: "same-origin" });
      try {
        const res = await withTimeout(net, 4000);
        if (res.ok && res.type === "basic") { e.waitUntil(put(key, res.clone())); return res; }
        if (res.status < 500) return res;
      } catch (err) {}
      const hit = await caches.match(key);
      if (hit) { e.waitUntil(net.then((res) => (res.ok && res.type === "basic" ? notifyIfChanged(key, res) : null)).catch(() => {})); return hit; }
      try { return await put(key, await withTimeout(net, 15000)); }
      catch (err) { return (await caches.match(url.origin + "/index.html")) || (await caches.match(url.origin + "/")) || Response.error(); }
    })());
    return;
  }
  if (!STATIC.test(url.pathname)) return;
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
    if (hit) {
      if (!url.search) e.waitUntil(net);
      return hit;
    }
    return net;
  }));
});
