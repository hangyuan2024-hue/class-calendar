// 离线缓存（Service Worker）：只缓存网页自己的文件，不缓存任何数据接口的内容
// 2026-10-07：主题命名 v3。默认=柔和原始配色，深空蓝=高饱和蓝橙。
const CACHE = "cc-static-v30-theme-names";
const PAGES = ["./", "index.html", "app.html", "login.html"];
const EXTRA = [
  "campus-ui.css?v=20261005-campus1",
  "fonts.css?v=1",
  "fonts/fd-00.woff2",
  "fonts/bricolage.woff",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "manifest.webmanifest",
  "studio-v2.css?v=20261005-studio2",
  "workspace-v2.css?v=20261005-studio2",
  "workspace-v3.js?v=20261005-native3",
  "workspace-hotfix.css?v=20261005-fix1",
  "metaverse-v3.css?v=20261005-native3",
  "metaverse-v3.js?v=20261005-native3",
  "campus-tools.css?v=20261006-tools1",
  "campus-tools.js?v=20261006-tools1",
  "sandbox.html?v=20261006-tools1",
  "plugins/random-draw.html?v=20261006-tools1",
  "plugins/error-notebook.html?v=20261006-tools1",
  "plugins/tools.css?v=20261006-tools1",
  "plugins/vendor/pako_inflate.min.js?v=1.0.11",
  "auxiliary-v2.css?v=20261005-studio2",
  "embedded-auth-v2.css?v=20261005-studio2",
  "landing-v2.js?v=20261005-studio2"
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
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
  if (req.mode === "navigate") {
    const key = pageKey(url);
    e.respondWith((async () => {
      const hit = await caches.match(key);
      const net = fetch(url.href, { cache: "no-cache", credentials: "same-origin" });
      if (hit) {
        e.waitUntil(net.then((res) => (res.ok && res.type === "basic" ? notifyIfChanged(key, res) : null)).catch(() => {}));
        return hit;
      }
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
