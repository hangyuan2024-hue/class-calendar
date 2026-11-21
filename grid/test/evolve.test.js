// 底座一版版变强（第一批）：
//   · CPU 工位：有显卡的电脑另开一个只用 CPU 的工位；req.cpu 的活只给 CPU 工位（和没显卡的电脑），别的活 CPU 工位不领
//   · 前沿搜题（math_search.py）：程序出题、程序判对错；用现在发布的模型（答题 LoRA）做好几遍，有对有错的留下讲法，全错的记进前沿难题；难度自己升降
//   · 合进底座（base_merge.py）：回归考试（数学、照资料回答）挑比例——有一项退步的比例不要；发布底座永久层 base-stack（stack + bundle + train）
//   · 合进去以后：做题的电脑挂底座永久层，已经合进去的那一版答题 LoRA 不再单独挂
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const Core = require("../server/core");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-evolve-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = +process.env.UNTIL || 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });
const h = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

(async () => {
  // ---------- CPU 工位领活的规矩 ----------
  {
    const c = Core.open(":memory:", { clock: () => 1e6, leaseMs: 60000 });
    c.addRecipe({ id: "r", name: "r", key: "recipes/r.py", sig: "x" });
    const jc = c.createJob({ name: "前沿搜题（CPU）", kind: "map", recipe: "r", params: { count: 2 }, req: { cpu: true, llm: true }, priority: 5 });
    const jg = c.createJob({ name: "训练", kind: "map", recipe: "r", params: { count: 2 }, req: { llm: true, vram: 7.5 }, priority: 9 });
    const inv = c.invite({ maxUses: 5 });
    const A = c.join({ code: inv.code, name: "甲", device: { name: "大显卡" } }), N = c.join({ code: inv.code, name: "乙", device: { name: "没显卡" } });
    const lane = c.laneDevice(c.auth(A.token), { gpu: "cpu", name: "大显卡" });
    assert.equal(lane.name, "大显卡 · CPU");
    const gpuCaps = { vram: 8, llm: true }, cpuCaps = { vram: 0, llm: true, cpuOnly: true };
    assert.equal(c.lease(c.auth(A.token), gpuCaps).job.id, jg, "显卡工位：领显卡的活");
    assert.equal(c.lease(c.auth(A.token), gpuCaps).job.id, jg, "显卡工位不领 CPU 的活（留给 CPU）");
    assert.equal(c.lease(c.auth(lane.token), cpuCaps).job.id, jc, "CPU 工位：只领 CPU 的活");
    assert.equal(c.lease(c.auth(N.token), { vram: 0, llm: true }).job.id, jc, "没显卡的电脑：主工位自己做 CPU 的活");
    ok("CPU 工位：只领 req.cpu 的活；有显卡的主工位不领 CPU 的活；没显卡的电脑主工位自己做");
  }

  // ---------- 假资料、假模型 ----------
  // 数学题：「计算：a ? b …」和「x 除以 m 余数」假模型算得出来；温度 > 0.8 的那几遍故意算错（有对有错）；别的题型一律答错（全错 → 前沿难题）
  const gsm = Array.from({ length: 60 }, (_, k) => ({ question: `小明有 ${k + 3} 个苹果，又买了 ${k + 5} 个，现在有几个？`, answer: `#### ${2 * k + 8}` }));
  const cmrc = { data: Array.from({ length: 40 }, (_, k) => ({ title: "t", paragraphs: [{ context: `第${k}号城市建于${1000 + k}年。`, qas: [{ question: `第${k}号城市建于哪一年？`, answers: [{ text: `${1000 + k}年` }] }] }] })) };
  const files = await listen((q, r) => { r.writeHead(200); r.end(/gsm/.test(q.url) ? gsm.map((x) => JSON.stringify(x)).join("\n") : /cmrc/.test(q.url) ? JSON.stringify(cmrc) : ""); });
  const FU = `http://127.0.0.1:${files.address().port}`;
  // 回归考试的「质量」：按挂了哪些层、比例多少定（/v/<数学>/<阅读>）
  const quality = (spec) => { const b = spec.baseLoras || []; const sc = b.length ? b[b.length - 1].scale : 0; return sc === 1 ? [0.9, 0.5] : sc === 0.7 ? [0.8, 0.8] : sc === 0.5 ? [0.7, 0.8] : [0.6, 0.8]; };
  const calls = [];
  const llama = await listen((q, r) => { let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
    const m = JSON.parse(b), u = m.messages[m.messages.length - 1].content, qm = /\/v\/([\d.]+)\/([\d.]+)/.exec(q.url) || [0, "1", "1"], [qa, qr] = [+qm[1], +qm[2]];
    calls.push({ url: q.url, u, t: m.temperature });
    let out = "不知道";
    const ex = /计算：(.+?) = \?/.exec(u), md = /^(\d+) 除以 (\d+)，余数/.exec(u), gs = /有 (\d+) 个苹果，又买了 (\d+) 个/.exec(u), rd = /建于(\d+)年/.exec(u);
    if (ex) { let v; try { v = Function(`return ${ex[1].replace(/×/g, "*").replace(/÷/g, "/")}`)(); } catch (e) {} out = `一步一步算。\n答案：\\boxed{${m.temperature > 0.8 ? 999999 : +(+v).toFixed(6)}}`; }
    else if (md) out = `答案：\\boxed{${m.temperature > 0.8 ? 99 : +md[1] % +md[2]}}`;
    else if (gs) out = `答案：\\boxed{${h(u) % 100 < qa * 100 ? +gs[1] + +gs[2] : -1}}`;
    else if (rd) out = h(u) % 100 < qr * 100 ? `建于${rd[1]}年。` : "不清楚。";
    r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
  }); });
  const LL = `http://127.0.0.1:${llama.address().port}`;

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const db = app.core.db;
  // 已经发布了答题 LoRA 第 3 版（lora + 训练用的参数包 peft）
  const seed = (key, body) => { const f = app.store.file(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return { key, size: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") }; };
  const qaFiles = [{ name: "lora", ...seed("jobs/seed/qa-lora.gguf", Buffer.from("GGUF-qa-v3")) }, { name: "peft", ...seed("jobs/seed/qa-lora-peft.zip", Buffer.from("PK-fake-peft")) }];
  db.prepare("insert into models(name,version,files,metrics,state,created,note) values(?,?,?,?,?,?,?)").run("qa-lora", 3, JSON.stringify(qaFiles), JSON.stringify({ acc: 0.7 }), "released", 1, "");

  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "张三", { name: "大显卡" });
  const lane = await (async () => { const r = await fetch(url + "/api/lane", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + j.token }, body: JSON.stringify({ gpu: "cpu", name: "大显卡" }) }); return r.json(); })();
  assert.equal(lane.name, "大显卡 · CPU");
  const seenG = [], seenC = [];
  const fakeLlm = (seen) => ({ ensure: async (spec) => { seen.push(spec); return LL + `/v/${quality(spec).join("/")}`; }, stop: () => seen.push("stop"), version: async () => "b1" });
  const gpu = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "wg"), python: PY, caps: { vram: 8, ram: 32, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, llm: fakeLlm(seenG) });
  const cpu = Agent.create({ token: lane.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "wc"), python: PY, caps: { vram: 0, ram: 32, llm: true, cpuOnly: true, lane: "cpu" }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, llm: fakeLlm(seenC) });

  // ---------- 前沿搜题：CPU 和空闲显卡一起做 ----------
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  const sysOf = (s) => /SYSTEM = p\.get\("system"\) or \(([\s\S]*?)\)\n/.exec(s)[1];
  assert.equal(sysOf(src("recipes/math_search.py")), sysOf(src("recipes/qa_math.py")), "讲题的说法和答题数据工厂一字不差");
  const fr = JSON.parse(src("plans/frontier.json"));
  const pf = path.join(tmp, "frontier.json");
  fs.writeFileSync(pf, JSON.stringify({ ...fr, stages: fr.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2, params: { ...s.params, per: 6, samples: 6, families: ["arith", "mod", "comb"] } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  gpu.start(); cpu.start();
  const doneBy = () => db.prepare("select j.name as job, d.name as dev from tasks t join jobs j on j.id=t.job_id join devices d on d.id=t.device_id where t.state='done'").all();
  await until(() => { const d = doneBy(); return d.some((x) => /CPU/.test(x.job)) && d.some((x) => /空闲显卡/.test(x.job)); }, "两种工位都做完一批").catch((e) => { console.log(JSON.stringify(db.prepare("select t.state, t.error, j.name, j.req from tasks t join jobs j on j.id=t.job_id").all(), null, 1).slice(0, 3000)); throw e; });
  const d = doneBy();
  assert.ok(d.filter((x) => /CPU）/.test(x.job)).every((x) => x.dev === "大显卡 · CPU") && d.filter((x) => /空闲显卡/.test(x.job)).every((x) => x.dev === "大显卡"), JSON.stringify(d));
  assert.ok(seenC.some((s) => s.lora && /qa-lora/.test(s.lora)), "做题用现在发布的答题 LoRA");
  assert.ok(!fs.readdirSync(path.join(tmp, "wc"), { recursive: true }).some((f) => /peft/.test(String(f))), "做题的电脑不下训练用的参数包");
  const res = db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '前沿搜题%' and t.state='done'").all().map((x) => JSON.parse(x.result));
  assert.ok(res.every((x) => x.problems === 6 && x.lora === true), JSON.stringify(res));
  assert.ok(res.some((x) => x.learn > 0) && res.some((x) => x.hard > 0), "有对有错的留下、全错的记进前沿难题：" + JSON.stringify(res));
  const outs = db.prepare("select o.name, o.key from outputs o join jobs j on j.id=o.job_id where j.name like '前沿搜题%'").all();
  const rows = [];
  for (const o of outs.filter((o) => /qa-math-search/.test(o.name))) for (const l of (await (await fetch(app.store.url("GET", o.key, 600))).text()).split("\n")) if (l.trim()) rows.push(JSON.parse(l));
  assert.ok(rows.length && rows.every((r) => r.meta.src === "search" && r.meta.pass > 0 && r.meta.pass < 1 && !/999999|\\boxed\{99\}/.test(r.messages[2].content)), "留下的都是做对的那几遍");
  assert.ok(outs.some((o) => /^frontier-/.test(o.name)), "前沿难题也交上来了");
  assert.ok(calls.some((c) => c.t > 0.8) && calls.some((c) => c.t <= 0.8), "同一道题用不同的温度做好几遍");
  ok(`前沿搜题：CPU 工位和空闲显卡各领各的；${res.length} 批、留下 ${rows.length} 条（只留做对的），全错的记进前沿难题；用现在发布的答题 LoRA 做；不下训练用的参数包`);

  // ---------- 合进底座：回归考试挑比例 ----------
  for (const jj of db.prepare("select id from jobs where name like '前沿搜题%'").all()) db.prepare("update jobs set state='paused' where id=?").run(jj.id);
  const bp = JSON.parse(src("plans/base.json"));
  const bf = path.join(tmp, "base.json");
  fs.writeFileSync(bf, JSON.stringify({ ...bp, stages: bp.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), when: { ...s.when, outputs: 1, minHours: 0 },
    params: { ...s.params, gsm8kUrls: [FU + "/gsm.jsonl"], cmrcUrls: [FU + "/cmrc.json"], cevalUrls: [FU + "/none.zip"] } })) }));
  await Tools.cycle(admin, bf);
  app.cycle.tick();
  const pipe = app.cycle.view().pipelines.find((x) => x.name === "底座合并");
  assert.equal(pipe.runs.length, 1, "新的数据攒够了：开一轮合并");
  seenC.length = 0;
  await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "合并做完");
  assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
  const mr = JSON.parse(db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '把考过试%' and t.state='done'").get().result);
  assert.equal(mr.scale, 0.7, "×1.0 阅读退步了不要；×0.7 数学涨得比 ×0.5 多：" + JSON.stringify(mr));
  assert.ok(mr.gsm8k > mr.base_gsm8k && mr.read >= mr.base_read - 0.02 && mr.ceval == null, JSON.stringify(mr));
  assert.equal(db.prepare("select d.name from tasks t join jobs j on j.id=t.job_id join devices d on d.id=t.device_id where j.name like '把考过试%' and t.state='done'").get().name, "大显卡 · CPU", "合并的活在 CPU 工位上做");
  const man = await (await fetch(url + "/pub/models/manifest.json")).json();
  const bs = man.models["base-stack"];
  assert.ok(bs && ["stack", "bundle", "train"].every((n) => bs.files.some((f) => f.name === n)), "发布了底座永久层：stack、bundle、train");
  const stack = await (await fetch(bs.files.find((f) => f.name === "stack").url)).json();
  assert.deepEqual(stack.layers.map((l) => [l.name, l.version, l.scale]), [["qa-lora", 3, 0.7]]);
  ok(`合进底座：回归考试三个比例挑一个（×1.0 阅读退步不要，选 ×0.7：数学 ${mr.base_gsm8k}→${mr.gsm8k}）；C-Eval 下不来就不考这项；发布底座永久层（答题 LoRA 第 3 版 ×0.7）`);

  // ---------- 合进去以后：做题挂底座永久层，答题 LoRA 第 3 版不再单独挂 ----------
  for (const jj of db.prepare("select id from jobs where name like '前沿搜题（CPU%'").all()) db.prepare("update jobs set state='active' where id=?").run(jj.id);
  app.core.addTasks(db.prepare("select id from jobs where name like '前沿搜题（CPU%' order by id desc limit 1").get().id, 1);
  seenC.length = 0;
  await until(() => seenC.some((s) => s.baseLoras), "挂上底座永久层做题");
  const s2 = seenC.find((s) => s.baseLoras);
  assert.ok(s2.baseLoras.length === 1 && s2.baseLoras[0].scale === 0.7 && /layer0-qa-lora-v3\.gguf$/.test(s2.baseLoras[0].path) && !s2.lora, JSON.stringify(s2));
  ok("合进去以后：做题的电脑挂底座永久层（×0.7），已经合进去的答题 LoRA 第 3 版不再单独挂");

  gpu.stop(); cpu.stop();
  app.close(); llama.close(); files.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}
  console.log("底座一版版变强（第一批）：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
