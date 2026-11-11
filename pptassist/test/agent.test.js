// AI 助手：流式回复、工具调用（标准的和写在正文里的）、一步步汇报、照片认公式、停下、没开 PPT 时的说法
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const LLM = require("../core/llm");
const AG = require("../core/agent");
const ED = require("../core/pptedit");
const FAKE = require("./fake-llama");
const ok = (m) => console.log("✓ " + m);

(async () => {
  const port = 18000 + Math.floor(Math.random() * 900);
  const fake = await FAKE.start(port);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-"));
  const llm = LLM.create({ dir, exe: process.execPath, port, minBytes: 4 });
  await assert.rejects(llm.start(), /下载 AI 助手的模型/);
  fs.writeFileSync(path.join(dir, "Qwen3VL-4B-Instruct-Q4_K_M.gguf"), "GGUF....");
  fs.writeFileSync(path.join(dir, "mmproj-Qwen3VL-4B-Instruct-F16.gguf"), "GGUF....");
  assert.equal(llm.ready(), true);
  await llm.start(); assert.equal(llm.state().status, "ready");
  ok("模型：没下载时说清楚；下好了就能启动（已经在跑的直接用）");

  let deck = null;
  const ev = [];
  const ag = AG.create({ llm, deck: () => deck, onEvent: (e) => ev.push(e), fileName: () => "sample.pptx" });
  await ag.send("你好");
  assert.equal(ev.filter((e) => e.type === "delta").map((e) => e.text).join(""), "你好，我是捞捞。");
  assert.ok(ev.length > 3 && ev[ev.length - 1].type === "done");
  assert.match(fake.st.reqs[0].messages[0].content, /还没有打开 PPT/); assert.equal(fake.st.reqs[0].tools.length, AG.TOOLS.length);
  ok("对话：回复一小段一小段地流出来；系统提示里告诉模型有没有打开 PPT、带上全部工具");

  ev.length = 0;
  await ag.send("帮我加一页");
  const t1 = ev.filter((e) => e.type === "tool");
  assert.equal(t1[0].stage, "start"); assert.equal(t1[1].ok, false); assert.match(t1[1].result.error, /还没打开 PPT/);
  ok("没打开 PPT 时：工具报错，模型照实告诉老师");

  deck = await ED.load(fs.readFileSync(path.join(__dirname, "fixtures", "sample.pptx")));
  const n0 = (await deck.outline()).length;
  ev.length = 0;
  await ag.send("在第二页后面加一页小结");
  const tools = ev.filter((e) => e.type === "tool");
  assert.equal(tools[0].say, "在第 2 页后面加一页「小结」"); assert.equal(tools[1].ok, true); assert.equal(tools[1].changed, true);
  assert.equal((await deck.outline()).length, n0 + 1); assert.equal((await deck.outline())[2].title, "小结");
  const text = ev.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.ok(text.includes("好的，我来加一页") && text.includes("加好了一页"));
  assert.equal(ev[ev.length - 1].changed, 1);
  ok("改 PPT：模型调用工具 → 真的加了一页 → 一步步汇报（开始、做完）→ 最后一句话总结");

  ev.length = 0;
  await ag.send("把这个公式插到第二页");
  const f = ev.filter((e) => e.type === "tool" && e.stage === "done")[0];
  assert.equal(f.name, "insert_formula"); assert.equal(f.ok, true); assert.equal((await deck.outline())[1].formulas, 1);
  ok("模型把工具调用写在正文里（<tool_call>…）也能认出来并执行");

  ev.length = 0;
  await ag.send("把第二页标题改一下");
  const names = ev.filter((e) => e.type === "tool" && e.stage === "done").map((e) => e.name);
  assert.deepStrictEqual(names, ["get_outline", "set_text"]);
  assert.equal((await deck.slide(2)).shapes[0].text[0], "冒泡排序（新）");
  ok("连着做好几步：先看大纲，再改标题");

  const o = await ag.ocr("data:image/jpeg;base64,AAAA");
  assert.equal(o.latex, "\\frac{a+b}{2}\\ge\\sqrt{ab}"); assert.equal(o.text, "(a+b)/2≥√(ab)");
  const lastReq = fake.st.reqs[fake.st.reqs.length - 1];
  assert.equal(lastReq.messages[1].content[0].type, "image_url");
  ok("照片认公式：图片发给模型，去掉 $$ 只要 LaTeX，带一行文字版给老师核对");

  ev.length = 0;
  const p = ag.send("说慢一点");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ag.busy(), true);
  await assert.rejects(ag.send("再说"), /还没说完/);
  ag.stop();
  await p;
  assert.equal(ev[ev.length - 1].stopped, true); assert.equal(ag.busy(), false);
  ok("说到一半能停；一次只说一句");

  // 带图片的对话：只留最近一张图
  await ag.send("看看这张", ["data:image/png;base64,AAA"]);
  await ag.send("再看这张", ["data:image/png;base64,BBB"]);
  const req = fake.st.reqs[fake.st.reqs.length - 1];
  const imgs = req.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === "image_url") : []));
  assert.equal(imgs.length, 1); assert.ok(imgs[0].image_url.url.endsWith("BBB"));
  ok("对话里有好几张图时只把最近一张发给模型（省内存、快）");

  fake.close(); llm.stop();
  console.log("AI 助手：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
