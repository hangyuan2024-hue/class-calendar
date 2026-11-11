// GPT-SoVITS：选错文件夹会说清楚；启动后能用参考录音念文字；没启动不让念
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const V = require("../core/voice");
const ok = (m) => console.log("✓ " + m);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsv-"));
  assert.equal(V.inspect(dir).ok, false); assert.match(V.inspect(dir).error, /api_v2\.py/);
  fs.writeFileSync(path.join(dir, "api_v2.py"), ""); fs.mkdirSync(path.join(dir, "runtime"));
  fs.writeFileSync(path.join(dir, "runtime", "python.exe"), "");
  assert.equal(V.inspect(dir).python, path.join(dir, "runtime", "python.exe"));
  ok("认得出 GPT-SoVITS 整合包（有 api_v2.py，用自带的 runtime\\python.exe）");
  const states = [];
  const v = V.create({ onState: (s) => states.push(s.state) });
  await assert.rejects(v.tts({ text: "你好", refWav: "x.wav" }), /还没准备好/);
  await v.start(dir, { cmd: process.execPath, args: (p) => [path.join(__dirname, "fake-gsv.js"), String(p)], waitMs: 15000 });
  assert.equal(v.state.state, "ready");
  const wav = await v.tts({ text: "同学们好。", refWav: path.join(dir, "ref.wav"), promptText: "你好" });
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  await assert.rejects(v.tts({ text: "", refWav: "" }), /生成声音失败/);
  v.stop();
  assert.deepStrictEqual(states.slice(0, 2), ["starting", "ready"]);
  ok("启动、念出 wav、出错时把 GPT-SoVITS 的话带回来、停止");
  const bad = V.create();
  await assert.rejects(bad.start(dir, { cmd: process.execPath, args: () => ["-e", "console.log('boom'); process.exit(3)"], waitMs: 8000 }), /退出了（3）.*boom/);
  ok("GPT-SoVITS 起不来：报错里带着它最后说的话");
  console.log("老师的声音：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
