// 每日一轮：到点自动开一轮（生成 → 接着上一版训练 → 评测）；分数变好才发布，变差不发布（老师端继续用旧的）；管理员能撤回；
// 发布清单和模型文件能公开下载（只有发布了的能下）
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-cycle-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let now = Date.parse("2026-11-13T10:00:00Z");   // 北京时间 18:00
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 3000, noTick: true, clock: () => now });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 5, server: url });
  const agents = [];
  for (const n of ["张三", "李四"]) {
    const j = await Agent.join(inv.link, n, { name: "电脑" });
    const a = Agent.create({ server: url, token: j.token, pubkey: j.pubkey, workDir: path.join(tmp, "w-" + n), python: PY, caps: { vram: 8 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300 });
    a.start(); agents.push(a);
  }
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "cycle-demo.json"), "utf8"));
  const pf = path.join(tmp, "cycle.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", "demo_cycle.py") })) }));
  const pid = await Tools.cycle(admin, pf);
  const C = app.cycle;

  app.core.db.prepare("select 1").get();
  C.tick(); assert.equal(C.view().pipelines[0].runs.length, 0, "还没到 19:00");
  const waitRun = async (rid) => { for (let i = 0; i < 600; i++) { const r = app.core.db.prepare("select state from runs where id=?").get(rid); if (r.state === "done") return; await sleep(100); } throw new Error("这一轮没跑完：" + JSON.stringify(app.core.overview(true).jobs.map((j) => [j.name, j.state, j.tasks]))); };

  // 第 1 天
  now += 3600e3; C.tick();
  let runs = C.view().pipelines[0].runs; assert.equal(runs.length, 1);
  C.tick(); assert.equal(C.view().pipelines[0].runs.length, 1, "今天跑过了，不再开");
  await waitRun(runs[0].id);
  let models = C.view().models;
  assert.equal(models[0].state, "released"); assert.equal(models[0].version, 1);
  const s1 = models[0].metrics.score;
  ok(`到点自动开一轮：生成 → 训练 → 评测，第 1 版发布（分数 ${s1}）`);

  // 老师端读的清单、下载模型
  const m1 = await (await fetch(url + "/pub/models/manifest.json")).json();
  const f1 = m1.models["demo-curve"].files[0];
  assert.equal(m1.models["demo-curve"].version, 1);
  const buf = Buffer.from(await (await fetch(f1.url)).arrayBuffer());
  assert.equal(buf.length, f1.size); assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), f1.sha256);
  assert.equal((await fetch(url + "/pub/jobs/1/1/whatever.npz")).status, 404);
  ok("老师端：发布清单能读、模型文件能下（大小、sha256 对得上）；没发布的文件下不了");

  // 第 2 天：接着第 1 版训练，分数更高 → 发布第 2 版
  now += 24 * 3600e3; C.tick();
  runs = C.view().pipelines[0].runs; assert.equal(runs.length, 2);
  await waitRun(runs[0].id);
  const trainJob = app.core.db.prepare("select params from jobs where run_id=? and params like '%\"stageKey\":\"train\"%'").get(runs[0].id);
  assert.match(JSON.parse(trainJob.params).warmStart, /^jobs\//, "第 2 天接着第 1 版训练");
  models = C.view().models;
  assert.equal(models[0].version, 2); assert.equal(models[0].state, "released");
  assert.ok(models[0].metrics.score > s1, `第 2 版应该更好：${s1} → ${models[0].metrics.score}`);
  ok(`第 2 天接着第 1 版训练：分数 ${s1} → ${models[0].metrics.score}，发布第 2 版`);

  // 第 3 天：故意训坏（加很多噪声）→ 分数变差，不发布，老师端继续用第 2 版
  await Tools.cycle(admin, (fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", "demo_cycle.py"), params: s.key === "train" ? { ...s.params, noise: 3, lr: 0.3 } : s.params })) })), pf));
  now += 24 * 3600e3; C.tick();
  runs = C.view().pipelines[0].runs;
  await waitRun(runs[0].id);
  models = C.view().models;
  assert.equal(models[0].version, 3); assert.equal(models[0].state, "rejected");
  assert.equal((await (await fetch(url + "/pub/models/manifest.json")).json()).models["demo-curve"].version, 2);
  ok(`第 3 天训坏了（${models[0].note}）：不发布，老师端继续用第 2 版`);

  // 管理员撤回第 2 版 → 退回第 1 版
  await Tools.api(admin, "/api/admin/model/set", { id: models.find((m) => m.version === 2).id, state: "rejected" });
  assert.equal((await (await fetch(url + "/pub/models/manifest.json")).json()).models["demo-curve"].version, 1);
  ok("管理员撤回第 2 版：老师端退回第 1 版");

  // 上一轮没跑完，不开新的一轮
  await Tools.api(admin, "/api/admin/pipeline/run", { id: pid });
  now += 24 * 3600e3; C.tick();
  assert.equal(app.core.db.prepare("select count(*) as n from runs where state='running'").get().n, 1, "不叠在一起跑");
  ok("上一轮还没跑完：到点也不开新的一轮（不叠在一起）");

  agents.forEach((a) => a.stop()); app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("每日一轮：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
