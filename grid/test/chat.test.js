// 口语对话工厂（plans/chat.json）：
//   · 配方 chat_gen.py（假的本地大模型）：出问题 → 口语答两遍、挑念得出来的；算题的答案要和纸上解的对上；
//     带列表、符号、太长的回答不要；三成左右把问题改成「识别出来的样子」；讲解再追问一句
//   · 训练（qa_train.py，exam=chat，dryRun 不真训）：攒够了自动开一轮；口语考题原版、带 LoRA 各考一次（关键信息、念不念得出来）→ 发布 chat-lora
//   · 三份「语音通话规则」（chat_gen.py、qa_train.py、成品展示的 xiaozhi.js）一字不差；两边的检查规则也一样
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-chat-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, "127.0.0.1", () => r(s)); });

(async () => {
  // ---------- 三份规则一字不差 ----------
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");   // Windows 上 git 取出来是 \r\n（Python 读的时候会变回 \n）
  const spokenPy = (s) => /SPOKEN = """([\s\S]*?)"""/.exec(s)[1];
  const gen = src("recipes/chat_gen.py"), tr = src("recipes/qa_train.py");
  assert.equal(spokenPy(gen), spokenPy(tr), "chat_gen.py 和 qa_train.py 的语音通话规则要一样");
  const XZ = require(path.join(ROOT, "app", "ppt", "xiaozhi.js"));   // 打包前从 pptassist/core 拷过来（npm run prepare-ui），用 grid 自己装的依赖
  assert.equal(XZ.SPOKEN, spokenPy(gen), "成品展示打电话时加的规则要和训练时的一样");
  const fnSrc = (s, name) => { const m = new RegExp(`\\n(def ${name}\\([\\s\\S]*?)\\n\\n\\n`).exec(s); return m && m[1]; };
  for (const f of ["speakable", "zh_ratio", "cn_num", "numbers_in"]) assert.equal(fnSrc(tr, f), fnSrc(gen, f), `检查规则 ${f} 两边要一样`);
  for (const v of ["LIMIT", "BAD", "AGREE", "CN", "UNIT"]) { const r = new RegExp(`\\n${v} = [\\s\\S]*?\\n(?=\\S)`); assert.equal(r.exec(tr)[0].trim(), r.exec(gen)[0].trim(), `${v} 两边要一样`); }
  ok("语音通话规则：造数据、训练考试、成品展示打电话三处一字不差；念不念得出来的检查两边一样");

  // ---------- 假的本地大模型 ----------
  const calls = [];
  let bad = 0, examMode = false;
  const llm = await listen((q, r) => {
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      const m = JSON.parse(b), ms = m.messages, u = ms[ms.length - 1].content, sys = ms[0].role === "system" ? ms[0].content : "";
      calls.push(m);
      let out;
      if (/写出他会怎么说/.test(u)) out = "冒泡排序是怎么排的呀？";
      else if (/出一道/.test(u)) out = "一个长方形长五米、宽二米，周长是多少呀？";
      else if (/换一种说法/.test(u)) out = "你到底是谁呀？";
      else if (/同样含糊/.test(u)) out = "帮我弄下那个吧";
      else if (/你是数学老师/.test(sys)) out = "周长 = (5+2)×2 = 14。\n答案：\\boxed{14}";
      else if (/语音通话/.test(sys)) {
        // 每三次故意答一个「写文章」的样子：要被挡掉
        // 考试的时候按题目定（两次考试并发、顺序不定，用计数会时好时坏）
        if (examMode ? [...u].reduce((h, c) => h + c.charCodeAt(0), 0) % 3 === 0 : ++bad % 3 === 0) out = "**冒泡排序**：\n1. 比较相邻的两个数\n2. 交换";
        else if (/对吧|是吧|对不对|没错吧/.test(u)) { const m = /(\d+) 乘 (\d+)/.exec(u); out = m && u.length % 2 ? `不对哦，${m[1]} 乘 ${m[2]} 应该等于 ${m[1] * m[2]}，你再仔细算一遍试试看吧。` : m ? `对，没错，就是${m[1] * m[2]}。` : "对，没错。"; }
        else if (/周长/.test(u) || /周常/.test(u)) out = "长加宽是七米，周长是两个七米，一共十四米。";
        else if (/排/.test(u)) out = "冒泡排序就是把相邻的两个数比一比，大的往后换。一轮一轮做下去，大的就冒到最后了。要不要我拿几个数走一遍？";
        else if (/谁/.test(u)) out = "我是捞小智，你的校园小助手。";
        else if (/那个|弄|它|订|看着办|改一下/.test(u)) out = "你说的是哪一个呀？";
        else if (/简单|例子|为什么|然后|再讲|考试|办法/.test(u)) out = "比如三、一、二，先比三和一，三大就往后换，换完是一、三、二。";
        else out = "这个我不太确定，你能再说具体一点吗？";
      } else out = "嗯";
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
  let ensured = null;
  const ag = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w"), python: PY, caps: { vram: 8, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    llm: { ensure: async (spec, say) => { ensured = spec; say("准备好了"); return LLM; }, stop: () => {} } });
  const plan = JSON.parse(src("plans/chat.json"));
  const pf = path.join(tmp, "chat.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)), keep: 2,
    params: { ...s.params, per: 12, parallel: 1, noise: 0.5, followup: 1, mix: { explain: 4, math: 2, chat: 2, clarify: 1, correct: 3 } } })) }));
  await Tools.cycle(admin, pf);
  app.cycle.tick();
  ag.start();
  const db = app.core.db;
  const job = db.prepare("select * from jobs where name like '造口语对话%' and name not like '%局域网%' order by id desc limit 1").get();
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(job.id).n >= 2, "造 2 批");
  ag.stop();
  assert.equal(ensured.name, plan.stages[0].params.llm.name, "按任务参数准备模型");
  const res = db.prepare("select result from tasks where job_id=? and state='done' order by seq").all(job.id).map((x) => JSON.parse(x.result));
  assert.ok(res.every((x) => x.asked === 12), JSON.stringify(res));
  assert.ok(res.reduce((a, x) => a + x.kept, 0) >= 12, "大部分留下：" + JSON.stringify(res));
  // 交上来的对话：都念得出来；算题的答案对；有「识别出来的样子」；有两轮的
  const outs = db.prepare("select key from outputs where job_id=?").all(job.id);
  const rows = [];
  for (const o of outs) {
    const t = await (await fetch(app.store.url("GET", o.key, 600))).text();
    for (const l of t.split("\n")) if (l.trim()) rows.push(JSON.parse(l));
  }
  const last = (r) => r.messages[r.messages.length - 1].content;
  assert.ok(rows.length >= 12);
  assert.ok(rows.every((r) => !/\*\*|\n|^\d+\./.test(last(r))), "带列表、符号的回答都挡掉了");
  assert.ok(rows.every((r) => r.messages[0].role === "system" && r.messages[0].content.includes(XZ.SPOKEN)), "训练数据带着语音通话规则");
  assert.ok(rows.some((r) => r.meta.kind === "math" && /十四/.test(last(r))), "算题：口语里说的数和纸上解的（14）对上");
  assert.ok(rows.some((r) => r.meta.noisy && r.meta.heard !== r.messages[1].content), "有「识别出来的样子」（原话记在 heard）");
  assert.ok(rows.some((r) => r.meta.kind === "followup" && r.messages.length === 5), "有两轮的对话");
  assert.ok(rows.some((r) => r.meta.kind === "clarify" && /[？?]/.test(last(r))), "没说清楚的：先问一句");
  assert.ok(rows.some((r) => r.meta.kind === "correct"), "有「不讨好」的对话");
  assert.ok(rows.filter((r) => r.meta.kind === "correct").every((r) => !/^对/.test(last(r)) && /不对/.test(last(r))), "对方说错了：留下的都是纠正的，附和的挡掉");
  assert.ok(rows.every((r) => !/好问题|你真是太棒了/.test(last(r))), "没有空洞夸奖");
  const gens = calls.filter((m) => m.messages[0].role === "system" && /语音通话/.test(m.messages[0].content));
  assert.ok(gens.every((m) => m.chat_template_kwargs.enable_thinking === false), "回答不用长思考（快）");
  ok(`口语对话工厂：问 ${res.length * 12} 条、留下 ${rows.length} 段；带列表 / 符号的挡掉，算题的数对上，有识别错字的问法、有追问、没说清楚的先问一句`);

  // ---------- 训练口语对话大脑（没有显卡：dryRun 只检查数据、转交、考试、发布）----------
  {
    const spec = JSON.parse(fs.readFileSync(pf, "utf8"));
    const trs = spec.stages.find((s) => s.key === "train");
    trs.params = { ...trs.params, dryRun: true, minExamples: 1, evalLlm: { name: "Teacher-Q4.gguf", urls: ["http://x/y.gguf"] } };
    trs.when = { ...trs.when, outputs: 2, minHours: 0 };
    fs.writeFileSync(pf, JSON.stringify(spec));
    await Tools.cycle(admin, pf);
    const seen = [];
    calls.length = 0; examMode = true;
    const ag2 = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w2"), python: PY, caps: { vram: 8, llm: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
      llm: { ensure: async (sp) => { seen.push(sp); return LLM; }, stop: () => seen.push("stop"), version: async () => "b1234" } });
    app.cycle.tick();
    const pipe = app.cycle.view().pipelines.find((x) => x.name === "口语对话工厂");
    assert.equal(pipe.when.outputsOf, "chat"); assert.ok(pipe.runs.length === 1, "新对话攒够了就训练");
    db.prepare("update jobs set state='paused' where id=?").run(job.id);
    ag2.start();
    await until(() => db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state !== "running", "训练做完", 120000);
    ag2.stop();
    assert.equal(db.prepare("select state from runs where id=?").get(pipe.runs[0].id).state, "done");
    assert.equal(seen[0], "stop", "训练前先关大模型，让出显存");
    assert.ok(seen.some((s) => s && Array.isArray(s.extraLoras) && /chat\-lora\.gguf$/.test(s.extraLoras[0]) && s.slots === 4), "原版、带上 chat-lora 同时考（一个大模型里挂着，请求里写比例）");
    const exams = calls.filter((m) => m.messages[0].role === "system" && /语音通话/.test(m.messages[0].content));
    assert.equal(exams.length, 90, "口语考题 45 道 × 两次");
    assert.ok(exams.some((m) => /排续/.test(m.messages[1].content)), "考题里有带识别错字的问法");
    const tr2 = db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.name like '训练口语%' and t.state='done'").get();
    const r2 = JSON.parse(tr2.result);
    assert.ok(r2.acc > 0 && r2.speak > 0 && r2.base_speak != null, JSON.stringify(r2));
    const m = await (await fetch(url + "/pub/models/manifest.json")).json();
    assert.ok(m.models["chat-lora"] && m.models["chat-lora"].files[0].name === "lora", "考过了：发布 chat-lora");
    assert.ok(m.models["chat-lora"].metrics.speak != null && m.models["chat-lora"].metrics.base_speak != null);
    ok(`训练口语对话大脑：攒够了自动开一轮；口语考题原版、带 LoRA 各考一次（关键信息 ${r2.acc}、念得出来 ${r2.speak}）→ 发布 chat-lora`);
  }

  app.close(); llm.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}
  console.log("口语对话工厂：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
