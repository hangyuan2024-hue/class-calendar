// 成品展示「捞小智」（算力客户端里）：调度中心发布了新版 → 自动下载、换上、记一笔；讲题带着最新的答题 LoRA；
//   一句一句合成声音（带口型）；这台电脑在算任务时不抢显卡；没打开过展示的电脑不去下模型
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const Show = require("../app/show");
const ok = (m) => console.log("✓", m);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-show-"));
  // 假的调度中心：发布清单 + 模型文件
  let models = {};
  const blobs = new Map();
  const srv = http.createServer((q, r) => {
    const u = q.url.split("?")[0];
    if (u === "/pub/models/manifest.json") { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ models })); }
    if (blobs.has(u)) return r.end(blobs.get(u));
    r.statusCode = 404; r.end();
  });
  await new Promise((d) => srv.listen(0, "127.0.0.1", d));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const publish = (name, version, files, metrics = {}) => { models[name] = { version, metrics, files: Object.entries(files).map(([k, [file, body]]) => { const b = Buffer.from(body); blobs.set(`/pub/${name}/${version}/${file}`, b); return { name: k, url: `${base}/pub/${name}/${version}/${file}`, size: b.length, sha256: sha(b) }; }) }; };
  // 假的大模型
  const reqs = [];
  const llama = http.createServer((q, r) => {
    let b = ""; q.on("data", (c) => (b += c));
    q.on("end", () => { const body = JSON.parse(b || "{}"); reqs.push(body); r.writeHead(200, { "content-type": "text/event-stream" });
      const ms = body.messages || [], last = ms[ms.length - 1] || {}, t = typeof last.content === "string" ? last.content : "";
      const call = (name, args) => { r.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c" + reqs.length, function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`); r.end("data: [DONE]\n\n"); };
      if (last.role === "user" && /做一份.*PPT/.test(t)) return call("make_ppt", { title: "数组", subtitle: "C 语言 · 第 5 章", theme: "green", slides: [{ title: "什么是数组", lines: ["一组类型相同的变量", "用下标访问"] }, { layout: "code", title: "定义数组", code: "int a[5];", lang: "C" }, { title: "小结", lines: ["下标从 0 开始"] }] });
      if (last.role === "user" && t === "校运会是哪天") return call("answer_from_sources", { question: "校运会是哪天" });
      if (last.role === "user" && /两栏/.test(t)) return call("edit_slide", { slide: 2, layout: "compare", left: { head: "变量", lines: ["一次存一个数"] }, right: { head: "数组", lines: ["一次存一组数"] } });
      if (last.role === "tool") { r.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "好了。" } }] })}\n\n`); return r.end("data: [DONE]\n\n"); }
      for (const w of ["先设未知数。", "解得 x=4。", "答案：4"]) r.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); r.end("data: [DONE]\n\n"); });
  });
  await new Promise((d) => llama.listen(0, "127.0.0.1", d));
  const ensured = []; let badLora = null, task = null, used = false;
  const llm = { ok: () => true, running: () => true, touch() {}, ensure: async (spec) => { ensured.push(spec); if (badLora && spec.lora && spec.lora.includes(badLora)) throw new Error("LoRA 加载失败"); return `http://127.0.0.1:${llama.address().port}`; } };
  const gsv = path.join(tmp, "gsv"); fs.mkdirSync(path.join(gsv, "runtime"), { recursive: true }); fs.writeFileSync(path.join(gsv, "api_v2.py"), ""); fs.writeFileSync(path.join(gsv, "runtime", "python.exe"), "");
  let hasGsv = false, sysOn = false, sysSaid = 0;
  const MEDIA = require("../../pptassist/core/media");
  // 假的「电脑自带朗读」：开关控制这台电脑有没有中文朗读声音
  const sysTtsFactory = () => ({ available: async () => (sysOn ? { ok: true, name: "慧慧" } : { ok: false, why: "这台电脑没有中文朗读声音" }),
    tts: async (t) => { sysSaid++; return MEDIA.writeWav(new Float32Array(22050).map((_, i) => Math.sin(i / 8) * 0.3), 22050); } });
  const ev = [];
  const extracted = [];
  // 假的 ffmpeg：把最后一个参数写成一段 1 秒的静音 wav
  const ffDir = path.join(tmp, "ff"); fs.mkdirSync(ffDir, { recursive: true });
  fs.writeFileSync(path.join(ffDir, "ff.js"), `const MEDIA = require(${JSON.stringify(path.join(__dirname, "..", "..", "pptassist", "core", "media.js"))}); require("fs").writeFileSync(process.argv[process.argv.length - 1], MEDIA.writeWav(new Float32Array(16000), 16000));`);

  const show = Show.create({ dir: () => path.join(tmp, "work", "show"), server: () => base, llm, send: (e) => ev.push(e),
    cloudOpt: { base: `http://127.0.0.1:${llama.address().port}`, env: {} },   // 「云端大脑」也指到上面那个假模型（OpenAI 兼容，一样认）
    ffmpeg: [process.execPath, path.join(ffDir, "ff.js")],   // 用 node 跑假的 ffmpeg（Windows 上不能直接跑 sh 脚本）
    extract: async (file, dir) => { extracted.push(file); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "layer0-qa-lora-v2.gguf"), "GGUF"); }, busy: () => task, used: () => used, gsvDir: () => (hasGsv ? gsv : null), sysTtsFactory,
    voiceOpt: { cmd: process.execPath, args: (p) => [path.join(__dirname, "..", "..", "pptassist", "test", "fake-gsv.js"), String(p)], waitMs: 15000 },
    hearOpt: { python: process.env.PYTHON || "python3", args: (p) => ["-u", require("../app/hear").SCRIPT, "--port", String(p), "--fake"], waitMs: 20000 } });

  // 1. 还什么都没发布
  let st = await show.state();
  assert.equal(st.product.build, 0); assert.ok(st.product.parts.every((p) => !p.ready)); assert.equal(st.who.role, "student"); assert.equal(st.campus.student, 360);
  assert.match(st.voice.label, /还没训练好/);
  assert.ok(st.product.parts.every((p) => p.temp), "每一样都写着临时用什么");
  assert.equal(st.voice.can, false); assert.match((await show.speak("你好")).skip, /还没训练好.*没有中文朗读/);
  ok("还没有发布过模型：成品第 0 版，每样都写着「临时用什么」；这台电脑也没有中文朗读 → 说清楚，回答只出字；模拟教务已经能用");
  sysOn = true;
  st = await show.state();
  assert.equal(st.voice.can, true); assert.equal(st.voice.temp, true); assert.match(st.voice.label, /临时用电脑自带的朗读/);
  let tsp = await show.speak("**你好**，同学们。");
  assert.ok(tsp.temp && Buffer.from(tsp.wav, "base64").slice(0, 4).toString() === "RIFF" && tsp.ms > 900 && tsp.levels.length > 5, JSON.stringify(tsp).slice(0, 200));
  await show.speak("**你好**，同学们。"); assert.equal(sysSaid, 1, "同一句念过就用存下的");
  ok("捞捞的声音还没训练好：先用电脑自带的中文朗读念出来（带口型），念过的句子不重念");

  // 2. 调度中心发布了答题 LoRA 和捞捞的声音 → 自动下载、换上、记两笔
  publish("qa-lora", 1, { lora: ["qa-lora.gguf", "GGUF-v1"] }, { acc: 0.7, base_acc: 0.64 });
  publish("laolao-voice", 1, { gpt: ["g.ckpt", "gpt1"], sovits: ["s.pth", "sov1"], ref: ["ref.wav", "RIFF"], reftext: ["ref.txt", "大家好，我是捞捞。"] });
  let P = await show.fuse("测试");
  assert.equal(P.build, 2);
  const pe = ev.filter((e) => e.type === "product").pop();
  assert.deepEqual(pe.fresh.map((f) => [f.key, f.to]).sort(), [["laolao-voice", 1], ["qa-lora", 1]]);
  assert.equal(pe.fresh.find((f) => f.key === "qa-lora").metric, 0.7);
  ev.length = 0; assert.equal((await show.fuse("再看一次")).build, 2); assert.equal(ev.filter((e) => e.type === "product").length, 0);
  ok("发布了新模型：自动下载、核对、换上，告诉界面（哪一样、第几版、成绩）→ 成品第 2 版；没有新的就不打扰");

  // 3. 讲题：带着刚换上的答题 LoRA 启动大模型
  ev.length = 0; st = await show.send("解方程 2x+3=11");
  assert.match(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), /答案：4/);
  assert.equal(ensured.length, 1); assert.equal(ensured[0].name, Show.LLM_SPEC.name); assert.ok(/qa-lora[\\/]1[\\/]lora\.gguf$/.test(ensured[0].lora), ensured[0].lora);
  assert.match(reqs[0].messages[0].content, /捞小智/); assert.ok(reqs[0].tools.length >= 16);
  ok("讲题：用和训练时同一个底子，带上最新的答题 LoRA（第 1 版）");

  // 4. 训练出了第 2 版 → 不用人管，下一句就用它；第 3 版带上起不来 → 自动退回第 2 版，照样回答
  publish("qa-lora", 2, { lora: ["qa-lora.gguf", "GGUF-v2"] }, { acc: 0.74, base_acc: 0.64 });
  ev.length = 0; P = await show.fuse("定时");
  assert.equal(P.build, 3); assert.deepEqual([ev.find((e) => e.type === "product").fresh[0].from, ev.find((e) => e.type === "product").fresh[0].to], [1, 2]);
  await show.send("再来一道"); assert.ok(/qa-lora[\\/]2[\\/]/.test(ensured[ensured.length - 1].lora));
  publish("qa-lora", 3, { lora: ["qa-lora.gguf", "GGUF-v3-broken"] }, { acc: 0.75 });
  await show.fuse("定时"); badLora = path.join("qa-lora", "3");
  ev.length = 0; await show.send("还有一道");
  assert.ok(/qa-lora[\\/]2[\\/]/.test(ensured[ensured.length - 1].lora), "退回第 2 版：" + ensured[ensured.length - 1].lora);
  assert.match(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), /答案/);
  await show.fuse("定时"); await show.send("第四道");
  assert.ok(/qa-lora[\\/]2[\\/]/.test(ensured[ensured.length - 1].lora), "坏的那一版不再换回来");
  assert.equal((await show.state()).product.parts.find((p) => p.key === "qa-lora").version, 2);
  ok("又训练出新版：自动融合，下一句就带着新的 LoRA；新版带上启动不了 → 自动退回上一版，对话不断，坏的那一版不再反复换上");
  // 「先核对再回答」考过了及格线：一起挂上、平时关着；查资料回答、核对的那几次请求才打开它、关掉答题 LoRA
  publish("ground-lora", 1, { lora: ["ground-lora.gguf", "GGUF-g1"] }, { acc: 0.8, abstain: 0.9, catch: 0.9, clean: 0.9, base_catch: 0.5 });
  await show.fuse("定时");
  fs.mkdirSync(path.join(tmp, "work", "show", "kb"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "work", "show", "kb", "通知.txt"), "2026 年秋季校运会定于 11 月 28 日在东区田径场举行。");
  reqs.length = 0; await show.send("校运会是哪天");
  const le = ensured[ensured.length - 1];
  assert.ok(/qa-lora[\\/]2[\\/]/.test(le.lora) && le.extraLoras && /ground-lora[\\/]1[\\/]lora\.gguf$/.test(le.extraLoras[0]), JSON.stringify(le));
  const G = require("../app/ppt/ground.js");
  const gq = reqs.filter((b) => b.messages && b.messages[0] && (b.messages[0].content === G.ANSWER_SYS || b.messages[0].content === G.CHECK_SYS));
  assert.ok(gq.length >= 1 && gq.every((b) => JSON.stringify(b.lora) === JSON.stringify([{ id: 0, scale: 0 }, { id: 1, scale: 1 }])), JSON.stringify(gq.map((b) => b.lora)));
  assert.ok(reqs.filter((b) => !gq.includes(b)).every((b) => !b.lora), "平时说话不带 lora 字段（答题 LoRA 照常起作用）");
  assert.equal((await show.state()).product.parts.find((p) => p.key === "ground-lora").version, 1);
  ok("先核对再回答 LoRA 发布了：和答题 LoRA 一起挂上；查资料回答、核对时才打开它，平时说话不受影响");

  // 5. 说话：没装声音组件时说清楚；装了以后一句话 → 一段声音 + 每一帧的响度（口型）
  assert.ok((await show.speak("你好，同学们。")).temp, "捞捞的声音下好了但没装声音组件：先用电脑自带朗读");
  assert.match((await show.state()).voice.label, /第 1 版已下好/);
  sysOn = false;
  assert.match((await show.speak("你好呀。")).skip, /还没装声音组件/);
  hasGsv = true;
  const sp = await show.speak("**先设**未知数 $x$。");
  assert.ok(sp.wav.length > 1000 && Buffer.from(sp.wav, "base64").slice(0, 4).toString() === "RIFF" && sp.ms > 0 && sp.levels.length > 5 && sp.version === 1);
  assert.equal(sp.text, "先设未知数 （公式）。");
  assert.equal((await show.state()).voice.gsv, true); assert.match((await show.state()).voice.label, /捞捞的声音（第 1 版）/);
  assert.equal(show.setSpeak(false).on, false); assert.equal(await show.speak("你好"), null); show.setSpeak(true);
  ok("开口说话：用最新发布的捞捞声音，一句一段，带口型响度；去掉公式和 markdown；能关");

  // 6. 这台电脑正在算任务：不抢显卡
  task = "训练答题大脑";
  await assert.rejects(() => show.send("你好"), /正在算「训练答题大脑」.*暂停计算/);
  assert.equal((await show.state()).task, "训练答题大脑");
  task = null;
  ok("这台电脑正在算任务：不抢显卡，提示先暂停计算");

  // 6b. 大脑换成云端（DeepSeek）：在算任务也能问（不占显卡）、不启动本机模型；准备组件里不用再下本地大模型；换回本机照旧
  st = await show.state(); assert.equal(st.cloud.on, false); assert.equal(st.prep.items.find((x) => x.key === "llm").name, "本地大模型");
  assert.throws(() => show.cloudSet({ brain: "cloud" }), /先填 DeepSeek 的 API Key/);
  show.cloudSet({ brain: "cloud", key: "sk-test1234567890" });
  st = await show.state(); assert.equal(st.cloud.on, true); assert.equal(st.cloud.keyTail, "7890"); assert.ok(!JSON.stringify(st).includes("sk-test"), "界面拿不到完整的 Key");
  const li = st.prep.items.find((x) => x.key === "llm"); assert.equal(li.state, "ready"); assert.match(li.name, /DeepSeek（云端）/);
  task = "训练答题大脑"; const nq = reqs.length, ne = ensured.length;
  await show.send("鸡兔同笼，头 35 个、脚 94 只");
  const cq = reqs[reqs.length - 1];
  assert.ok(reqs.length > nq); assert.equal(cq.model, "deepseek-flash"); assert.deepEqual(cq.thinking, { type: "enabled" }); assert.equal(cq.temperature, undefined);
  assert.equal(ensured.length, ne, "云端开着：不启动本机模型、不占显卡");
  assert.equal((await show.cloudTest()).ok, true);
  task = null; show.cloudSet({ brain: "local" }); assert.equal((await show.state()).cloud.on, false);
  ok("大脑换成云端（DeepSeek）：这台电脑在算任务也能问、不启动本机模型；准备组件不用下本地大模型；换回本机照旧");

  // 6a. 打电话：说的话照语音通话的规矩来（系统提示里加上），大模型换带「口语对话」LoRA（发布了才有，没有就还用答题 LoRA）；
  //     录到的一句话送到本机听写变成文字；挂了电话换回答题 LoRA
  let cs = show.setCall(true); assert.equal(cs.on, true); assert.equal(cs.lora, null); assert.equal(cs.ear, true);
  await show.send("鸡兔同笼怎么算");
  let sys = reqs[reqs.length - 1].messages[0].content;
  assert.match(sys, /现在是语音通话/); assert.match(sys, /不要写 LaTeX/);
  assert.ok(/qa-lora[\\/]2[\\/]/.test(ensured[ensured.length - 1].lora), "口语对话还没训练好：先用答题 LoRA");
  publish("chat-lora", 1, { lora: ["chat-lora.gguf", "GGUF-chat1"] }, { acc: 0.8, base_acc: 0.55, speak: 0.97, base_speak: 0.6 });
  ev.length = 0; P = await show.fuse("定时");
  const cf = ev.find((e) => e.type === "product").fresh.find((f) => f.key === "chat-lora"); assert.ok(cf && cf.to === 1 && cf.name === "口语对话" && cf.metric === 0.8);
  assert.equal((await show.state()).call.lora, 1);
  await show.send("那兔子有几只");
  assert.ok(/chat-lora[\\/]1[\\/]lora\.gguf$/.test(ensured[ensured.length - 1].lora), "打电话带口语对话 LoRA：" + ensured[ensured.length - 1].lora);
  const wav = Buffer.alloc(44 + 3200); wav.write("RIFF", 0); wav.write("WAVE", 8);
  const t0 = Date.now(); const heard = await show.hear(wav.toString("base64"));
  assert.match(heard.text, /假的识别：3244 字节/);
  const t1 = Date.now(); await show.hear(wav.toString("base64")); assert.ok(Date.now() - t1 < 2000, "第二句不用重新加载听写");
  await assert.rejects(() => show.hear(Buffer.from("not a wav").toString("base64")), /格式不对/);
  cs = show.setCall(false); assert.equal(cs.on, false);
  await show.send("再讲一道");
  sys = reqs[reqs.length - 1].messages[0].content; assert.ok(!/现在是语音通话/.test(sys));
  assert.ok(/qa-lora[\\/]2[\\/]/.test(ensured[ensured.length - 1].lora), "挂了电话换回答题 LoRA");
  ok(`打电话：按语音通话的规矩说话，带「口语对话」LoRA（没训练好先用答题 LoRA，发布了自动换上）；录到的话本机听写成文字（第一句 ${((t1 - t0) / 1000).toFixed(1)} 秒含启动）；挂了换回来`);

  // 6b. 做 PPT、接着改：界面要的每一页预览（SVG）跟着变；界面上直接点换配色 / 撤销；打开老师自己的 PPT
  assert.equal((await show.slides()).none, true); assert.equal((await show.state()).ppt, null);
  ev.length = 0; st = await show.send("做一份讲数组的 PPT");
  const mk = ev.find((e) => e.type === "tool" && e.stage === "done"); assert.ok(mk.ok && mk.name === "make_ppt" && mk.result.pages === 4, JSON.stringify(mk.result));
  assert.equal(st.ppt.pages, 4); assert.equal(st.ppt.title, "数组"); assert.ok(fs.existsSync(show.lastPpt().file));
  let sl = await show.slides(); assert.equal(sl.svgs.length, 4); assert.equal(sl.theme, "green"); assert.equal(sl.rev, st.ppt.rev); assert.equal(await show.slides(sl.rev), null); assert.match(sl.svgs[2], /int a\[5\];/);
  ev.length = 0; st = await show.send("第 2 页改成两栏");
  const ed = ev.find((e) => e.type === "tool" && e.stage === "done"); assert.ok(ed.ok && ed.changed && ed.name === "edit_slide" && ed.result.no === 2, JSON.stringify(ed.result));
  assert.ok(reqs[reqs.length - 1].tools.some((x) => x.function.name === "set_theme") && !reqs[reqs.length - 1].tools.some((x) => x.function.name === "apply_leave"));
  const sl2 = await show.slides(sl.rev); assert.ok(sl2.rev > sl.rev && /一次存一组数/.test(sl2.svgs[1]) && /VS/.test(sl2.svgs[1]));
  await show.pptTheme("board"); assert.equal((await show.slides()).theme, "board");
  assert.match((await show.pptUndo()).undone, /黑板/); assert.equal((await show.slides()).theme, "green");
  await assert.rejects(() => show.openPpt(path.join(tmp, "x.ppt")), /只能打开 \.pptx/);
  st = await show.openPpt(path.join(__dirname, "..", "..", "pptassist", "test", "fixtures", "sample.pptx")); assert.equal(st.ppt.title, "sample");
  assert.equal((await show.slides()).designed, false);
  ok("做 PPT、接着改：做完说「第 2 页改成两栏」就改，每一页的预览跟着变；界面上直接换配色、撤销；老师自己的 .pptx 也能打开来改");

  // 底座永久层发布了（答题 LoRA 第 2 版 ×0.7 合进底座）：挂上永久层，第 2 版答题 LoRA 不再单独挂（不然算两遍）；训练用的 train 包不下
  publish("base-stack", 1, { stack: ["stack.json", JSON.stringify({ layers: [{ name: "qa-lora", version: 2, scale: 0.7, gguf: "layer0-qa-lora-v2.gguf" }] })], bundle: ["bundle.zip", "PK-bundle"], train: ["train.zip", "PK-train-only"] }, { gsm8k: 0.8, base_gsm8k: 0.7 });
  await show.fuse("定时");
  reqs.length = 0; await show.send("再来一道题");
  const lb = ensured[ensured.length - 1];
  assert.ok(lb.baseLoras && lb.baseLoras.length === 1 && lb.baseLoras[0].scale === 0.7 && /layer0-qa-lora-v2\.gguf$/.test(lb.baseLoras[0].path) && !lb.lora, JSON.stringify(lb));
  assert.ok(/ground-lora/.test((lb.extraLoras || [])[0] || ""), "先核对再回答 LoRA 照样挂着");
  assert.equal(extracted.length, 1);
  assert.ok(!fs.readdirSync(path.join(tmp, "work", "show"), { recursive: true }).some((f) => /train/.test(String(f))), "训练用的包不下");
  reqs.length = 0; await show.send("校运会是哪天");
  const gq2 = reqs.filter((b) => b.messages && b.messages[0] && b.messages[0].content === require("../app/ppt/ground.js").ANSWER_SYS);
  assert.ok(gq2.length && gq2.every((b) => JSON.stringify(b.lora) === JSON.stringify([{ id: 0, scale: 0.7 }, { id: 1, scale: 1 }])), "查资料时底座永久层照原比例写上：" + JSON.stringify(gq2.map((b) => b.lora)));
  ok("底座永久层发布了：挂上（×0.7），已经合进去的答题 LoRA 不再单独挂；查资料时永久层照原比例；训练用的包不下");

  // 声音自动考试、知识库里的视频听写、联网考试
  {
    const was = hasGsv; hasGsv = true;
    const ve = await show.voiceExam();
    assert.equal(ve.total, 8); assert.equal(ve.failed, 0); assert.ok(ve.cer >= 0 && fs.existsSync(path.join(tmp, "work", "show", "voice-exam.json")));
    const kbd = path.join(tmp, "work", "show", "kb");
    fs.writeFileSync(path.join(kbd, "第五讲.mp4"), "fake");
    const k0 = await show.kb();
    assert.deepEqual(k0.status.media, ["第五讲.mp4"], "视频不点整理不听写");
    const ki = await show.kbImport();
    assert.equal(ki.done, 1, JSON.stringify(ki)); assert.deepEqual(ki.status.media, []);
    hasGsv = was;
    ok("声音自动考试（合成 → 听写回来比）；知识库里的视频点「整理」才听写，抽声音用声音组件的 ffmpeg");
  }

  // 7. 换身份、审批、重开还在
  st = await show.setRole("teacher"); assert.equal(st.who.me.role, "教师");
  show.shutdown();
  const show2 = Show.create({ dir: () => path.join(tmp, "work", "show"), server: () => base, llm, send() {}, busy: () => null, used: () => false });
  assert.equal((await show2.state()).product.build, 8);
  show2.shutdown();
  ok("换身份；重开客户端，成品版本和记录都还在");

  srv.close(); llama.close();
  console.log("成品展示：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// 数字怎么念、听写常见的听错（不用起服务，单独核对）
{
  const S = require("../app/show");
  const a = require("assert");
  a.equal(S.speakNums("学号202501010101。"), "学号二零二五零一零一零一零一。");
  a.equal(S.speakNums("下周五是2026-11-27"), "下周五是二零二六年十一月二十七日");
  a.equal(S.speakNums("头35个、脚94只，2个答案"), "头三十五个、脚九十四只，两个答案");
  a.equal(S.speakNums("8:30 在301教室，正确率85.5%"), "八点三十分 在三零一教室，正确率百分之八十五点五");
  a.equal(S.speakNums("第11周"), "第十一周");
  a.equal(S.fixAsr("Pardon语言有什么用？C元呢？硬件城。"), "Python语言有什么用？C语言呢？硬件层。");
  a.equal(S.fixAsr("公元前"), "公元前", "不是 C 开头的不动");
  console.log("✓ 数字：长编号、学号、年份、教室一位一位念，个数按数值念，日期时间百分数念对；听写常见的听错（Python、C语言、硬件层）改回来");
}
