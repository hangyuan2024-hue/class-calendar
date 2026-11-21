// 声音自动考试（core/voiceexam.js）：合成 → 听写回来 → 错字率、数字念对没有
"use strict";
const assert = require("assert");
const V = require("../core/voiceexam");
const ok = (m) => console.log("✓", m);
(async () => {
  assert.ok(V.numbersIn("在三零二教室").has("302") && V.numbersIn("三百零二").has("302") && V.numbersIn("302 教室").has("302"));
  // 念得好的声音：听写回来和原文一样（数字可能变成中文）
  const good = await V.run({ synth: async (t) => Buffer.from(t), hear: async (w) => w.toString().replace("302", "三零二").replace("2027", "二零二七") });
  assert.equal(good.cer, 0); assert.equal(good.numOk, 1); assert.equal(good.failed, 0);
  // 多音字念错（行长 → 形长）、数字念错（302 → 三二）
  const bad = await V.run({ synth: async (t) => Buffer.from(t), hear: async (w) => w.toString().replace("行长", "形长").replace("302", "三二") });
  assert.ok(bad.cer > 0 && bad.numOk < 1);
  assert.equal(bad.items.find((x) => /行长/.test(x.text)).cer > 0, true);
  const broken = await V.run({ synth: async () => { throw new Error("声音组件没装"); }, hear: async () => "" });
  assert.equal(broken.failed, V.SENTENCES.length); assert.equal(broken.cer, 1);
  ok("声音自动考试：听写回来比错字率（多音字念错查得出）、数字念对没有（302 / 三零二 / 三百零二都算）；合成不了的单独记");
  console.log("声音自动考试：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
