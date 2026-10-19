// 测试用：不开 Electron，用 Node 跑 core/service.js，把界面放进浏览器（Playwright）里点。
//   node test/ui-server.js [端口] [数据目录]
// 界面里的 window.cc 由测试注入（fetch /call、EventSource /events）；index.html 的 CSP 在这里去掉，只为测试。
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { createService } = require("../core/service");
const PORT = +process.argv[2] || 8790;
const DATA = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), "lc-ui-"));
const clients = new Set();
const svc = createService({
  dev: true, res: path.join(__dirname, "..", "resources"), user: path.join(DATA, "user"), documents: path.join(DATA, "docs"), version: "test",
  send: (ch, data) => { const s = `data: ${JSON.stringify({ ch, data })}\n\n`; for (const c of clients) c.write(s); },
  pickDir: async () => null, pickFile: async () => null, trash: async (f) => fs.rmSync(f, { force: true }), reveal() {}, openPath() {}, openExternal() {},
});
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (u.pathname === "/call" && req.method === "POST") {
    let b = ""; for await (const c of req) b += c;
    const { method, args } = JSON.parse(b);
    try { if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method); const r = await svc.H[method](...(args || [])); res.end(JSON.stringify({ ok: true, r: r === undefined ? null : r })); }
    catch (e) { res.end(JSON.stringify({ ok: false, e: e.message })); }
    return;
  }
  const f = path.join(__dirname, "..", "renderer", u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!f.startsWith(path.join(__dirname, "..", "renderer")) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (f.endsWith("index.html")) body = String(body).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(body);
}).listen(PORT, () => console.log("ui-server http://localhost:" + PORT + "  数据：" + DATA));
svc.boot();
