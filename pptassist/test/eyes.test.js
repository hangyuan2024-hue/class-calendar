// 训练出来的「眼力」（core/eyes.js）：模型说的话里找 JSON、公仔特征换成形象数据（只认那几样粗的类别）、照片还原成能改的一页
"use strict";
const assert = require("assert");
const E = require("../core/eyes");
const EDIT = require("../core/pptedit");
const D = require("../core/deck");
const ok = (m) => console.log("✓", m);

(async () => {
  assert.deepStrictEqual(E.parseJson('好的：```json\n{"a":1,"b":"x}y"}\n``` 就这样'), { a: 1, b: "x}y" });
  assert.equal(E.parseJson("没有"), null); assert.equal(E.parseJson("{坏的"), null);
  assert.deepStrictEqual(E.parseJson('<think>{"no":1}</think>{"yes":2}'), { yes: 2 });
  ok("模型说的话里找出第一个完整的 JSON（前后有字、包在 ```json 里、字符串里有括号都行）");

  const p = E.dollToPerson({ hairStyle: "ponytail", bangs: "side", hair: "栗", glasses: true, top: "藏青", bottom: "skirt", faceShape: "oval", eyeStyle: "smile", earrings: false, name: "张三", eyeGap: 0.31, hairHex: "#123456" });
  assert.deepStrictEqual(p, { hairStyle: "ponytail", bangs: "side", faceShape: "oval", eyeStyle: "smile", bottom: "skirt", hair: "#8B4A2B", top: "#1F2F5A", glasses: true, earrings: false });
  assert.equal(E.dollToPerson({ hairStyle: "mohawk", hair: "#ff0000" }), null);
  ok("公仔特征 → 形象数据：只认那几样粗的类别和十几种颜色名，别的（名字、量出来的五官尺寸、任意颜色）一概不收");

  const fake = (out) => ({ calls: [], async start(o) { this.started = o; }, async chat(m, o) { this.calls.push({ m, o }); return { content: out }; } });
  const llm = fake('{"layout":"compare","title":"配方法和公式法","left":{"head":"配方法","lines":["适合二次项系数为 1"]},"right":{"head":"公式法","lines":["什么方程都能用"]},"junk":1}');
  const s = await E.slideFromImage(llm, "data:image/jpeg;base64,AAAA");
  assert.equal(llm.calls[0].o.mode, "eyes"); assert.equal(llm.started.eyes, true);
  assert.equal(llm.calls[0].m[0].content, E.SLIDE_SYS); assert.equal(llm.calls[0].m[1].content[0].image_url.url, "data:image/jpeg;base64,AAAA");
  assert.ok(!("junk" in s) && s.layout === "compare");
  const d = await EDIT.load(await D.blank({ theme: "blue" }));
  await d.addDesigned(0, s);
  assert.equal((await d.outline())[0].layout, "compare"); assert.equal((await d.outline())[0].title, "配方法和公式法");
  await assert.rejects(E.slideFromImage(fake("看不清"), "data:image/png;base64,AA"), /没认出这一页/);
  const dl = fake('{"hairStyle":"bun","bangs":"full","hair":"黑","glasses":false,"top":"白","bottom":"pants","faceShape":"round","eyeStyle":"open","earrings":false}');
  assert.equal((await E.dollFromImage(dl, "data:image/png;base64,AA")).hairStyle, "bun");
  assert.equal(dl.calls[0].m[0].content, E.DOLL_SYS);
  ok("照片 → 能改的一页（直接排成那个版式）；照片 → 公仔特征；问的时候带着「眼力」模式，认不出来照实说");
  console.log("眼力：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
