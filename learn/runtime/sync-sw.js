// 账号同步（Service Worker 这一侧）：页面里的 learn-sync.js 通过这几个接口读写虚拟磁盘里的文件，
// 再跟捞捞账号里的 learn_files 表对比、上传、下载。只同步 roots 下面的文件（导图、课程数据库、附件），不同步设置和临时文件。
//   GET    api/__sync/manifest      → [{ p, sha, size, t }]
//   GET    api/__sync/file?p=…      → 文件内容
//   PUT    api/__sync/file?p=…      → 写入（从账号下载下来的）
//   DELETE api/__sync/file?p=…      → 删除
"use strict";
const fs = require("node:fs");
const { sha256 } = require("./crypto.js");
const { Buffer } = require("./buffer.js");

module.exports = function createSync({ roots, skip, onWrite }) {
  const shaCache = new Map();   // 路径 → { mtime, size, sha }
  const want = (p) => roots.some((r) => p.startsWith(r)) && !(skip && skip.test(p));
  const canWrite = (p) => want(p) || p.startsWith("/app/backup/");   // 同步时被覆盖的旧文件留一份在这里（不再同步）
  function shaOf(p, rec) {
    const c = shaCache.get(p);
    if (c && c.mtime === rec.mtime && c.size === rec.data.length && c.data === rec.data) return c.sha;
    const h = Buffer.from(sha256(rec.data)).toString("hex");
    shaCache.set(p, { mtime: rec.mtime, size: rec.data.length, sha: h, data: rec.data });
    return h;
  }
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  function parentDirs(p) { const d = p.slice(0, p.lastIndexOf("/")); if (d) fs.mkdirSync(d, { recursive: true }); }
  async function handle(request, url) {
    const sub = url.pathname.slice(url.pathname.indexOf("/api/__sync/") + 12);
    if (sub === "manifest") {
      const out = [];
      for (const [p, rec] of fs.__files) if (want(p)) out.push({ p, sha: shaOf(p, rec), size: rec.data.length, t: rec.mtime });
      return json(out);
    }
    if (sub !== "file") return json({ error: "没有这个接口" }, 404);
    const p = url.searchParams.get("p") || "";
    if (!canWrite(p) || /(^|\/)\.\.(\/|$)/.test(p)) return json({ error: "不能同步这个文件" }, 400);
    if (request.method === "GET") {
      const rec = fs.__files.get(p);
      if (!rec) return json({ error: "没有这个文件" }, 404);
      return new Response(rec.data, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
    }
    if (request.method === "PUT") {
      const data = Buffer.from(new Uint8Array(await request.arrayBuffer()));
      parentDirs(p); fs.writeFileSync(p, data);
      if (onWrite) await onWrite(p, data);
      await fs.__flush();
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      if (onWrite) await onWrite(p, null);
      await fs.__flush();
      return json({ ok: true });
    }
    return json({ error: "不支持" }, 405);
  }
  // 有改动时告诉页面（learn-sync.js 会稍等一下再同步）
  async function notify() {
    try { const list = await self.clients.matchAll({ includeUncontrolled: false }); for (const c of list) c.postMessage({ learnSync: "dirty" }); } catch (e) {}
  }
  return { handle, notify, want };
};
