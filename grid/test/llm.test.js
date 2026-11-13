// 本地大模型 + 答题数据工厂：
//   · app/llmw.js：第一次下载模型（断点续传）、开 llama-server、等它好了；省显存的参数不行就换一种方式再开；不用就关
//   · 两种活一样优先：几台电脑分开做（一台画 Q版、一台做题），做完接着做自己那种（模型还在显存里）
//   · 配方 qa_math.py：GSM8K 改写成中文、讲 4 遍、和标准答案对上的才留；按知识点出的新题，多数一致才留
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { spawn } = require("child_process");
const Core = require("../server/core");
const Server = require("../server");
const Agent = require("../worker/agent");
const LLMW = require("../app/llmw");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-llm-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

(async () => {
  // ---------- 两种活一样优先：分开做，做完接着做自己那种 ----------
  {
    let T = 1e6;
    const c = Core.open(":memory:", { clock: () => T, leaseMs: 60000 });
    c.addRecipe({ id: "r", name: "r", key: "recipes/r.py", sig: "x" });
    const j1 = c.createJob({ name: "画 Q版", kind: "map", recipe: "r", params: { count: 10 }, priority: 10 });
    const j2 = c.createJob({ name: "做数学题", kind: "map", recipe: "r", params: { count: 10 }, priority: 10 });
    const inv = c.invite({ maxUses: 5 });
    const A = c.join({ code: inv.code, name: "甲", device: { name: "A" } }), B = c.join({ code: inv.code, name: "乙", device: { name: "B" } });
    const la = c.lease(c.auth(A.token), {}), lb = c.lease(c.auth(B.token), {});
    assert.equal(la.job.id, j1); assert.equal(lb.job.id, j2, "第二台领另一种活");
    c.finish(c.auth(A.token), { task: la.task.id, result: {} });
    T += 1000;
    assert.equal(c.lease(c.auth(A.token), {}).job.id, j1, "做完接着做自己那种");
    c.finish(c.auth(B.token), { task: lb.task.id, result: {} });
    T += 1000;
    assert.equal(c.lease(c.auth(B.token), {}).job.id, j2);
    assert.equal(c.lease(c.auth(c.join({ code: inv.code, name: "丙", device: { name: "C" } }).token), { }).job.id, j1, "第三台：都一样多，挑先建的");
    const j3 = c.createJob({ name: "要大模型", kind: "map", recipe: "r", params: { count: 1 }, req: { llm: true }, priority: 99 });
    assert.notEqual(c.lease(c.auth(c.join({ code: inv.code, name: "丁", device: { name: "D" } }).token), { llm: false }).job.id, j3, "旧客户端不领要大模型的活");
    ok("两种活一样优先：几台电脑分开做，做完接着做自己那种（模型不用重新加载）；旧客户端不领要大模型的活");
    // 录声音：每位老师都要录全部几段（不是大家分着录）
    const rj = c.createJob({ name: "录声音", kind: "record", params: { perMember: true, items: [{ lines: ["一"] }, { lines: ["二"] }] }, priority: 5 });
    const da = c.auth(A.token), db_ = c.auth(B.token);
    const h1 = c.humanNext(da, rj); assert.equal(h1.task.seq, 0);
    assert.equal(c.humanNext(db_, rj).task.seq, 0, "乙也从第 1 段开始（每人都录全部）");
    assert.equal(c.humanNext(da, rj).task.id, h1.task.id, "没交之前还是这一段");
    c.humanDone(da, { task: h1.task.id, outputs: [{ name: "s000.webm", key: "jobs/x/s000.webm" }], result: { secs: 30 } });
    const h2 = c.humanNext(da, rj); assert.equal(h2.task.seq, 1);
    c.humanDone(da, { task: h2.task.id, result: { secs: 30 } });
    assert.equal(c.humanNext(da, rj), null, "甲录完了");
    assert.equal(c.jobDetail(rj).state, "active", "一个人录完不算结束：别的老师还能录");
    ok("录声音：每位老师都录全部几段（各录各的），一个人录完任务不结束");
  }

  // ---------- app/llmw.js：下载、启动、换方式重试、关掉 ----------
  {
    const blob = Buffer.alloc(300000, 7);
    let hits = 0;
    const files = await listen((q, r) => { hits++; if (q.url.endsWith("/missing.gguf")) return r.writeHead(404).end(); r.writeHead(200, { "Content-Length": blob.length }); r.end(blob); });
    const fake = path.join(tmp, "fake-llama.js");
    fs.writeFileSync(fake, `const http=require("http");const a=process.argv.slice(2);
if(a[0]==="--list-devices"){console.log("Available devices:\\n  Vulkan0: Intel(R) UHD Graphics (16000 MiB, 15000 MiB free)\\n  Vulkan1: NVIDIA GeForce RTX 4060 Laptop GPU (8188 MiB, 7900 MiB free)");process.exit(0);}
const port=+a[a.indexOf("--port")+1];
if(process.env.NO_CTK&&a.includes("-ctk")){console.error("error: unsupported cache type");process.exit(1);}
http.createServer((q,r)=>{r.writeHead(200);r.end("{}");}).listen(port,"127.0.0.1");`);
    const spawned = [];
    const mk = (env) => LLMW.create({ exe: process.execPath, base: () => tmp, port: 18000 + Math.floor(Math.random() * 900),
      spawn: (exe, args, o) => { spawned.push(args); return spawn(process.execPath, [fake, ...args], { ...o, env: { ...process.env, ...env } }); } });
    const fu = `http://127.0.0.1:${files.address().port}`;
    const spec = { name: "Test-Q4.gguf", urls: [fu + "/missing.gguf", fu + "/m.gguf"], ctx: 8192, slots: 2 };
    const L = mk({ NO_CTK: "1" });
    const said = [];
    const u = await L.ensure(spec, (m) => said.push(m));
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(u));
    assert.equal(fs.statSync(path.join(tmp, "llm", "Test-Q4.gguf")).size, blob.length, "第一个地址没有，换下一个下载");
    assert.deepEqual(spawned[0], ["--list-devices"]);
    assert.ok(spawned[1].includes("-ctk") && !spawned[2].includes("-ctk"), "省显存的参数不行，换一种方式再开");
    assert.equal(spawned[1][spawned[1].indexOf("--device") + 1], "Vulkan1", "笔记本两块显卡：用 NVIDIA 独显，不用集显（集显内存看着大也不用）");
    assert.ok(said.some((m) => /下载本地大模型/.test(m)));
    const n = hits;
    assert.equal(await L.ensure(spec), u); assert.equal(hits, n, "下过的不再下"); assert.equal(spawned.length, 3, "开着的不重开");
    L.stop(); assert.equal(L.running(), false);
    await assert.rejects(LLMW.create({ exe: null, base: () => tmp }).ensure(spec), /没有 llama.cpp/);
    files.close();
    ok("本地大模型：第一次下载（一个地址不行换下一个）、开 llama-server、两块显卡只用独显、省显存的参数不行就换方式、下过的不再下、开着的不重开");
  }

  // ---------- 配方 qa_math.py（假的本地大模型）----------
  const gsm = await listen((q, r) => {
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end([{ question: "Tom has 3 apples and buys 15 more. How many?", answer: "3+15=18\n#### 18" }, { question: "Ann has 2 pens.", answer: "#### 5" }, { question: "x", answer: "#### 1,000" }].map((x) => JSON.stringify(x)).join("\n"));
  });
  const calls = [];
  let sq = 0;
  const llm = await listen((q, r) => {
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      const m = JSON.parse(b), u = m.messages[m.messages.length - 1].content;
      calls.push(m);
      let out;
      if (/改写成自然的中文/.test(u)) out = "小明有 3 个苹果，又买了 15 个，一共有多少个？";
      else if (/出 \d+ 道/.test(u)) out = "1. 题目：一个长方形长 5 米，宽 2 米，周长是多少米？\n2. 题目：正方形边长 3 厘米，周长是多少厘米？\n随便说点别的";
      else if (/周长/.test(u)) out = "<think>想一想</think>第一步：……\n答案：\\boxed{" + (/长方形/.test(u) ? "14" : String(12 + (sq++ % 4))) + "米}";
      else out = "先算 3+15=18。\n答案：\\boxed{18}";
      r.writeHead(200, { "Content-Type": "application/json" });
      r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    });
  });
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "张三", { name: "大显卡" });
  let ensured = null;
  const ag = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w"), python: PY, caps: { vram: 8, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    llm: { ensure: async (spec, say) => { ensured = spec; say("准备好了"); return `http://127.0.0.1:${llm.address().port}`; }, stop: () => {} } });
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "qa.json"), "utf8"));
  const pf = path.join(tmp, "qa.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2,
    params: { ...s.params, per: 3, gsm8kUrls: [`http://127.0.0.1:${gsm.address().port}/train.jsonl`] } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  ag.start();
  const db = app.core.db;
  const job = db.prepare("select * from jobs where name like '%数学%' order by id desc limit 1").get();
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(job.id).n >= 2, "做 2 批");
  ag.stop();
  assert.equal(ensured.name, plan.stages[0].params.llm.name, "按任务参数准备模型");
  const res = db.prepare("select result from tasks where job_id=? and state='done' order by seq").all(job.id).map((x) => JSON.parse(x.result));
  assert.equal(res[0].source, "gsm8k"); assert.equal(res[0].problems, 3); assert.equal(res[0].kept, 1, "和标准答案 18 对上的才留（5 和 1,000 对不上）");
  assert.equal(res[1].source, "topics"); assert.equal(res[1].kept, 1, "长方形那道 4 遍都是 14 → 留；正方形那道答案不一致 → 不留");
  const outs = db.prepare("select * from outputs where job_id=?").all(job.id);
  assert.equal(outs.length, 2);
  const solve = calls.find((m) => m.messages[0].role === "system");
  assert.equal(solve.chat_template_kwargs.enable_thinking, false, "讲题不用长思考（快）");
  ok(`数学讲解工厂：GSM8K 改写成中文、讲 4 遍、和标准答案对上的才留；按知识点出的新题，4 遍答案一致才留；结果文件交上去（${outs.length} 个）`);

  // ---------- 训练答题大脑（没有显卡：dryRun 只检查数据、转交、考试、发布）----------
  {
    const spec = JSON.parse(fs.readFileSync(pf, "utf8"));
    const tr = spec.stages.find((s) => s.key === "train");
    tr.params = { ...tr.params, dryRun: true, minExamples: 1, evalN: 3, evalUrls: [`http://127.0.0.1:${gsm.address().port}/test.jsonl`], evalLlm: { name: "Teacher-Q4.gguf", urls: ["http://x/y.gguf"] } };
    tr.when = { ...tr.when, outputs: 2, minHours: 0 };
    fs.writeFileSync(pf, JSON.stringify(spec));
    await Tools.cycle(admin, pf);
    const seen = [];
    const ag2 = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w2"), python: PY, caps: { vram: 8, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
      llm: { ensure: async (sp) => { seen.push(sp); return `http://127.0.0.1:${llm.address().port}`; }, stop: () => seen.push("stop"), version: async () => "b1234" } });
    app.cycle.tick();
    const pipe = app.cycle.view().pipelines.find((x) => x.name === "答题数据工厂");
    assert.equal(pipe.when.outputsOf, "qa-math"); assert.ok(pipe.runs.length === 1, "新结果攒够了就训练");
    db.prepare("update jobs set state='paused' where id=?").run(job.id);   // 只看训练
    ag2.start();
    await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "训练做完");
    ag2.stop();
    assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
    assert.equal(seen[0], "stop", "训练前先关大模型，让出显存");
    assert.ok(!seen[1].lora && seen[2].lora && /qa-lora\.gguf$/.test(seen[2].lora), "原版考一次、带上 LoRA 考一次");
    assert.equal(seen[1].name, "Teacher-Q4.gguf");
    const m = await (await fetch(url + "/pub/models/manifest.json")).json();
    assert.ok(m.models["qa-lora"] && m.models["qa-lora"].files[0].name === "lora", "考过了：发布给老师端");
    ok(`训练答题大脑：新讲解攒够了自动开一轮；训练前先让出显存；原版和带 LoRA 各考一次（答对率 ${m.models["qa-lora"].metrics.acc}、原版 ${m.models["qa-lora"].metrics.base_acc}）；考过了发布 qa-lora`);
  }

  app.close(); gsm.close(); llm.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("本地大模型 + 答题数据工厂：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
