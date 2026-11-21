// 先核对再回答工厂（plans/ground.json）：
//   · 配方 ground_gen.py（假的本地大模型 + 假的 CMRC 资料）：照资料回答 → 程序核对（答案、出处、数字）合格才留；资料里没有的要说没有；
//     从合格的回答构造核对题（原句有据、换答案矛盾、插别处的话无据），标签是构造出来的
//   · 训练（qa_train.py，exam=ground，dryRun 不真训）：固定考题原版、带 LoRA 各考一次（acc / abstain / catch / clean）→ 过了固定及格线才发布 ground-lora
//   · 回答、核对的说法（ground_gen.py、qa_train.py、捞小智的 ground.js）一字不差
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ground-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

// 假的 CMRC：每段讲一座城市，问它建于哪一年
const NAMES = ["北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "重庆"];
const squad = (from, n) => ({ data: Array.from({ length: n }, (_, k) => { const x = NAMES[k % 10] + "第" + (from + k) + "区"; return { title: x, paragraphs: [{ context: `${x}是一座城市。${x}建于${1000 + from + k}年。这座城市以美食闻名，每年吸引很多游客。当地有一条河叫${x}河，长${from + k + 30}公里。`, qas: [{ question: `${x}建于哪一年？`, answers: [{ text: `${1000 + from + k}年` }] }] }] }; }) });

(async () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  const G = require(path.join(ROOT, "app", "ppt", "ground.js"));
  const gen = src("recipes/ground_gen.py"), tr = src("recipes/qa_train.py");
  const py = (s, v) => new RegExp(`\\n${v} = """([\\s\\S]*?)"""`).exec(s)[1];
  assert.equal(py(gen, "ANSWER_SYS"), G.ANSWER_SYS); assert.equal(py(tr, "G_ANSWER_SYS"), G.ANSWER_SYS);
  assert.equal(py(gen, "CHECK_SYS"), G.CHECK_SYS); assert.equal(py(tr, "G_CHECK_SYS"), G.CHECK_SYS);
  assert.ok(gen.includes(`ABSTAIN = "${G.ABSTAIN}"`) && tr.includes(`G_ABSTAIN = "${G.ABSTAIN}"`));
  const fnSrc = (t, name) => { const m = new RegExp(`\\n(def ${name}\\([\\s\\S]*?)\\n\\n\\n`).exec(t); return m && m[1]; };
  assert.ok(fnSrc(gen, "as_outline") && fnSrc(gen, "as_outline") === fnSrc(tr, "as_outline"), "资料换成导图样子的写法两边一样");
  ok("回答、核对的说法：造数据、训练考试、捞小智三处一字不差；导图样子的资料两边一样");

  // ---------- 假资料、假的本地大模型（照资料答、按资料核对：一个「好学生」） ----------
  const files = await listen((q, r) => { r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify(/dev/.test(q.url) ? squad(5000, 300) : squad(0, 300))); });
  const FU = `http://127.0.0.1:${files.address().port}`;
  const calls = [];
  const llm = await listen((q, r) => {
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      const m = JSON.parse(b), sys = m.messages[0].content, u = m.messages[m.messages.length - 1].content;
      calls.push(m);
      const mats = [...u.split("回答：")[0].matchAll(/^\[(\d+)\] ([\s\S]*?)(?=\n\n\[\d+\] |\n\n问题：)/gm)].map((x) => ({ n: +x[1], t: x[2].replace(/\n- /g, "") }));
      let out = "嗯";
      if (sys === G.ANSWER_SYS) {
        const who = (/问题：(.*?)建于/.exec(u) || [])[1];
        const hit = mats.find((x) => who && x.t.includes(who + "建于"));
        out = hit ? `${who}建于${/建于(\d+)年/.exec(hit.t.slice(hit.t.indexOf(who + "建于")))[1]}年。[${hit.n}]这座城市以美食闻名。[${hit.n}]` : `资料里没有${who || "这个地方"}的建城时间，可以查当地的地方志。`;
      } else if (sys === G.CHECK_SYS) {
        const all = mats.map((x) => x.t).join("");
        out = [...u.matchAll(/^第(\d+)句：(.*)$/gm)].map((x) => { const s = x[2].replace(/\[\d+\]/g, "").replace(/[。]/g, ""); const c = (/\[(\d+)\]/.exec(x[2]) || [])[1] || 1; return `第${x[1]}句：${all.includes(s) ? "有据[" + c + "]" : /建于/.test(s) ? "矛盾[" + c + "]" : "无据"}`; }).join("\n");
      }
      r.writeHead(200, { "Content-Type": "application/json" });
      r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    });
  });
  const LLM = `http://127.0.0.1:${llm.address().port}`;

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "张三", { name: "大显卡" });
  const mk = (wd, seen) => Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, wd), python: PY, caps: { vram: 8, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    llm: { ensure: async (sp) => { seen && seen.push(sp); return LLM; }, stop: () => seen && seen.push("stop"), version: async () => "b1234" } });
  const plan = JSON.parse(src("plans/ground.json"));
  const pf = path.join(tmp, "ground.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2,
    params: { ...s.params, per: 8, parallel: 1, trainUrls: [FU + "/train.json"], evalUrls: [FU + "/dev.json"] } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  const ag = mk("w");
  ag.start();
  const db = app.core.db;
  const job = db.prepare("select * from jobs where name like '造「照资料%' order by id desc limit 1").get();
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(job.id).n >= 2, "造 2 批");
  ag.stop();
  const res = db.prepare("select result from tasks where job_id=? and state='done' order by seq").all(job.id).map((x) => JSON.parse(x.result));
  assert.ok(res.every((x) => x.answer === 8 && x.abstain >= 1 && x.check >= 8), JSON.stringify(res));
  const rows = [];
  for (const o of db.prepare("select key from outputs where job_id=?").all(job.id)) for (const l of (await (await fetch(app.store.url("GET", o.key, 600))).text()).split("\n")) if (l.trim()) rows.push(JSON.parse(l));
  const last = (r) => r.messages[r.messages.length - 1].content;
  assert.ok(rows.filter((r) => r.kind === "answer").every((r) => /\[\d\]/.test(last(r)) && !last(r).startsWith(G.ABSTAIN)), "照资料回答：都标了出处");
  assert.ok(rows.filter((r) => r.kind === "abstain").every((r) => last(r).startsWith(G.ABSTAIN)), "资料里没有：开头就说没有");
  const chk = rows.filter((r) => r.kind === "check");
  assert.ok(chk.some((r) => /矛盾/.test(last(r))) && chk.some((r) => /无据/.test(last(r))) && chk.some((r) => !/矛盾|无据/.test(last(r))), "核对题：有全对的、有矛盾的、有无据的");
  for (const r of chk.filter((r) => /矛盾/.test(last(r)))) {
    const i = +/第(\d+)句：矛盾/.exec(last(r))[1], s = new RegExp(`第${i}句：(.*)`).exec(r.messages[1].content)[1];
    assert.ok(!r.messages[1].content.split("回答：")[0].includes(s.replace(/\[\d+\]/g, "")), "标成矛盾的那句确实和资料不一样");
  }
  assert.ok(rows.some((r) => / › \n?- /.test(r.messages[1].content) || / › - /.test(r.messages[1].content)), "有一部分资料是思维导图的样子");
  ok(`先核对再回答工厂：${res.length} 批、${rows.length} 条（回答 ${rows.filter((r) => r.kind === "answer").length}、没有就说没有 ${rows.filter((r) => r.kind === "abstain").length}、核对题 ${chk.length}）；标签是构造出来的`);

  // ---------- 训练（dryRun）：固定考题、固定及格线 ----------
  const spec = JSON.parse(fs.readFileSync(pf, "utf8"));
  const trs = spec.stages.find((s) => s.key === "train");
  trs.params = { ...trs.params, dryRun: true, minExamples: 1, evalLlm: { name: "Teacher-Q4.gguf", urls: ["http://x/y.gguf"] } };
  trs.when = { ...trs.when, outputs: 2, minHours: 0 };
  fs.writeFileSync(pf, JSON.stringify(spec));
  await Tools.cycle(admin, pf);
  const seen = [];
  calls.length = 0;
  app.cycle.tick();
  const pipe = app.cycle.view().pipelines.find((x) => x.name === "先核对再回答工厂");
  assert.equal(pipe.when.outputsOf, "ground"); assert.ok(pipe.runs.length === 1, "新数据攒够了就训练");
  db.prepare("update jobs set state='paused' where id=?").run(job.id);
  const ag2 = mk("w2", seen);
  ag2.start();
  await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "训练做完", 120000);
  ag2.stop();
  assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
  assert.ok(!seen[1].lora && /ground-lora\.gguf$/.test(seen[2].lora), "原版考一次、带上 ground-lora 考一次");
  assert.equal(calls.length, 300, "固定考题 150 道（该答 60、没有 40、核对 50）× 两次");
  const r2 = JSON.parse(db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '训练先核对%' and t.state='done'").get().result);
  for (const k of ["acc", "abstain", "catch", "clean"]) assert.ok(r2[k] >= 0.85 && r2["base_" + k] != null, k + "：" + JSON.stringify(r2));
  const m = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(m.models["ground-lora"] && m.models["ground-lora"].metrics.catch != null, "过了固定及格线：发布 ground-lora");
  ok(`训练先核对再回答：答对 ${r2.acc}、没有就说没有 ${r2.abstain}、错句抓出 ${r2.catch}、对的不冤枉 ${r2.clean} → 过了及格线，发布 ground-lora`);

  app.close(); llm.close(); files.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}
  console.log("先核对再回答工厂：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
