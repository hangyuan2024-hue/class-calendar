// 测试用的假 GPT-SoVITS：/tts 按字数造一段「说话」的 wav（一个字一个音节，有响有停），不用显卡
"use strict";
const http = require("http");
const { writeWav } = require("../core/media");
const port = +process.argv[2];
http.createServer((q, r) => {
  let b = ""; q.on("data", (c) => (b += c));
  q.on("end", () => {
    if (q.url !== "/tts") { r.statusCode = 404; return r.end(); }
    let j; try { j = JSON.parse(b); } catch (e) { r.statusCode = 400; return r.end(JSON.stringify({ message: "bad json" })); }
    if (!j.text || !j.ref_audio_path) { r.statusCode = 400; return r.end(JSON.stringify({ message: "text 和 ref_audio_path 必须有" })); }
    const sr = 32000, chars = [...String(j.text)], per = 0.2, s = new Float32Array(Math.ceil(sr * (chars.length * per + 0.3)));
    chars.forEach((ch, k) => { const quiet = /[，。！？、,.!?\s]/.test(ch); for (let i = 0; i < sr * per; i++) { const t = i / sr, env = quiet ? 0 : Math.sin(Math.PI * t / per) ** 2; s[Math.floor(k * per * sr) + i] = env * 0.5 * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(k)) * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 7 * t)); } });
    r.setHeader("Content-Type", "audio/wav"); r.end(writeWav(s, sr));
  });
}).listen(port, "127.0.0.1", () => console.log("fake gsv on", port));
