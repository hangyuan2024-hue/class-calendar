// 训练要读「到现在为止这一类任务交的所有结果」（data0、data1…几百个）：个别一个在存储里找不到（404）时，
// 不该让整轮训练起不来：跳过它，用其余的继续（以前是整个任务报「下载失败 404」，所有电脑一起卡住，每 5 分钟重试还是同一个错）
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Server = require("../server");
const Agent = require("../worker/agent");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-missing-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

(async () => {
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
  const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300 });
  a.start();
  const state = async (id) => (await Tools.api(admin, "/api/admin/job?id=" + id, null, "GET"));
  await until(async () => (await state(j1)).state === "done", 30000, "造数据做完");
  // 弄丢其中一个结果文件（存储里找不到）
  const blobs = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : /r\d(-[0-9a-f]{8})?\.txt$/.test(f.name) && blobs.push(path.join(d, f.name)); })(path.join(tmp, "server", "blobs"));
  // 机器忙时同一个小任务可能被收回重做、多存一份：按 r0..r3 分组，丢掉其中一个的全部副本
  const byName = {}; for (const b of blobs) (byName[path.basename(b).match(/r\d/)[0]] ||= []).push(b);
  assert.equal(Object.keys(byName).length, 4);
  for (const b of byName.r1) fs.rmSync(b);
  const plan2 = path.join(tmp, "p2.json");
  fs.writeFileSync(plan2, JSON.stringify({ jobs: [{ name: "用结果", kind: "map", recipe: use, params: { count: 1, outputsOf: "T" }, priority: 3 }] }));
  const [j2] = await Tools.plan(admin, plan2);
  await until(async () => (await state(j2)).state === "done", 30000, "用结果的任务做完（少了一个文件也要能做）");
  const r = (await state(j2)).tasks[0].result || (await state(j2)).result;
  const js = JSON.stringify(r);
  assert.ok(/"n":3\b/.test(js), "4 个里丢了 1 个：用其余 3 个继续 " + js);
  ok("训练要用的几百个数据文件里，个别一个找不到（404）：跳过它，用其余的继续，不再整轮卡住");
  a.stop(); app.close();
  console.log("缺数据文件：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
