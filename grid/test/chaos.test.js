// 断电测试：真的调度中心 + 几台模拟电脑（真的跑 Python 配方），隔一会儿随机「拔电源」一台、过一会儿再开机。
// 检查：接力训练的结果和一台电脑从头算到尾一模一样；DiLoCo 照样跑完、误差下降；生成的图进了审核。
"use strict";
process.removeAllListeners("warning");
process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Server = require("../server");
const Agent = require("../worker/agent");

const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-chaos-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = +(process.env.SEED || Date.now() % 100000);
let rnd = seed; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);

(async () => {
  console.log("随机种子", seed);
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 1500 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());

  // 一台电脑从头算到尾的结果（对照）
  const ref = path.join(tmp, "ref"); fs.mkdirSync(ref);
  fs.writeFileSync(path.join(ref, "t.json"), JSON.stringify({ kind: "run", input: { from: 0, to: 300 }, job: { params: { ckptEvery: 1000 } }, work: ref }));
  execFileSync(PY, [path.join(ROOT, "recipes/demo_relay.py")], { env: { ...process.env, PYTHONPATH: path.join(ROOT, "py"), PYTHONIOENCODING: "utf-8", LG_TASK: path.join(ref, "t.json") } });
  const refFile = fs.readdirSync(ref).find((f) => f.startsWith("ckpt-300"));
  ok("对照：一台电脑从头算到第 300 步");

  // 建任务（和管理员平时一样：签名、上传配方）
  const planFile = path.join(tmp, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ jobs: [
    { name: "接力训练（示例）", stage: "阶段 2 · 训练", kind: "relay", recipe: path.join(ROOT, "recipes/demo_relay.py"), params: { totalSteps: 300, segSteps: 100, ckptEvery: 20, sleep: 0.01 }, priority: 3 },
    { name: "一起训（示例）", stage: "阶段 2 · 训练", kind: "diloco", recipe: path.join(ROOT, "recipes/demo_diloco.py"), params: { rounds: 6, width: 3, innerSteps: 40, minDone: 2, roundSecs: 4, sleep: 0.005 }, priority: 2 },
    { name: "画 Q版候选（示例）", stage: "阶段 1 · 数据", kind: "map", recipe: path.join(ROOT, "recipes/demo_avatar.py"), params: { count: 8, reviewNeed: 2 }, priority: 1 },
  ] }));
  const [relayId, dlId, mapId] = await Tools.plan(admin, planFile);
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });

  // 4 台模拟电脑
  const machines = [];
  for (let i = 0; i < 4; i++) {
    const j = await Agent.join(inv.link, ["张三", "李四", "王五", "我"][i], { name: "电脑" + (i + 1), info: { gpu: "RTX 5060", vram: 8 } });
    machines.push({ i, cred: j, agent: null, up: false, crashes: 0 });
  }
  const boot = (m) => {
    m.agent = Agent.create({ server: m.cred.server, token: m.cred.token, pubkey: m.cred.pubkey, workDir: path.join(tmp, "m" + m.i), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 150, hbMs: 400, leaseEveryMs: 150, renewMs: 300 });
    m.agent.start(); m.up = true;
  };
  machines.forEach(boot);

  // 每 0.6～1.2 秒随机拔一台的电源（至少留一台开着），过 1～2 秒再开机
  let ckptsSeen = 0, resumed = 0;
  for (const m of machines) m.agent.on("ckpt", () => ckptsSeen++);
  const t0 = Date.now();
  let lastChaos = Date.now();
  while (true) {
    const ov = app.core.overview(true);
    const js = Object.fromEntries(ov.jobs.map((j) => [j.id, j]));
    if ([relayId, dlId, mapId].every((id) => js[id].state === "done")) break;
    if (Date.now() - t0 > 120000) throw new Error("两分钟还没算完：" + JSON.stringify(ov.jobs.map((j) => [j.name, j.state, j.done, j.total, j.tasks])));
    if (Date.now() - lastChaos > 600 + rand() * 600) {
      lastChaos = Date.now();
      const up = machines.filter((m) => m.up);
      if (up.length > 1) {
        const busy = up.filter((m) => m.agent.current());
        const m = (busy.length ? busy : up)[Math.floor(rand() * (busy.length || up.length))];
        m.agent.crash(); m.up = false; m.crashes++;
        setTimeout(() => boot(m), 1000 + rand() * 1000);
      }
    }
    await sleep(100);
  }
  machines.forEach((m) => m.up && m.agent.stop());
  const crashes = machines.reduce((a, m) => a + m.crashes, 0);
  const ev = app.core.overview(true).events;
  const lost = app.core.db.prepare("select count(*) as n from events where type='lost'").get().n;
  ok(`三个任务都算完了：${((Date.now() - t0) / 1000).toFixed(1)} 秒，中途拔了 ${crashes} 次电源，${lost} 次任务转给了下一台，上传了 ${ckptsSeen} 个存档`);
  assert.ok(crashes >= 3 && lost >= 1, "测试要真的拔过电源");

  // 接力的最终存档 == 对照
  const rd = app.core.jobDetail(relayId);
  const last = app.core.db.prepare("select key from ckpts where job_id=? and kind='relay' order by step desc, id desc limit 1").get(relayId).key;
  const got = path.join(tmp, "server", "blobs", ...last.split("/"));
  const cmp = execFileSync(PY, ["-c", "import numpy as np,sys\na=np.load(sys.argv[1]);b=np.load(sys.argv[2])\nprint(int(a['step']), int(b['step']), max(float(abs(a[k]-b[k]).max()) for k in a.files))", got, path.join(ref, refFile)]).toString().trim().split(" ");
  assert.equal(cmp[0], "300"); assert.equal(+cmp[2], 0, "和一台电脑算的不一样：差 " + cmp[2]);
  const resumes = app.core.db.prepare("select coalesce(sum(lost),0) as n from tasks where job_id=?").get(relayId).n;
  ok(`接力训练：最后的模型和一台电脑从头算到尾的完全一样（一位都不差）；中途换了 ${resumes} 次电脑接着算`);

  const dd = app.core.jobDetail(dlId);
  const losses = dd.curves.loss.map((x) => x[1]);
  assert.equal(losses.length, 6);
  assert.ok(losses[5] < losses[0], "误差没降：" + losses);
  const merged = app.core.db.prepare("select input from tasks where job_id=? and kind='merge'").all(dlId).map((r) => JSON.parse(r.input).parts.length);
  ok(`DiLoCo：6 轮都合并了，每轮用了 ${merged.join("/")} 份，误差 ${losses[0].toFixed(3)} → ${losses[5].toFixed(3)}`);

  const md = app.core.jobDetail(mapId);
  assert.equal(md.reviews.length, 8); assert.ok(md.outputs.length >= 16);
  ok(`生成：8 个小任务都交了，${md.outputs.length} 张图，8 组进了人工审核`);

  // 审核：两个人各投一遍
  for (const m of machines.slice(0, 2)) {
    const a = Agent.create({ server: url, token: m.cred.token, workDir: path.join(tmp, "rv" + m.i) });
    for (let k = 0; k < 8; k++) {
      const r = await a.api("/api/review/next");
      assert.ok(r.item && r.item.payload.aUrl);
      const img = await fetch(r.item.payload.aUrl); assert.equal(img.headers.get("content-type"), "image/png");
      await a.api("/api/review/vote", { review: r.item.id, choice: /big/.test(r.item.payload.a) ? "a" : "b" });
    }
    assert.equal((await a.api("/api/review/next")).item, null);
  }
  const res = app.core.exportReviews(mapId);
  assert.ok(res.every((r) => r.state === "done" && /big/.test(r.payload[r.result.choice])));
  ok("人工审核：两个人投完，8 组都定了（都选了大眼睛那张），能导出来当训练数据");

  // 签名不对的配方不跑
  const bad = Agent.create({ server: url, token: machines[0].cred.token, pubkey: Tools.keypair().pub, workDir: path.join(tmp, "bad"), python: PY });
  const jid = await Tools.plan(admin, (fs.writeFileSync(planFile, JSON.stringify({ jobs: [{ name: "签名测试", kind: "map", recipe: path.join(ROOT, "recipes/demo_avatar.py"), params: { count: 1 } }] })), planFile));
  const L = await bad.api("/api/lease", { caps: {} });
  let err = null; bad.on("log", (l) => { if (l.level === "error") err = l.msg; });
  await (async () => { const a2 = bad; a2.start(); await sleep(1500); await a2.stop(); })();
  ok("签名核对：拿错的公钥（相当于别人冒充管理员发的配方）→ 不跑：" + (err || "").slice(0, 40));
  assert.match(err || "", /签名不对/);

  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("断电测试：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
