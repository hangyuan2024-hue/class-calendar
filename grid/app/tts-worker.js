// 捞小智 · Kokoro 语音合成的小进程（用 Electron 自带的 Node 跑：ELECTRON_RUN_AS_NODE=1）
//   模型只加载一次；一行一个 JSON：{ id, init: {...路径} } 或 { id, text, sid, speed, out } → 一行回复 { id, ok } / { id, error }
//   中文走 JSON（UTF-8），不经过命令行参数（Windows 上命令行里的中文会变成乱码）
"use strict";
const fs = require("fs");
const path = require("path");
let S = null, tts = null;
const reply = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) handle(line); }
});
process.stdin.on("end", () => process.exit(0));
function handle(line) {
  let m; try { m = JSON.parse(line); } catch (e) { return; }
  try {
    if (m.init) {
      S = S || require(process.env.LG_SHERPA || "sherpa-onnx-node");
      const d = m.init.dir, f = (n) => path.join(d, n);
      const fsts = ["date-zh.fst", "phone-zh.fst", "number-zh.fst"].map(f).filter((x) => fs.existsSync(x)).join(",");
      tts = new S.OfflineTts({
        model: { kokoro: { model: f("model.onnx"), voices: f("voices.bin"), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data"), lexicon: [f("lexicon-us-en.txt"), f("lexicon-zh.txt")].filter((x) => fs.existsSync(x)).join(","), ...(fs.existsSync(f("dict")) ? { dictDir: f("dict") } : {}) },
          debug: false, numThreads: m.init.threads || 2, provider: "cpu" },
        maxNumSentences: 1, ...(fsts ? { ruleFsts: fsts } : {}),
      });
      return reply({ id: m.id, ok: true, rate: tts.sampleRate });
    }
    if (!tts) throw new Error("还没加载模型");
    // 2.x：tts.generate({ text, generationConfig: new GenerationConfig({ sid, speed }) })；老版本：generate({ text, sid, speed })
    const text = String(m.text || ""), sid = m.sid | 0, speed = +m.speed || 1.0;
    // enableExternalBuffer: false —— Electron 不许原生模块把内存直接交给 JS（报「External buffers are not allowed」），让它复制一份
    const a = S.GenerationConfig ? tts.generate({ text, generationConfig: new S.GenerationConfig({ sid, speed, silenceScale: 0.2 }), enableExternalBuffer: false }) : tts.generate({ text, sid, speed, enableExternalBuffer: false });
    S.writeWave(m.out, { samples: a.samples, sampleRate: a.sampleRate });
    reply({ id: m.id, ok: true });
  } catch (e) { reply({ id: m.id, error: String((e && e.message) || e) }); }
}
