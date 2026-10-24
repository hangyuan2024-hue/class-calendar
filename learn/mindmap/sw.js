// 6.8 版思维导图的 Service Worker 只管 learn/mindmap/；新版改由 learn/sw.js 统一管理捞捞学习（思维导图 + 课内学习）。
// 这个文件留着只做一件事：浏览器来检查更新时，把旧的注销掉，再刷新页面，让新的接手。导图数据会被新版自动搬过去（见 learn/runtime/memfs.js）。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  await self.registration.unregister();
  const list = await self.clients.matchAll({ type: "window" });
  for (const c of list) { try { c.navigate(c.url); } catch (err) {} }
})()));
