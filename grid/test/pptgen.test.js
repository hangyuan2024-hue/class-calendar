// PPT 操作工厂（plans/ppt.json）：
//   · 练习场就是捞捞PPT助手自己改 PPT 的那一套（app/ppt/pptlab.js，用软件自带的 Node 跑）；配方里的练习场代码 ppt_gen.py、qa_train.py 两处一字不差
//   · 造数据（ppt_gen.py）：模型每道题做几遍，程序判对错；都没做对的按比例用程序写的示范（也要判对才算）→ 每一步一条训练数据（带工具调用）
//   · 训练（qa_train.py，exam=ppt，dryRun 不真训）：在练习场里真的去改着考（练过的 + 没练过的），原版、带 LoRA 各考一次 → 逐题比，真变好了才发布 ppt-lora
//   · 顺便复习老本行（mixOf）：别的数据按比例混进来
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ppt-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

(async () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  const block = (s) => { const a = s.indexOf("# ==== PPT 练习场"), b = s.indexOf("# ==== PPT 练习场 结束 ===="); return a >= 0 && b > a ? s.slice(a, b) : null; };
  assert.ok(block(src("recipes/ppt_gen.py")) && block(src("recipes/ppt_gen.py")) === block(src("recipes/qa_train.py")), "练习场的代码两处一字不差");
  assert.equal(src("app/ppt/pptlab.js"), fs.readFileSync(path.join(ROOT, "..", "pptassist", "core", "pptlab.js"), "utf8").replace(/\r\n/g, "\n"), "练习场和捞捞PPT助手的是同一份");
  ok("练习场：配方里的两处一字不差；用的是捞捞PPT助手自己的 pptlab.js");

  // 假的本地大模型：没带 LoRA 的「不会改」（只说一句话、不调工具）；带 LoRA 的会改标题、换配色
  const THEMES = { 绿色: "green", 紫色: "berry", 橙色: "orange", 黑板风格: "board", 深色: "dark", 蓝色: "blue" };
  const calls = { dumb: 0, smart: 0 };
  const fake = (smart0) => listen((q, r) => {
    let smart;
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      const m = JSON.parse(b), last = m.messages[m.messages.length - 1];
      smart = smart0 || (m.lora || []).some((x) => x.scale === 1);   // 同时考：带 LoRA 的那一半请求里写着比例 1
      calls[smart ? "smart" : "dumb"]++;
      assert.ok(Array.isArray(m.tools) && m.tools.some((t) => t.function.name === "set_text"), "带着改 PPT 的工具");
      let msg = { role: "assistant", content: "好的" };
      if (smart) {
        const u = String(last.content || "");
        const t = /第 ?(\d+) ?页的?标题(?:改成|换成)[「“：]?([^」”]+)[」”]?/.exec(u), th = Object.keys(THEMES).find((k) => u.includes(k) && /换|改/.test(u));
        if (last.role === "tool") msg = { role: "assistant", content: "改好了。" };
        else if (t) msg = { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "set_text", arguments: JSON.stringify({ slide: +t[1], shape: "title", lines: [t[2].replace(/吧$/, "")] }) } }] };
        else if (th) msg = { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "set_theme", arguments: JSON.stringify({ theme: THEMES[th] }) } }] };
      }
      r.writeHead(200, { "Content-Type": "application/json" });
      r.end(JSON.stringify({ choices: [{ message: msg }] }));
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
  const plan = JSON.parse(src("plans/ppt.json"));
  const pf = path.join(tmp, "ppt.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.filter((s) => s.key !== "cpu").map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2,
    params: { ...s.params, per: 6, tries: 2, demoShare: 1, parallel: 1 } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  const ag = mk("w");
  ag.start();
  const db = app.core.db;
  const job = db.prepare("select * from jobs where name like '练改 PPT%' order by id desc limit 1").get();
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(job.id).n >= 2, "造 2 批");
  ag.stop();
  const res = db.prepare("select result from tasks where job_id=? and state='done' order by seq").all(job.id).map((x) => JSON.parse(x.result));
  assert.ok(res.every((x) => x.problems === 6 && x.solved === 0 && x.demos === 6 && x.rows >= 6), JSON.stringify(res));
  const rows = [];
  for (const o of db.prepare("select key from outputs where job_id=?").all(job.id)) for (const l of (await (await fetch(app.store.url("GET", o.key, 600))).text()).split("\n")) if (l.trim()) rows.push(JSON.parse(l));
  assert.ok(rows.every((r) => r.tools === "$ppt" && r.messages[0].role === "system" && r.messages[r.messages.length - 1].role === "assistant"), "每条：系统提示开头、模型说的一句结尾、工具说明另记");
  assert.ok(rows.some((r) => r.messages[r.messages.length - 1].tool_calls) && rows.some((r) => !r.messages[r.messages.length - 1].tool_calls && r.messages.some((m) => m.role === "tool")), "有调工具的一步、也有做完以后总结的一句");
  assert.ok(rows.every((r) => r.messages.filter((m) => m.role === "tool").every((m) => typeof m.content === "string")), "工具的结果原样给模型看");
  ok(`PPT 操作工厂：${res.length} 批，自己做对 0 道（这个假模型不会改），都用程序写的示范（判对了才要）→ ${rows.length} 条（每一步一条）`);

  // ---------- 训练（dryRun）：在练习场里真的去改着考 ----------
  const spec = JSON.parse(fs.readFileSync(pf, "utf8"));
  const trs = spec.stages.find((s) => s.key === "train");
  trs.params = { ...trs.params, dryRun: true, minExamples: 1, evalN: 16, oodN: 8, mixOf: [{ tag: "ppt", max: 5 }], mixShare: 0.3, evalLlm: { name: "Teacher-Q4.gguf", urls: ["http://x/y.gguf"] } };
  trs.when = { ...trs.when, outputs: 2, minHours: 0 };
  fs.writeFileSync(pf, JSON.stringify(spec));
  await Tools.cycle(admin, pf);
  const seen = [];
  calls.dumb = calls.smart = 0;
  app.cycle.tick();
  const pipe = app.cycle.view().pipelines.find((x) => x.name === "PPT 操作工厂");
  assert.ok(pipe.runs.length === 1, "新数据攒够了就训练");
  db.prepare("update jobs set state='paused' where id=?").run(job.id);
  const ag2 = mk("w2", seen);
  ag2.start();
  await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "训练做完", 180000);
  ag2.stop();
  assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
  const r2 = JSON.parse(db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '训练改 PPT%' and t.state='done'").get().result);
  assert.ok(seen.some((s) => s && Array.isArray(s.extraLoras) && /ppt-lora\.gguf$/.test(s.extraLoras[0])), "原版、带上 ppt-lora 同时考");
  assert.equal(r2.n, 24); assert.equal(r2.items.length, 24); assert.equal(r2.base_acc, 0);
  assert.ok(r2.acc > 0 && r2.gain > 0 && r2.ood != null && r2.base_ood === 0, JSON.stringify(r2));
  assert.ok(r2.mixed > 0, "顺便复习：混进了别的数据");
  const m = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(m.models["ppt-lora"] && m.models["ppt-lora"].metrics.acc === r2.acc, "逐题比真的变好了：发布 ppt-lora");
  ok(`训练改 PPT：练过的 ${r2.base_acc} → ${r2.acc}、没练过的 ${r2.base_ood} → ${r2.ood}（逐题比涨 ${r2.gain}）→ 发布 ppt-lora；复习了 ${r2.mixed} 条别的`);

  app.close(); dumb.close(); smart.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}
  console.log("PPT 操作工厂：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
