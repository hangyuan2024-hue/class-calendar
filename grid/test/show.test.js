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
  const show = Show.create({ dir: () => path.join(tmp, "work", "show"), server: () => base, llm, send: (e) => ev.push(e), busy: () => task, used: () => used, gsvDir: () => (hasGsv ? gsv : null), sysTtsFactory,
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

  // 7. 换身份、审批、重开还在
  st = await show.setRole("teacher"); assert.equal(st.who.me.role, "教师");
  show.shutdown();
  const show2 = Show.create({ dir: () => path.join(tmp, "work", "show"), server: () => base, llm, send() {}, busy: () => null, used: () => false });
  assert.equal((await show2.state()).product.build, 6);
  show2.shutdown();
  ok("换身份；重开客户端，成品版本和记录都还在");

  srv.close(); llama.close();
  console.log("成品展示：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
