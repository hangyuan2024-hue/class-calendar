// 大文件下载：分段并行（每条连接限速的网络）、断了接着下、服务器不支持分段就照旧、链接过期就报错；
// 自己传过的存档留在本机，任务回来时核对一样就不再下载
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const Agent = require("../worker/agent");

const ok = (m) => console.log("✓ " + m);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xfer-"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

(async () => {
  const MB = 1048576;
  const big = crypto.randomBytes(40 * MB), small = crypto.randomBytes(3 * MB);
  const bigSha = crypto.createHash("sha256").update(big).digest("hex");
  const etagOf = (b) => '"' + crypto.createHash("md5").update(b).digest("hex") + '"';
  const files = { "/big": big, "/small": small };
  const S = { perConnKBps: 1024, ranges: true, reqs: 0, rangeReqs: 0, resetEvery: 0, forbid: false, served: 0 };
  // 假的存储：每条连接限速（像跨境线路）；可以关掉分段、可以时不时断开连接、可以让链接过期
  const srv = http.createServer((q, r) => {
    S.reqs++; if (q.headers.range === "bytes=0-0") S.probes = (S.probes || 0) + 1;
    if (S.starts) { const m0 = /bytes=(\d+)-/.exec(q.headers.range || ""); if (m0) S.starts.push(+m0[1]); }
    const u = new URL(q.url, "http://x");
    if (u.pathname === "/redirect") { r.writeHead(302, { location: "/big" }); return r.end(); }
    const b = files[u.pathname]; if (!b) { r.statusCode = 404; return r.end(); }
    if (S.forbid && q.headers.range && q.headers.range !== "bytes=0-0") { r.statusCode = 403; return r.end("<Code>AccessDenied</Code>"); }
    let a = 0, e = b.length - 1, code = 200;
    const m = /bytes=(\d+)-(\d*)/.exec(q.headers.range || "");
    if (m && S.ranges) { a = +m[1]; e = m[2] ? Math.min(+m[2], b.length - 1) : b.length - 1; code = 206; S.rangeReqs++; }
    r.writeHead(code, { "content-length": e - a + 1, etag: etagOf(b), ...(code === 206 ? { "content-range": `bytes ${a}-${e}/${b.length}` } : {}) });
    if (q.method === "HEAD") return r.end();
    let pos = a, sent = 0;
    const step = Math.max(1024, Math.round((S.perConnKBps * 1024) / 20));
    const t = setInterval(() => {
      if (r.destroyed) return clearInterval(t);
      const n = Math.min(step, e + 1 - pos);
      if (S.resetEvery && sent > 0 && Math.random() < 1 / S.resetEvery) { clearInterval(t); return r.socket.destroy(); }   // 中途断开
      r.write(b.subarray(pos, pos + n)); pos += n; sent += n; S.served += n;
      if (pos > e) { clearInterval(t); r.end(); }
    }, 50);
    r.on("close", () => clearInterval(t));
  });
  await new Promise((ok_) => srv.listen(0, "127.0.0.1", ok_));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const reset = () => Object.assign(S, { reqs: 0, rangeReqs: 0, served: 0 });

  // 1. 每条连接 1M/秒：40M 的文件一条连接要 40 秒；6 条一起下 7 秒左右
  reset();
  let f = path.join(tmp, "a.bin"), t0 = Date.now(), last = 0;
  await Agent.xfer("GET", base + "/big", f, { onProgress: (g, tot) => { assert.ok(g <= tot); last = g; } });
  const secs = (Date.now() - t0) / 1000;
  assert.equal(sha(f), bigSha); assert.equal(last, big.length);
  assert.ok(secs < 15, `分段并行应该比一条连接（40 秒）快很多，用了 ${secs.toFixed(1)} 秒`);
  assert.ok(S.rangeReqs >= 5, "分成了好几段（40M ÷ 8M = 5 块）");
  assert.ok(!fs.existsSync(f + ".part") && !fs.existsSync(f + ".parts.json"), "下完把临时文件清掉");
  ok(`分段并行：每条连接限 1M/秒，40M 用了 ${secs.toFixed(1)} 秒（一条连接要 40 秒），内容一字不差`);

  // 2. 跳转过去的地址（调度中心 → 存储）也能分段
  reset(); f = path.join(tmp, "r.bin");
  await Agent.xfer("GET", base + "/redirect", f);
  assert.equal(sha(f), bigSha);
  ok("先跳转再分段下载");

  // 3. 下到一半停了（电脑要用了 / 程序关了）：再下的时候已经下好的块不再下
  reset(); f = path.join(tmp, "b.bin"); Agent.setParallel({ chunk: 2 * MB });
  const ctl = new AbortController();
  let cut = false;
  await assert.rejects(Agent.xfer("GET", base + "/big", f, { signal: ctl.signal, onProgress: (g) => { if (!cut && g > 20 * MB) { cut = true; ctl.abort(); } } }));
  const meta = JSON.parse(fs.readFileSync(f + ".parts.json", "utf8"));
  assert.ok(meta.done.length >= 1, "记下了下好的块");
  await new Promise((r) => setTimeout(r, 1000)); reset(); S.starts = [];
  let firstGot = -1;
  await Agent.xfer("GET", base + "/big", f, { onProgress: (g) => { if (firstGot < 0) firstGot = g; } });
  assert.equal(sha(f), bigSha);
  const again = S.starts.filter((x) => x > 0 && meta.done.includes(x / (2 * MB)));
  assert.deepEqual(again, [], "下好的块不再要");
  assert.ok(firstGot >= meta.done.length * 2 * MB, "进度从上次下好的地方开始");
  S.starts = null;
  Agent.setParallel({ chunk: 8 * MB });
  ok(`断了接着下：上次下好 ${meta.done.length} 块（${meta.done.length * 2}M），这次一块都没重下`);

  // 4. 网络时不时断开：每块自己重试，最后文件完整
  reset(); S.resetEvery = 25; S.perConnKBps = 4096; f = path.join(tmp, "c.bin");
  Agent.setParallel({ tries: 30 });
  await Agent.xfer("GET", base + "/big", f);
  assert.equal(sha(f), bigSha);
  S.resetEvery = 0; Agent.setParallel({ tries: 10 });
  ok("下的时候连接老被断开：每块自己重试，最后完整");

  // 5. 服务器不支持分段：照旧一条连接下
  reset(); S.ranges = false; f = path.join(tmp, "d.bin");
  await Agent.xfer("GET", base + "/big", f);
  assert.equal(sha(f), bigSha); assert.equal(S.rangeReqs, 0); assert.equal(S.reqs, 1, "一个请求");
  S.ranges = true;
  ok("服务器不支持分段：照旧一条连接下");

  // 6. 小文件（8M 以下）：一个请求下完
  reset(); f = path.join(tmp, "e.bin");
  await Agent.xfer("GET", base + "/small", f);
  assert.ok(fs.readFileSync(f).equals(small)); assert.equal(S.reqs, 1);
  ok("8M 以下的文件：一个请求就下完（不多一个来回）");

  // 7. 链接过期（403）：马上报错，不傻等重试
  reset(); S.forbid = true; f = path.join(tmp, "g.bin"); t0 = Date.now();
  await assert.rejects(Agent.xfer("GET", base + "/big", f), /403/);
  assert.ok(Date.now() - t0 < 5000);
  S.forbid = false;
  ok("链接过期（403）：马上报错");

  // 8. 自己传过的存档留在本机（最近 2 个）；任务回来时和服务器核对一样就直接用，不一样（被别的电脑覆盖了）就照常下载
  const a = Agent.create({ server: base, token: "x", workDir: path.join(tmp, "w"), noLoop: true });
  const ck = a._ckpt;
  const mk = (name, b) => { const p_ = path.join(tmp, name); fs.writeFileSync(p_, b); return p_; };
  ck.keep(mk("s1", small), "jobs/1/2/ckpt-100-x.pt");
  await new Promise((r) => setTimeout(r, 20));
  ck.keep(mk("s2", crypto.randomBytes(1000)), "jobs/1/2/ckpt-200-x.pt");
  await new Promise((r) => setTimeout(r, 20));
  ck.keep(mk("s3", big), "jobs/1/2/ckpt-300-x.pt");
  const left = fs.readdirSync(ck.dir).sort();
  assert.deepEqual(left, ["jobs_1_2_ckpt-200-x.pt", "jobs_1_2_ckpt-300-x.pt"], "只留最近 2 个");
  await new Promise((r) => setTimeout(r, 1500)); reset(); S.probes = 0;
  assert.ok(await ck.cached("jobs/1/2/ckpt-300-x.pt", base + "/big"), "和服务器上一样（大小、MD5）：直接用");
  const before = S.served; await new Promise((r) => setTimeout(r, 300)); assert.ok(S.served - before < 10 && S.probes === 1, "核对只要了 1 个字节：" + S.served + " / " + S.probes);
  assert.equal(await ck.cached("jobs/1/2/ckpt-200-x.pt", base + "/big"), null, "大小对不上：不用，照常下载");
  fs.writeFileSync(path.join(ck.dir, "jobs_1_2_ckpt-300-x.pt"), Buffer.concat([big.subarray(0, big.length - 1), Buffer.from([big[big.length - 1] ^ 1])]));
  assert.equal(await ck.cached("jobs/1/2/ckpt-300-x.pt", base + "/big"), null, "大小一样但内容不一样（MD5 对不上）：不用");
  assert.equal(await ck.cached("jobs/1/2/ckpt-999-x.pt", base + "/big"), null, "本机没有：照常下载");
  try { a.stop && a.stop(); } catch (e) {}
  ok("自己的存档留在本机最近 2 个；任务回来时核对大小和 MD5，一样就不下载，不一样照常下");

  // 9. 旧版调度中心（本机存储）不按文件大小截范围：小文件回「0-8M」、长度写错、发完就断。新客户端也得下对，不能去要「2253-2252」这种
  {
    const tiny = crypto.randomBytes(2253);
    const old = http.createServer((q, r) => {
      const m0 = /bytes=(\d+)-(\d*)/.exec(q.headers.range || "");
      if (!m0) { r.writeHead(200, { "content-length": tiny.length }); return r.end(tiny); }
      const a0 = +m0[1], z0 = m0[2] ? +m0[2] : tiny.length - 1;
      if (a0 > z0) { r.destroy(); throw new Error("客户端要了不可能的范围 " + q.headers.range); }
      r.writeHead(206, { "content-length": z0 - a0 + 1, "content-range": `bytes ${a0}-${z0}/${tiny.length}` });
      r.write(tiny.subarray(a0, z0 + 1)); setTimeout(() => r.socket.destroy(), 30);
    });
    await new Promise((ok_) => old.listen(0, "127.0.0.1", ok_));
    const ft = path.join(tmp, "tiny.bin");
    await Agent.xfer("GET", `http://127.0.0.1:${old.address().port}/t`, ft);
    assert.ok(fs.readFileSync(ft).equals(tiny));
    old.close();
  }
  // 10. 新版调度中心（本机存储）：范围超过文件大小按实际大小给；起点超了回 416；不会崩
  {
    const Server = require("../server/index");
    const app = Server.create({ data: path.join(tmp, "srv"), noTick: true });
    const port = await app.listen(0, "127.0.0.1");
    const key = "jobs/1/2/x.bin", body = crypto.randomBytes(2253);
    let r = await fetch(app.store.url("PUT", key, 600).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`), { method: "PUT", body });
    assert.equal(r.status, 200);
    const gu = app.store.url("GET", key, 600).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`);
    r = await fetch(gu, { headers: { range: "bytes=0-8388607" } });
    assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), "bytes 0-2252/2253"); assert.ok(Buffer.from(await r.arrayBuffer()).equals(body));
    r = await fetch(gu, { headers: { range: "bytes=2253-2252" } }); assert.equal(r.status, 416); await r.arrayBuffer();
    r = await fetch(gu, { headers: { range: "bytes=9999-" } }); assert.equal(r.status, 416); await r.arrayBuffer();
    const fb = path.join(tmp, "via-server.bin");
    await Agent.xfer("GET", gu, fb); assert.ok(fs.readFileSync(fb).equals(body));
    r = await fetch(`http://127.0.0.1:${port}/api/ping`); assert.ok(r.status < 500, "调度中心还活着");
    app.close();
  }
  ok("小文件和旧版调度中心：范围不截也能下对；新版调度中心按实际大小给、不可能的范围回 416、不会崩");

  srv.close();
  console.log("大文件下载：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
