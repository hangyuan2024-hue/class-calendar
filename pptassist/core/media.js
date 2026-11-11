// 捞捞PPT助手 · 声音和视频：读 wav、算口型（每一帧嘴张多大）、用 ffmpeg 把一帧帧画面和声音合成 mp4
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ffmpeg：随安装包带（ffmpeg-static）；打包后在 app.asar.unpacked 里
function ffmpegPath() {
  let p = null; try { p = require("ffmpeg-static"); } catch (e) {}
  if (p) p = p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return p && fs.existsSync(p) ? p : "ffmpeg";
}

// ---------- wav ----------
function readWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("不是 wav 声音文件");
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4); let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data") { if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body; data = { off: body, size }; break; }   // 流式写出的 wav 长度可能是 0 / -1
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("wav 文件不完整");
  const { channels, rate, bits, format } = fmt;
  const bps = bits / 8, frames = Math.floor(data.size / (bps * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.off + (i * channels + c) * bps;
      s += format === 3 && bits === 32 ? buf.readFloatLE(p) : bits === 16 ? buf.readInt16LE(p) / 32768 : bits === 32 ? buf.readInt32LE(p) / 2147483648 : bits === 24 ? buf.readIntLE(p, 3) / 8388608 : (buf.readUInt8(p) - 128) / 128;
    }
    mono[i] = s / channels;
  }
  return { rate, channels, samples: mono, seconds: frames / rate };
}
function writeWav(samples, rate) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

// 口型：每一帧（1/fps 秒）的响度 → 0..1。安静的地方闭嘴，最响的那些地方张到最大
function lipLevels(samples, rate, fps = 25) {
  const hop = rate / fps, n = Math.ceil(samples.length / hop), rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = Math.floor(f * hop), b = Math.min(samples.length, Math.floor((f + 1) * hop));
    let s = 0; for (let i = a; i < b; i++) s += samples[i] * samples[i];
    rms[f] = b > a ? Math.sqrt(s / (b - a)) : 0;
  }
  const sorted = Array.from(rms).sort((x, y) => x - y);
  const hiV = sorted[Math.floor(sorted.length * 0.95)] || 0, floor = Math.max(0.008, (sorted[Math.floor(sorted.length * 0.2)] || 0) * 1.5);
  const out = new Array(n);
  for (let f = 0; f < n; f++) { const v = hiV > floor ? (rms[f] - floor) / (hiV - floor) : 0; out[f] = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100; }
  return out;
}

// ---------- ffmpeg ----------
function run(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => reject(new Error("ffmpeg 启动不了：" + e.message)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg 出错：" + (err.trim().split("\n").pop() || "退出码 " + code)))));
    if (input) { p.stdin.on("error", () => {}); p.stdin.end(input); }
  });
}
// 任意声音文件 → wav（单声道）。maxSec：只要前面这么多秒（参考音频 3～10 秒）
async function toWav(src, dest, { rate = 32000, maxSec = 0 } = {}) {
  await run(["-i", src, ...(maxSec ? ["-t", String(maxSec)] : []), "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", dest]);
  return readWav(fs.readFileSync(dest));
}

// ---------- AI 生成内容的标识（《人工智能生成合成内容标识办法》、GB 45438-2025）----------
// 显式标识：画面左上角一直显示「AI生成」（字高约为短边的 6%，标准要求 ≥5%、开头至少 2 秒）。label 是 720 宽视频用的图
const LABEL = path.join(__dirname, "assets", "ai-label.png");
// 隐式标识：文件元数据里一个叫 AIGC 的字段，值是标准附录 E 的 JSON（Label 1 = 是人工智能生成合成的内容）
function aigc(id, producer = "捞捞PPT助手") {
  return JSON.stringify({ AIGC: { Label: "1", ContentProducer: producer, ProduceID: String(id), ReservedCode1: "", ContentPropagator: producer, PropagateID: String(id), ReservedCode2: "" } });
}
const metaArgs = (meta) => (meta ? ["-metadata", "AIGC=" + meta, "-metadata", "comment=" + meta, "-movflags", "+faststart+use_metadata_tags"] : ["-movflags", "+faststart"]);

// 一帧帧的 png（或 jpg：codec "mjpeg"）从标准输入送进去，配上 wav，出 mp4（H.264 + AAC，PowerPoint 都能放）
//   label：叠在左上角的标识图（默认就是「AI生成」，传 false 不叠——只给测试用）；meta：隐式标识的 JSON
function encoder(out, { fps = 25, wav, codec = "png", label = LABEL, meta = null } = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", codec === "mjpeg" ? "mjpeg" : "png", "-i", "pipe:0"];
  if (wav) args.push("-i", wav);
  if (label) args.push("-i", label, "-filter_complex", `[0:v][${wav ? 2 : 1}:v]overlay=24:24:format=auto[v]`, "-map", "[v]", ...(wav ? ["-map", "1:a"] : []));
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", ...metaArgs(meta));
  if (wav) args.push("-c:a", "aac", "-b:a", "128k", "-af", "apad");   // 声音比画面短就补静音，长就跟着画面截断（帧数按声音算好了）
  args.push("-shortest", out);
  const p = spawn(ffmpegPath(), args, { windowsHide: true });
  let err = "", dead = null, frames = 0;
  p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  p.stdin.on("error", (e) => { dead = dead || e; });
  const done = new Promise((resolve, reject) => {
    p.on("error", (e) => reject(new Error("ffmpeg 启动不了：" + e.message)));
    p.on("close", (code) => (code === 0 ? resolve({ out, frames }) : reject(new Error("合成视频出错：" + (err.trim().split("\n").pop() || "退出码 " + code)))));
  });
  done.catch(() => {});
  return {
    write(png) {
      if (dead) return Promise.reject(new Error("合成视频出错：" + (err.trim() || dead.message)));
      frames++;
      return new Promise((r) => { if (p.stdin.write(Buffer.from(png))) r(); else p.stdin.once("drain", r); });
    },
    end() { p.stdin.end(); return done; },
    kill() { try { p.kill(); } catch (e) {} },
  };
}

// 已经有画面的视频（真人数字人对好口型的）+ 配音 → 叠标识、写元数据，出 PowerPoint 能放的 mp4
async function finalize(video, wav, out, { label = LABEL, meta = null } = {}) {
  const f = label ? ["-i", label, "-filter_complex", "[0:v][2:v]overlay=24:24:format=auto[v]", "-map", "[v]", "-map", "1:a"] : ["-map", "0:v", "-map", "1:a"];
  await run(["-i", video, "-i", wav, ...f, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", ...metaArgs(meta), out]);
}
// 视频的第一帧存成 png（PPT 里视频没开始放时显示的封面，也带着标识）
const poster = (video, out) => run(["-i", video, "-frames:v", "1", out]);

// ---------- 老师上传的视频 ----------
// 看一眼：多长、多大、有没有声音（ffmpeg -i 不给输出文件会「出错」退出，信息在 stderr 里）
function probe(src) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-i", src], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => reject(new Error("ffmpeg 启动不了：" + e.message)));
    p.on("close", () => {
      const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err), v = /Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(err);
      if (!d || !v) return reject(new Error("读不了这个视频（换成手机拍的 mp4 / mov 再试）"));
      resolve({ seconds: +d[1] * 3600 + +d[2] * 60 + +d[3], w: +v[1], h: +v[2], audio: /Audio: /.test(err) });
    });
  });
}
// 抽帧（每秒 fps 张，长边不超过 max）+ 整段声音（32k 单声道，配音参考从里面截）
async function extractVideo(src, dir, { fps = 4, max = 960, maxSec = 60 } = {}) {
  const info = await probe(src);
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  for (const f of fs.readdirSync(path.join(dir, "frames"))) fs.rmSync(path.join(dir, "frames", f), { force: true });
  await run(["-t", String(maxSec), "-i", src, "-vf", `fps=${fps},scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`, "-q:v", "3", path.join(dir, "frames", "f_%04d.jpg")]);
  const frames = fs.readdirSync(path.join(dir, "frames")).filter((f) => /^f_\d+\.jpg$/.test(f)).sort().map((f, i) => ({ file: path.join(dir, "frames", f), t: (i + 0.5) / fps }));
  let audio = null;
  if (info.audio) { audio = path.join(dir, "audio.wav"); await run(["-t", String(maxSec), "-i", src, "-vn", "-ac", "1", "-ar", "32000", "-c:a", "pcm_s16le", audio]); }
  return { ...info, seconds: Math.min(info.seconds, maxSec), frames, audio };
}
// 原视频某一时刻的一帧（原大小，当照片用）
const frameAt = (src, t, out) => run(["-ss", String(Math.max(0, t)), "-i", src, "-frames:v", "1", "-q:v", "2", out]);
// wav 截一段
const cutWav = (src, t0, t1, out, rate = 32000) => run(["-ss", String(t0), "-to", String(t1), "-i", src, "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", out]);
// 真人数字人的模板：截 t0～t1 秒，按脸裁成竖的 9:16（box 是 0～1 的比例：脸的中心 cx、cy 和要裁的宽 w），720×1280、25 帧、不要声音
function makeTemplate(src, t0, t1, out, { cx = 0.5, cy = 0.45, w = 0.6 } = {}) {
  const k = (v) => Math.min(1, Math.max(0, +v || 0)).toFixed(4);
  const crop = `crop=w='2*trunc(min(iw*${k(w)},ih*9/16)/2)':h='2*trunc(ow*16/9/2)':x='clip(iw*${k(cx)}-ow/2,0,iw-ow)':y='clip(ih*${k(cy)}-oh/2,0,ih-oh)'`;
  return run(["-ss", String(t0), "-to", String(t1), "-i", src, "-an", "-vf", `${crop},scale=720:1280,fps=25`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", out]);
}

module.exports = { ffmpegPath, readWav, writeWav, lipLevels, toWav, encoder, run, LABEL, aigc, finalize, poster, probe, extractVideo, frameAt, cutWav, makeTemplate };
