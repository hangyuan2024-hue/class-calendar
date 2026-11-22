// 看图反推工厂（plans/vision.json）：
//   · 看图的说法（vis_gen.py）和捞捞PPT助手（app/ppt/eyes.js）一字不差
//   · 造数据（vis_gen.py，CPU）：程序画 PPT 页面、卡通小人，故意弄脏；标签是画的时候就知道的 → 数据包（rows.jsonl + 图片）；每一轮第一个小任务另外交一份固定考卷
//   · 训练（qa_train.py，exam=vision，dryRun 不真训）：带图考（data:image/jpeg;base64），原版、带 LoRA 各一次 → 逐题比真变好了才发布 vision-lora
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const JSZip = require("jszip");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-vis-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const E = require("../app/ppt/eyes");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

(async () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  const gen = src("recipes/vis_gen.py");
  const lit = (v) => JSON.parse(new RegExp(`\\n${v} = (".*")\\n`).exec(gen)[1]);
  for (const k of ["SLIDE_SYS", "SLIDE_ASK", "DOLL_SYS", "DOLL_ASK"]) assert.equal(lit(k), E[k], k);
  assert.deepStrictEqual(JSON.parse(/\nPALETTE = (\{.*\})\n/.exec(gen)[1]), E.PALETTE);
  assert.deepStrictEqual(JSON.parse(/\nSLIDE_LAYOUTS = (\[.*\])\n/.exec(gen)[1]), E.SLIDE_LAYOUTS);
  assert.deepStrictEqual(JSON.parse(/\nDOLL = (\{.*\})\n/.exec(gen)[1]), E.DOLL);
  assert.equal(src("app/ppt/eyes.js"), fs.readFileSync(path.join(ROOT, "..", "pptassist", "core", "eyes.js"), "utf8").replace(/\r\n/g, "\n"));
  ok("看图的说法、公仔特征的取值：造数据和捞捞PPT助手一字不差");

  // 假的本地大模型：带 LoRA 的「看得懂」（测试从考卷里查到这张图的答案），原版只会说一句不相干的
  const answers = new Map();
  let got = 0;
  const fake = (smart0) => listen((q, r) => {
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      const m = JSON.parse(b), u = m.messages[1].content, img = u.find((x) => x.type === "image_url");
      const smart = smart0 || (m.lora || []).some((x) => x.scale === 1);   // 同时考：带 LoRA 的那一半请求里写着比例 1
      assert.ok(img && /^data:image\/jpeg;base64,/.test(img.image_url.url), "带着图片问");
      got++;
      const out = smart ? answers.get(img.image_url.url.split(",")[1]) || "{}" : "这是一张图片。";
      r.writeHead(200, { "Content-Type": "application/json" });
      r.end(JSON.stringify({ choices: [{ message: { content: smart ? "```json\n" + out + "\n```" : out } }] }));
    });
  });
  const dumb = await fake(false), smart = await fake(true);
  const U = (s) => `http://127.0.0.1:${s.address().port}`;

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "张三", { name: "大显卡" });
  const mk = (wd, seen) => Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, wd), python: PY, caps: { vram: 8, llm: true, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    llm: { ensure: async (sp) => { seen && seen.push(sp); return sp.lora ? U(smart) : U(dumb); }, stop: () => seen && seen.push("stop"), version: async () => "b1234" } });
  const plan = JSON.parse(src("plans/vision.json"));
  const pf = path.join(tmp, "vision.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.filter((s) => s.key !== "photo").map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2, req: s.key === "draw" ? {} : s.req,
    params: { ...s.params, per: 12, examN: 10 } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  const ag = mk("w");
  ag.start();
  const db = app.core.db;
  const job = db.prepare("select * from jobs where name like '画 PPT 页面%' order by id desc limit 1").get();
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(job.id).n >= 2, "画 2 批");
  ag.stop();
  const res = db.prepare("select result from tasks where job_id=? and state='done' order by seq").all(job.id).map((x) => JSON.parse(x.result));
  assert.ok(res.every((x) => x.rows === 12 && x.kinds.slide === 6 && x.kinds.doll === 6), JSON.stringify(res));
  assert.equal(res.filter((x) => x.exam === 20).length, 1, "一轮只有第一个小任务交考卷");
  let n = 0, exams = 0;
  for (const o of db.prepare("select key from outputs where job_id=?").all(job.id)) {
    const z = await JSZip.loadAsync(Buffer.from(await (await fetch(app.store.url("GET", o.key, 600))).arrayBuffer()));
    const rows = (await z.file("rows.jsonl").async("string")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const r of rows) {
      const im = r.messages[1].content.find((x) => x.type === "image");
      const buf = await z.file(im.image).async("nodebuffer");
      assert.ok(buf[0] === 0xff && buf[1] === 0xd8, "图片是 jpg");
      assert.equal(r.messages[2].content, JSON.stringify(r.target), "答案就是画的时候用的数据");
      assert.equal(r.messages[0].content, r.kind === "slide" ? E.SLIDE_SYS : E.DOLL_SYS);
      if (r.exam) { exams++; answers.set(buf.toString("base64"), r.messages[2].content); }
      if (r.kind === "doll") assert.ok(E.dollToPerson(r.target) && Object.keys(E.dollToPerson(r.target)).length === 9, "公仔特征能直接换到形象上");
      if (r.kind === "slide") assert.ok(E.cleanSlide(r.target), "页面数据能直接加成一页");
      n++;
    }
  }
  assert.equal(exams, 20);
  ok(`看图反推工厂：${res.length} 批 ${n} 张（PPT 页面、卡通小人各一半，答案是画的时候就知道的）+ 一份 ${exams} 道的固定考卷`);

  // ---------- 训练（dryRun）：带图考 ----------
  const spec = JSON.parse(fs.readFileSync(pf, "utf8"));
  const trs = spec.stages.find((s) => s.key === "train");
  trs.params = { ...trs.params, dryRun: true, minExamples: 1, evalLlm: { name: "Teacher-Q4.gguf", urls: ["http://x/y.gguf"] } };
  trs.when = { ...trs.when, outputs: 2, minHours: 0 };
  fs.writeFileSync(pf, JSON.stringify(spec));
  await Tools.cycle(admin, pf);
  const seen = [];
  app.cycle.tick();
  const pipe = app.cycle.view().pipelines.find((x) => x.name === "看图反推工厂");
  assert.ok(pipe.runs.length === 1, "新数据攒够了就训练");
  db.prepare("update jobs set state='paused' where id=?").run(job.id);
  const ag2 = mk("w2", seen);
  ag2.start();
  await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "训练做完", 180000);
  ag2.stop();
  assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
  const r2 = JSON.parse(db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '训练眼力%' and t.state='done'").get().result);
  assert.ok(seen.some((s) => s && s.mmproj && s.mmproj.name), "考试带着看图的组件（mmproj）");
  assert.equal(r2.n, 20); assert.equal(r2.base_acc, 0); assert.equal(r2.acc, 1); assert.equal(r2.slide, 1); assert.equal(r2.doll, 1);
  const m = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(m.models["vision-lora"], "逐题比真的变好了：发布 vision-lora");
  ok(`训练眼力：原版 ${r2.base_acc} → ${r2.acc}（PPT 页面 ${r2.slide}、公仔 ${r2.doll}）→ 发布 vision-lora`);

  app.close(); dumb.close(); smart.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}
  console.log("看图反推工厂：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
