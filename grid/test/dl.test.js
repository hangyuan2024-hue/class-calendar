// 下载门口：只给中国大陆的 IP、转到 COS 的临时链接；海外不给；刹车（单 IP、同一文件反复下、全站一天的量）；记账
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Server = require("../server/index");
const G = require("../server/dlgate");
const ok = (m) => console.log("✓ " + m);

(async () => {
  // ---------- IP 段 ----------
  const L = G.parseList("1.2.0.0/16\n1.2.3.0/24\n1.4.0.0/15\n# 注释\n2400:da00::/32\n");
  assert.deepStrictEqual(L.v4.map((r) => r.map((x) => x >>> 0)), [[G.v4n("1.2.0.0"), G.v4n("1.2.255.255")], [G.v4n("1.4.0.0"), G.v4n("1.5.255.255")]]);
  assert.ok(G.inRanges(L.v4, G.v4n("1.5.200.1")) && !G.inRanges(L.v4, G.v4n("1.3.0.0")));
  assert.ok(G.inRanges(L.v6, G.v6n("2400:da00:1::8")) && !G.inRanges(L.v6, G.v6n("2400:db00::1")));
  assert.equal(G.v6n("::ffff:1.2.3.4"), (0xffffn << 32n) + BigInt(G.v4n("1.2.3.4")));
  assert.equal(G.cleanIp("::ffff:223.5.5.5"), "223.5.5.5");
  const g0 = G.create({ env: {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "dl0-")), noRefresh: true });
  const R = (ip) => g0.region(ip);
  assert.deepStrictEqual(["114.114.114.114", "223.5.5.5", "240e:1::1", "8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "127.0.0.1", "192.168.1.2"].map(R), ["CN", "CN", "CN", "XX", "XX", "XX", "LAN", "LAN"]);
  g0.close();
  ok("国内 IP 段（IPv4 + IPv6）：国内的电信 / 阿里 / 腾讯 DNS 是 CN，谷歌、Cloudflare 是海外，局域网放行");

  // ---------- 门口 ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
  const SIZE = { "code/LaolaoCode-Setup-1.0.24.exe": 1.5 * 1024 ** 3, "ai/models/x.safetensors": 1024 ** 3, "android/a.apk": 7e6 };
  let heads = 0;
  const app = Server.create({ data: tmp, noTick: true, env: { DL_COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com", DL_COS_REGION: "ap-guangzhou", DL_COS_BUCKET: "b-1", DL_COS_KEY_ID: "k", DL_COS_SECRET: "s", DL_DAILY_GB: "6", DL_IP_GB: "3.5", DL_REPEAT: "2" },
    gate: { noRefresh: true, flushMs: 50, fetch: async (u, o) => { heads++; assert.equal(o.method, "HEAD"); const key = decodeURIComponent(new URL(u).pathname.slice(1)); return SIZE[key] ? { ok: true, status: 200, headers: { get: () => String(SIZE[key]) } } : { ok: false, status: 404, headers: { get: () => null } }; } } });
  const port = await app.listen(0, "127.0.0.1");
  const get = (key, ip, h = {}, method = "GET") => fetch(`http://127.0.0.1:${port}/dl/${key}`, { method, redirect: "manual", headers: { "x-forwarded-for": "10.9.9.9, " + ip, ...h } });

  let r = await get("code/LaolaoCode-Setup-1.0.24.exe", "223.5.5.5");
  assert.equal(r.status, 302); const loc = new URL(r.headers.get("location"));
  assert.equal(loc.host, "b-1.cos.ap-guangzhou.myqcloud.com"); assert.equal(loc.pathname, "/code/LaolaoCode-Setup-1.0.24.exe"); assert.equal(loc.searchParams.get("X-Amz-Expires"), String(6 * 3600)); assert.ok(loc.searchParams.get("X-Amz-Signature"));
  r = await get("code/LaolaoCode-Setup-1.0.24.exe", "8.8.8.8"); assert.equal(r.status, 403); assert.match(await r.text(), /只对中国大陆开放[\s\S]*github\.com/);
  r = await get("ai/models/x.safetensors", "2001:4860:4860::8888"); assert.equal(r.status, 403);
  r = await get("grid/jobs/1/secret.bin", "223.5.5.5"); assert.equal(r.status, 404);            // 训练的东西不从这里出
  r = await get("ai/../grid/x", "223.5.5.5"); assert.equal(r.status, 404);
  r = await get("ai/nope.bin", "223.5.5.5"); assert.equal(r.status, 404);
  r = await get("android/a.apk", "1.1.1.1", {}, "HEAD"); assert.equal(r.status, 403);
  r = await get("android/a.apk", "223.5.5.5"); assert.equal(r.status, 403); assert.equal(r.headers.get("x-lz-dl"), "apk");   // COS 默认域名不让发 apk
  ok("国内 IP → 302 到 COS 的临时链接（6 小时失效）；海外 IPv4 / IPv6 → 403，告诉他去 GitHub；训练的文件、乱写的路径、不存在的文件都不给");

  // 断点续传 / 测速：按 Range 记账；HEAD 不记
  r = await get("ai/models/x.safetensors", "114.114.114.114", { range: "bytes=0-262143" }); assert.equal(r.status, 302);
  r = await get("ai/models/x.safetensors", "114.114.114.114", {}, "HEAD"); assert.equal(r.status, 302);
  let st = app.gate.stats(1).days[0];
  assert.equal(st.n, 2); assert.equal(st.files.find((f) => f.key === "ai/models/x.safetensors").n, 1);
  assert.ok(Math.abs(st.gb - (1.5 + 0.25 / 1024)) < 0.01, st.gb);
  ok("记账按实际要下的量：测速只取 256K 就只记 256K，HEAD 不记；文件大小问过一次 COS 记住（问了 " + heads + " 次）");

  // 同一个文件同一个 IP 反复下（安装反复失败）：第 3 遍拦住
  r = await get("code/LaolaoCode-Setup-1.0.24.exe", "223.5.5.5"); assert.equal(r.status, 302);
  r = await get("code/LaolaoCode-Setup-1.0.24.exe", "223.5.5.5"); assert.equal(r.status, 429); assert.equal(r.headers.get("x-lz-dl"), "repeat"); assert.match(await r.text(), /已经下了 2 遍/);
  r = await get("code/LaolaoCode-Setup-1.0.24.exe", "223.5.5.5", { range: "bytes=1073741824-" }); assert.equal(r.status, 429);   // 续传也算
  // 一个 IP 一天的量（3.5G）
  r = await get("ai/models/x.safetensors", "223.5.5.5"); assert.equal(r.status, 429); assert.equal(r.headers.get("x-lz-dl"), "ip");
  // 全站一天的量（6G）：别的 IP 也停
  r = await get("ai/models/x.safetensors", "119.29.29.29"); assert.equal(r.status, 302);
  r = await get("ai/models/x.safetensors", "119.29.29.29"); assert.equal(r.status, 302);
  r = await get("code/LaolaoCode-Setup-1.0.24.exe", "240e:1::1"); assert.equal(r.status, 429); assert.equal(r.headers.get("x-lz-dl"), "budget"); assert.match(await r.text(), /流量用完了/);
  SIZE["ai/small.json"] = 7e6;
  r = await get("ai/small.json", "240e:1::1"); assert.equal(r.status, 302);    // 小文件还给（7M 在额度里）
  ok("刹车：同一个文件同一个网络一天最多 2 遍（续传也算）；一个网络一天最多 3.5G；全站一天最多 6G，到了就停到明天");

  // 控制中心看账
  await new Promise((ok_) => setTimeout(ok_, 120));
  const admin = app.core.adminToken();
  const a = await (await fetch(`http://127.0.0.1:${port}/api/admin/dl?days=3`, { headers: { authorization: "Bearer " + admin } })).json();
  const d0 = a.days[0];
  assert.equal(a.ready, true); assert.equal(a.days.length, 3); assert.ok(a.ipList.v4 > 3000 && a.ipList.v6 > 1000);
  assert.ok(d0.gb > 5 && d0.gb <= 6 && Math.abs(d0.yuan - d0.gb * 0.5) < 0.02);
  assert.deepStrictEqual(d0.refused, { foreign: 2, repeat: 2, ip: 1, budget: 1 });
  assert.equal(d0.foreign.length, 2); assert.equal(d0.ips[0].region, "CN");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/dl`)).status, 401);
  // 重开：今天的账还在
  app.close();
  const app2 = Server.create({ data: tmp, noTick: true, env: { DL_COS_BUCKET: "", GRID_COS_BUCKET: "" }, gate: { noRefresh: true } });
  assert.equal(app2.gate.stats(1).days[0].n, d0.n); assert.equal(app2.gate.ready, false);
  const p2 = await app2.listen(0, "127.0.0.1");
  r = await fetch(`http://127.0.0.1:${p2}/dl/ai/models/x.safetensors`, { redirect: "manual", headers: { "x-forwarded-for": "223.5.5.5" } }); assert.equal(r.status, 503);
  // 不是本机 Caddy 转过来的：X-Forwarded-For 不能信（不然海外的人自己写一个国内 IP 就过了）
  app2.close();
  ok(`控制中心看账（/api/admin/dl）：今天发出 ${d0.gb}G、估计 ${d0.yuan} 元、谁下得最多、拦了多少（海外 2 / 反复 2 / 单 IP 1 / 全站 1）；要管理员口令；重开账还在；没配存储就 503`);

  // X-Forwarded-For 只信本机的代理
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "dl3-"));
  const app3 = Server.create({ data: tmp3, noTick: true, env: { DL_COS_ENDPOINT: "https://cos.ap-guangzhou.myqcloud.com", DL_COS_REGION: "ap-guangzhou", DL_COS_BUCKET: "b-1", DL_COS_KEY_ID: "k", DL_COS_SECRET: "s" }, gate: { noRefresh: true, fetch: async () => ({ ok: true, status: 200, headers: { get: () => "100" } }) } });
  const req = { socket: { remoteAddress: "8.8.4.4" }, headers: { "x-forwarded-for": "223.5.5.5" }, method: "GET" };
  let code = 0; const res = { writeHead: (c) => { code = c; }, end: () => {} };
  assert.equal(G.clientIp(req), "8.8.4.4");
  await app3.gate.handle(req, res, "android/a.apk", G.clientIp(req)); assert.equal(code, 403);
  assert.equal(G.clientIp({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { "x-forwarded-for": "1.1.1.1, 223.5.5.5" } }), "223.5.5.5");
  app3.close();
  ok("X-Forwarded-For 只信本机的 HTTPS 代理：海外的人自己在请求里写一个国内 IP 也不行");
  console.log("下载门口：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
