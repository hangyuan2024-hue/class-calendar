// 训练要下上千个数据文件：这台电脑一时查不到存储的域名（getaddrinfo ENOTFOUND，开着加速器 / 安全软件时常见）
//   · 域名查过一次就记住（10 分钟），查不到时用上次的地址；连接复用，不再每个文件都重新查、重新握手
//   · 直连存储下不动 → 经调度中心转一道（只给自己正在算的任务要用的文件）
//   · 都下不了的数据文件个别几个就跳过；不让整台电脑「等空闲」，只是这一类活先缓一缓
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Server = require("../server");
const Agent = require("../worker/agent");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-dns-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

(async () => {
  // ---- 域名缓存：查到过一次，之后一时查不到也用上次的 ----
  let fail = false, calls = 0;
  Agent.cachedLookup.lookup = (h, o, cb) => { calls++; if (fail) cb(Object.assign(new Error("getaddrinfo ENOTFOUND " + h), { code: "ENOTFOUND" })); else cb(null, "10.1.2.3", 4); };
  const look = (h) => new Promise((r) => Agent.cachedLookup(h, {}, (e, a) => r(e ? e.code : a)));
  assert.equal(await look("bucket.cos.example.com"), "10.1.2.3");
  assert.equal(await look("bucket.cos.example.com"), "10.1.2.3"); assert.equal(calls, 1, "10 分钟内不重新查");
  Agent.DNS_CACHE.get("bucket.cos.example.com|0|0").at -= 11 * 60e3; fail = true;
  assert.equal(await look("bucket.cos.example.com"), "10.1.2.3", "过期了重新查、查不到：用上次的");
  assert.equal(await look("never.example.com"), "ENOTFOUND", "从来没查到过的照实报错");
  delete Agent.cachedLookup.lookup;
  ok("域名查过就记住；一时查不到用上次的地址（以前上千个文件每个都重新查，偶尔一次查不到整轮训练就起不来）");

  // ---- 直连存储查不到域名：经调度中心转一道；电脑不进「等空闲」 ----
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const gen = path.join(tmp, "gen.py"), use = path.join(tmp, "use.py");
  fs.writeFileSync(gen, "import lg, os\nt = lg.task()\nn = t['input'].get('i', 0)\nf = os.path.join(lg.work_dir(), 'r%d.txt' % n)\nopen(f, 'w', encoding='utf-8').write('结果 %d' % n)\nlg.output(f)\nlg.done(ok=1)\n");
  fs.writeFileSync(use, "import lg\nt = lg.task()\nk = sorted(k for k in t['files'] if k.startswith('data'))\nlg.done(n=len(k), texts=sorted(open(t['files'][x], encoding='utf-8').read() for x in k))\n");
  const plan1 = path.join(tmp, "p1.json");
  fs.writeFileSync(plan1, JSON.stringify({ jobs: [{ name: "造数据", kind: "map", recipe: gen, params: { count: 4, tag: "T" }, priority: 3 }] }));
  const [j1] = await Tools.plan(admin, plan1);
  const cred = await Agent.join(inv.link, "甲", { name: "甲的电脑", info: { gpu: "RTX 5060", vram: 8 } });
  const logs = [];
  const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, retryMs: 20, dlTries: 2 });
  a.on("log", (e) => { logs.push(e.msg || e); if (process.env.DBG) console.log("LOG", JSON.stringify(e).slice(0, 300)); });
  a.start();
  const state = async (id) => (await Tools.api(admin, "/api/admin/job?id=" + id, null, "GET"));
  await until(async () => (await state(j1)).state === "done", 30000, "造数据做完");
  // 存储的地址换成一个查不到的域名（就像这台电脑查不到 COS 的域名）
  app.setPublic(`http://lg-dns-test.invalid:${port}`);
  const plan2 = path.join(tmp, "p2.json");
  fs.writeFileSync(plan2, JSON.stringify({ jobs: [{ name: "用结果", kind: "map", recipe: use, params: { count: 1, outputsOf: "T" }, priority: 3 }] }));
  const [j2] = await Tools.plan(admin, plan2);
  await until(async () => (await state(j2)).state === "done", 60000, "用结果的任务做完（直连查不到域名，经调度中心转）");
  const r = JSON.stringify((await state(j2)).tasks[0].result || (await state(j2)).result);
  assert.ok(/"n":4\b/.test(r) && r.includes("结果 3"), "4 个都拿到了：" + r);
  assert.ok(logs.some((l) => /经调度中心转了一道/.test(String(l))), "日志里写着经调度中心转了一道");
  assert.ok(!logs.some((l) => /这台电脑现在算不了/.test(String(l))), "没有让整台电脑「等空闲」");
  ok("直连存储查不到域名：每个文件经调度中心转一道，4 个都拿到，任务照常做完；整台电脑没进「等空闲」");

  // 别人的任务要用的文件：不给
  const other = await fetch(`${url}/api/input?task=999&k=data0`, { headers: { authorization: "Bearer " + cred.token } });
  assert.equal(other.status, 404);
  assert.equal((await fetch(`${url}/api/input?task=1&k=data0`)).status, 401);
  ok("经调度中心转：只给自己正在算的任务要用的文件，别的一概不给");
  a.stop(); app.close();
  console.log("查不到存储的域名：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
