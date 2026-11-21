// 正在下大文件（存档、要用的文件）时点「停止」：下载马上断开，这台电脑马上空出来，任务还给调度中心；
// 下好的部分留着（下回接着下）。以前要等几个小时的下载下完才算停，展示页一直说「这台电脑正在算」
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const Server = require("../server");
const Agent = require("../worker/agent");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-stopdl-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  // 一个 24M 的输入文件（任务开工前要下）
  const key = "jobs/0/big/input.bin";
  const f0 = path.join(tmp, "server", "blobs", ...key.split("/"));
  fs.mkdirSync(path.dirname(f0), { recursive: true }); fs.writeFileSync(f0, crypto.randomBytes(24 * 1048576));
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const rc = path.join(tmp, "use_big.py");
  fs.writeFileSync(rc, "import lg\nt = lg.task()\nlg.done(ok=1)\n");
  const planFile = path.join(tmp, "p.json");
  fs.writeFileSync(planFile, JSON.stringify({ jobs: [{ name: "要下大文件的任务", kind: "map", recipe: rc, params: { count: 1, big: key }, priority: 3 }] }));
  const [jobId] = await Tools.plan(admin, planFile);

  Agent.setNetLimit(1);   // 限速 1M/秒：24M 要下 24 秒
  const cred = await Agent.join(inv.link, "甲", { name: "甲的电脑", info: { gpu: "RTX 5060", vram: 8 } });
  const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300 });
  a.start();
  await until(() => a.current() && /下载/.test(a.current().note || ""), 20000, "开始下载");
  await sleep(2500);   // 下了一部分
  const t0 = Date.now();
  a.setManual("off");   // 点「停止」
  await until(() => !a.current(), 10000, "停止以后这台电脑空出来");   // 真正的要求在下面：3 秒内；这里多等一会儿，慢的时候能看到实际用了几秒
  const secs = (Date.now() - t0) / 1000;
  assert.ok(secs < 3, "停止要马上生效，用了 " + secs + " 秒");
  assert.equal(a.status().state, "paused");
  // 还任务是电脑发给调度中心的一个请求：Windows 上慢的时候比「电脑空出来」晚几百毫秒到，等它到（最多 5 秒）
  const back = (ts) => ts.every((t) => t.state === "queued" || t.state === "pending" || t.state === "ready" || !t.device);
  let tasks = [];
  for (let i = 0; i < 100; i++) { tasks = (await Tools.api(admin, "/api/admin/job?id=" + jobId, null, "GET")).tasks; if (back(tasks)) break; await sleep(50); }
  assert.ok(tasks.every((t) => t.state === "queued" || t.state === "pending" || t.state === "ready" || !t.device), "任务还给了调度中心：" + JSON.stringify(tasks.map((t) => [t.state, t.device])));
  ok(`下载 24M 的文件到一半点「停止」：${secs.toFixed(1)} 秒就停了，任务还给调度中心（以前要等下载下完）`);

  // 再点「开始」：接着把任务领回来、下完、算完
  Agent.setNetLimit(0);
  a.setManual("auto");
  await until(async () => (await Tools.api(admin, "/api/admin/job?id=" + jobId, null, "GET")).state === "done", 30000, "接着算完");
  ok("再点「开始」：任务领回来，下完、算完");
  a.stop(); app.close();
  console.log("停止下载：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
