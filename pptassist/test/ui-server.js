// 在浏览器里跑界面（测试用）：静态文件 + POST /call 转给 core/service.js；选文件用环境变量里给的路径
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { createService } = require("../core/service");
const port = +process.argv[2] || 8899;
const user = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), "lppt-"));
const PICK = { png: process.env.PICK_PHOTO, jpg: process.env.PICK_PHOTO, wav: process.env.PICK_VOICE, pptx: process.env.PICK_PPTX, mp4: process.env.PICK_VIDEO };
const svc = createService({
  user, documents: user, version: "test", send() {},
  pickFile: async (exts) => PICK[exts[0]] || null,
  pickDir: async (title) => (/Hunyuan/.test(title || "") ? process.env.PICK_AI3D_DIR : process.env.PICK_GSV) || null,
  openPath() {}, reveal() {}, openExternal() {},
  voiceOpt: { cmd: process.execPath, args: (p) => [path.join(__dirname, "fake-gsv.js"), String(p)], waitMs: 15000 },
  // AI 3D 形象：用这台机器的 python3 跑真的工坊（画立绘、生成 3D 这两步用假的，见 LAO3D_TEST_*）
  ai3dOpt: process.env.PICK_AI3D_PY ? { cmd: process.env.PICK_AI3D_PY } : {},
});
const ROOT = path.join(__dirname, "..", "renderer");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png" };
http.createServer((q, r) => {
  if (q.method === "POST" && q.url === "/call") {
    let b = ""; q.on("data", (c) => (b += c));
    return q.on("end", async () => {
      try {
        const { method, args } = JSON.parse(b);
        const a = args.map((x) => (x && x.__b64 ? new Uint8Array(Buffer.from(x.__b64, "base64")) : x));
        if (!Object.prototype.hasOwnProperty.call(svc.H, method)) throw new Error("不支持的操作：" + method);
        const res = await svc.H[method](...a);
        const enc = (x) => (x instanceof Uint8Array ? { __b64: Buffer.from(x).toString("base64") } : Array.isArray(x) ? x.map(enc) : x && typeof x === "object" && x.constructor === Object ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)])) : x);
        r.end(JSON.stringify({ ok: true, r: res === undefined ? null : enc(res) }));
      } catch (e) { r.end(JSON.stringify({ ok: false, e: e.message })); }
    });
  }
  const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream"); fs.createReadStream(f).pipe(r);
}).listen(port, () => console.log("ui on", port, "user", user));
