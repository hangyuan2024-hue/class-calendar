// 测试用的假腾讯云 COS（S3 路径式地址：/<桶>/<文件>）：存在内存里，支持 PUT / GET / HEAD / 分段下载；可以让它拒绝写入（模拟策略没配对）
// 单独跑：node test/fake_s3.js 9912   （给别的测试当 GRID_COS_ENDPOINT 用）
"use strict";
const http = require("http");
const crypto = require("crypto");

function create() {
  const objs = new Map(), types = new Map();   // 和真的 COS 一样：上传时带的类型下载时原样给
  const S = { denyPut: false, log: [] };
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x");
    const key = decodeURIComponent(u.pathname.replace(/^\/[^/]+\//, ""));   // 去掉桶名
    S.log.push(q.method + " " + key + (q.headers.range ? " " + q.headers.range : ""));
    if (!u.searchParams.get("X-Amz-Signature")) { r.statusCode = 403; return r.end("<Error><Code>AccessDenied</Code></Error>"); }
    if (q.method === "PUT") {
      if (S.denyPut) { q.resume(); return q.on("end", () => { r.statusCode = 403; r.end("<Error><Code>AccessDenied</Code></Error>"); }); }
      const cs = []; q.on("data", (c) => cs.push(c)); q.on("end", () => { const b = Buffer.concat(cs); objs.set(key, b); types.set(key, q.headers["content-type"] || "application/octet-stream"); r.setHeader("etag", '"' + crypto.createHash("md5").update(b).digest("hex") + '"'); r.end(); });
      return;
    }
    const b = objs.get(key);
    if (!b) { r.statusCode = 404; return r.end("<Error><Code>NoSuchKey</Code></Error>"); }
    const et = '"' + crypto.createHash("md5").update(b).digest("hex") + '"';
    const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || "");
    if (m) {
      const a = +m[1], z = Math.min(m[2] ? +m[2] : b.length - 1, b.length - 1);
      if (a > z) { r.writeHead(416, { "content-range": `bytes */${b.length}` }); return r.end(); }
      r.writeHead(206, { "content-type": types.get(key), "content-length": z - a + 1, "content-range": `bytes ${a}-${z}/${b.length}`, etag: et });
      return r.end(q.method === "HEAD" ? undefined : b.subarray(a, z + 1));
    }
    r.writeHead(200, { "content-type": types.get(key), "content-length": b.length, etag: et });
    r.end(q.method === "HEAD" ? undefined : b);
  });
  return {
    objs, S,
    listen: (port = 0) => new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok(srv.address().port))),
    close: () => srv.close(),
  };
}
module.exports = { create };

if (require.main === module) {
  const f = create();
  f.listen(+process.argv[2] || 9912).then((p) => console.log("假 COS：http://127.0.0.1:" + p));
}
