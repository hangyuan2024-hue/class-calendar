// 同一个局域网的几台电脑连起来跑大模型（llama.cpp RPC）：
//   · 电脑报局域网地址 → 调度中心让同一网段的互相测（连不连得通、每秒多少 MB）→ 记下来
//   · 成组的活（req.gang）：主机领活时把测通过的空闲电脑拉来当帮手（开 rpc-server）；主机等帮手连得上再开大模型（--rpc）
//   · 活结束，帮手的 rpc-server 自动关；找不齐帮手的时候这个活先不派，别的活照常
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net");
const { spawn } = require("child_process");
const Server = require("../server");
const Agent = require("../worker/agent");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-lan-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

(async () => {
  // 假的 rpc-server：开个端口就行（真的是 llama.cpp 自带的，把显卡借给主机）
  const fake = path.join(tmp, "rpc-server.js");
  fs.writeFileSync(fake, "const a=process.argv.slice(2);const h=a[a.indexOf('-H')+1],p=+a[a.indexOf('-p')+1];require('net').createServer(s=>s.end()).listen(p,h);");
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const rpcPort = 40000 + Math.floor(Math.random() * 10000);
  const seen = [], spawned = [];
  const mk = async (who, i, rpc = true) => {
    const cred = await Agent.join(inv.link, who, { name: who + "的电脑" });
    const logs = [];
    const a = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "w" + i), python: PY, caps: { gpu: "RTX", vram: 8, ram: 32, llm: true }, tickMs: 100, hbMs: 200, leaseEveryMs: 100, renewMs: 300,
      lanAddrs: () => [{ ip: "127.0.0.1", mask: "255.0.0.0" }], lanPort: 18900 + i * 10, lanBytes: 1048576, rpcExe: rpc ? fake : null, rpcPort: rpcPort + i, rpcWaitMs: 15000,
      spawn: (exe, args, o) => { const p = spawn(process.execPath, [exe, ...args], o); spawned.push({ who, args, p }); return p; },
      llm: { ensure: async (sp) => { seen.push({ who, sp }); return "http://127.0.0.1:1"; }, stop: () => {}, version: async () => "b1" } });
    a.on("log", (e) => logs.push(e.msg || e));
    return { a, logs, cred };
  };
  const A = await mk("甲", 1), B = await mk("乙", 2);
  A.a.start(); B.a.start();
  const db = app.core.db;
  await until(() => db.prepare("select count(*) as n from lan_links where ok=1").get().n >= 1, 20000, "互相测局域网");
  const l = db.prepare("select * from lan_links where ok=1").get();
  assert.ok(l.mbps > 0 && l.rtt >= 0, JSON.stringify(l));
  assert.ok(A.logs.concat(B.logs).some((x) => /和局域网里的电脑测了一下：127\.0\.0\.1 通/.test(String(x))));
  const view = await Tools.api(admin, "/api/admin/lan", null, "GET");
  assert.equal(view.devices.length, 2); assert.ok(view.links.length >= 1);
  ok(`电脑报局域网地址 → 同一网段的互相测：通，每秒 ${l.mbps}MB；控制中心能看到哪几台连得上`);
  // 口令不对的连不进来
  const bad = await Agent.lanProbe({ id: 9, ip: "127.0.0.1", port: 18910, key: "wrong" });
  assert.ok(!bad.ok && /口令不对/.test(bad.why));
  ok("测试口只认调度中心发的口令：口令不对的连不进来");

  // 成组的活：一台当主机、一台当帮手
  const rec = path.join(tmp, "big.py");
  fs.writeFileSync(rec, "# needs: llm\nimport lg\nt = lg.task()\nlg.done(url=t.get('llm'))\n");
  const plan = path.join(tmp, "p.json");
  fs.writeFileSync(plan, JSON.stringify({ jobs: [{ name: "大老师造数据", kind: "map", recipe: rec, params: { count: 1, llm: { name: "Big-14B.gguf" } }, req: { llm: true, gang: { size: 2, minMbps: 0.01 } }, priority: 5 }] }));
  const [jid] = await Tools.plan(admin, plan);
  const state = async () => (await Tools.api(admin, "/api/admin/job?id=" + jid, null, "GET"));
  await until(async () => (await state()).state === "done", 30000, "成组的活做完");
  const lead = seen.find((x) => x.sp.name === "Big-14B.gguf");
  assert.ok(lead && Array.isArray(lead.sp.rpc) && lead.sp.rpc.length === 1, JSON.stringify(seen));
  const helper = lead.who === "甲" ? "乙" : "甲";
  const sp = spawned.find((x) => x.who === helper);
  assert.ok(sp && sp.args.includes("-H") && sp.args.includes("127.0.0.1") && lead.sp.rpc[0] === "127.0.0.1:" + sp.args[sp.args.indexOf("-p") + 1], JSON.stringify({ rpc: lead.sp.rpc, args: sp && sp.args }));
  ok(`成组的活：${lead.who}当主机，${helper}的显卡借给它（rpc-server 只开在局域网地址上）；主机等帮手连得上才开大模型（--rpc ${lead.sp.rpc[0]}）`);
  await until(() => !db.prepare("select count(*) as n from rpc_helpers").get().n || sp.p.exitCode !== null || sp.p.killed, 10000, "活结束，帮手收回显卡");
  await until(() => sp.p.killed || sp.p.exitCode !== null, 10000, "帮手的 rpc-server 关掉");
  ok("活结束：帮手的 rpc-server 自动关，显卡收回");

  // 找不齐帮手：成组的活先不派（只有一台在线）
  B.a.stop(); await sleep(300);
  db.prepare("update devices set last_seen=? where name=?").run(Date.now() - 600e3, "乙的电脑");
  const [jid2] = await Tools.plan(admin, plan);
  await sleep(1500);
  assert.equal(db.prepare("select count(*) as n from tasks where job_id=? and state='leased'").get(jid2).n, 0, "找不齐帮手就先不派");
  ok("找不齐帮手（只有一台在线）：成组的活先不派，不硬开");
  A.a.stop(); app.close();
  console.log("局域网合算：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
