// 好听的临时声音（app/kokoro.js + tts-worker.js）：模型先从国内存储下（带进度）、解压；合成在单独的小进程里，模型只加载一次；
//   中文走 JSON 传过去（不经过命令行）；默认中文女声 zf_xiaoxiao（47 号）；小进程挂了下一句自己重起
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const Kokoro = require("../app/kokoro");
const ok = (m) => console.log("✓", m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-kokoro-"));
  // 假的 sherpa-onnx-node：记下加载了几次、收到的字和说话人；合成出「字数 × 100 + 说话人」个采样点
  const fake = path.join(tmp, "fake-sherpa.js"), logf = path.join(tmp, "log.txt");
  fs.writeFileSync(fake, `
const fs = require("fs");
class GenerationConfig { constructor(o) { Object.assign(this, o); } }
class OfflineTts { constructor(c) { fs.appendFileSync(${JSON.stringify(logf)}, "load " + c.model.kokoro.model.split(/[\\\\/]/).pop() + "\\n"); this.sampleRate = 24000; }
  generate({ text, generationConfig }) { if (text === "崩") process.exit(3); fs.appendFileSync(${JSON.stringify(logf)}, "say " + text + " " + generationConfig.sid + "\\n"); return { samples: new Float32Array([...text].length * 100 + generationConfig.sid), sampleRate: 24000 }; } }
function writeWave(f, { samples, sampleRate }) { const n = samples.length, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); fs.writeFileSync(f, b); }
module.exports = { OfflineTts, GenerationConfig, writeWave };`);
  const base = path.join(tmp, "data");
  let dls = 0;
  const mirror = { model: async (k) => (k === "kokoroZh" ? [{ size: 3000, url: "https://cos.example/ai/tts/kokoro.tar" }] : []), sources: (x) => [x.url] };
  const dl = { download: async (urls, dest, { onProg }) => { dls++; assert.deepEqual(urls, ["https://cos.example/ai/tts/kokoro.tar"]); for (const got of [1000, 3000]) { onProg({ got, total: 3000 }); await new Promise((r) => setTimeout(r, 1100)); } fs.writeFileSync(dest, "tar"); } };
  const extract = async (f, to) => { const d = path.join(to, Kokoro.DIRNAME); fs.mkdirSync(path.join(d, "espeak-ng-data"), { recursive: true }); for (const n of ["model.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt", "lexicon-us-en.txt"]) fs.writeFileSync(path.join(d, n), "x"); };
  const k = Kokoro.create({ base: () => base, mirror, dl, extract, node: process.execPath, env: { LG_SHERPA: fake } });
  assert.equal(k.ready(), false);
  const says = [];
  await k.ensure((m, x) => says.push({ m, ...(x || {}) }));
  assert.equal(k.ready(), true); assert.equal(dls, 1);
  assert.ok(says.some((x) => /好听的声音.*%/.test(x.m)) && says.some((x) => x.done), JSON.stringify(says));
  await k.ensure(); assert.equal(dls, 1, "下好的不再下");
  ok("模型从捞捞的国内存储下（带进度）、解压；下好不再下");

  const w1 = await k.tts("你好，同学们。");
  const M = require("../../pptassist/core/media");
  const r1 = M.readWav(w1);
  assert.equal(r1.rate, 24000); assert.equal(r1.samples.length, 7 * 100 + 47);
  const w2 = await k.tts("第二句");
  assert.equal(M.readWav(w2).samples.length, 3 * 100 + 47);
  let log = fs.readFileSync(logf, "utf8");
  assert.equal(log.match(/^load /gm).length, 1, "模型只加载一次");
  assert.match(log, /say 你好，同学们。 47/, "中文原样传到（不经过命令行）");
  ok("一句一句合成：中文原样传过去、默认 zf_xiaoxiao（47 号）、24000Hz；模型只加载一次");

  await assert.rejects(() => k.tts("崩"), /退出了/);
  const w3 = await k.tts("又好了");
  assert.equal(M.readWav(w3).samples.length, 3 * 100 + 47);
  assert.equal(fs.readFileSync(logf, "utf8").match(/^load /gm).length, 2);
  ok("合成程序挂了：这一句报错，下一句自己重起");
  k.stop();
  console.log("好听的声音：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
