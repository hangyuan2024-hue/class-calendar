// 声音和口型：wav 读写、响的地方张嘴安静的地方闭嘴、任意声音转 wav 能截短
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const M = require("../core/media");
const ok = (m) => console.log("✓ " + m);
(async () => {
  const sr = 16000, s = new Float32Array(sr * 2);
  for (let i = 0; i < sr; i++) s[i] = 0.5 * Math.sin(i / 5);   // 前 1 秒在说话，后 1 秒没声音
  const w = M.readWav(M.writeWav(s, sr));
  assert.equal(w.rate, sr); assert.equal(w.samples.length, sr * 2); assert.ok(Math.abs(w.samples[100] - s[100]) < 1e-3);
  ok("wav：写出去再读回来一样");
  const lv = M.lipLevels(w.samples, sr, 25);
  assert.equal(lv.length, 50);
  assert.ok(lv.slice(2, 23).every((v) => v > 0.8), "说话时张嘴"); assert.ok(lv.slice(27).every((v) => v === 0), "安静时闭嘴");
  assert.ok(M.lipLevels(new Float32Array(sr), sr).every((v) => v === 0), "全是静音也不出错");
  ok("口型：说话时张开、安静时闭上、全静音不出错");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
  const long = new Float32Array(sr * 14).map((_, i) => 0.3 * Math.sin(i / 7));
  fs.writeFileSync(path.join(dir, "in.wav"), M.writeWav(long, sr));
  await M.run(["-i", path.join(dir, "in.wav"), "-c:a", "libmp3lame", path.join(dir, "in.mp3")]).catch(() => M.run(["-i", path.join(dir, "in.wav"), path.join(dir, "in.mp3")]));
  const r = await M.toWav(path.join(dir, "in.mp3"), path.join(dir, "ref.wav"), { rate: 32000, maxSec: 10 });
  assert.equal(r.rate, 32000); assert.ok(r.seconds > 9.8 && r.seconds <= 10.05, "截到 10 秒：" + r.seconds);
  ok("mp3 → wav（32k 单声道），参考录音只要前 10 秒");
  assert.throws(() => M.readWav(Buffer.from("hello world, not a wav file at all.......")), /不是 wav/);
  ok("不是 wav 的文件会说清楚");
  console.log("声音和视频：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
