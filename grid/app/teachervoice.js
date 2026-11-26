// 捞小智 · 老师的声音（不用训练，零样本）：老师上传一段自己的录音 → 本机听写分句（带时间）→ 挑一段 3～10 秒、字数合适的当参考
//   → GPT-SoVITS（声音组件）照着这段参考说话（有「声音底座」voice-base 就用底座的权重，更像老师上课说话）
//   · 录音可以是手机录音机录的原文件（m4a、mp3、wav……），长一点也行（几十秒到几分钟），程序自己挑最合适的一段
//   · 挑不出来（听写没分句、句子都太长）：截前 8 秒，参考文字让老师自己填（参考文字和录音对不上，念出来会怪）
//   · 必须先勾授权（录音里是本人，或者已经得到本人同意）；全部在这台电脑上处理，不上传；随时一键删除
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const AUDIO = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "amr", "mp4", "mov"];
const PUNCT = /[，。！？、,.!?；;：:“”"'‘’（）()…—\-\s]/g;
const clean = (t) => String(t || "").replace(/\s+/g, "").trim();

// segs：听写出来的句子 [{ start, end, text }]（秒）；total：整段录音多少秒
// → { start, end, text, needText }：挑连在一起（中间停顿不超过 1.2 秒）的一句或几句，3～10 秒、至少 6 个字，最接近 7 秒、语速正常的那段
function pickRef(segs, total) {
  const ok = (segs || []).filter((s) => clean(s.text) && s.end > s.start);
  let best = null, score = 1e9;
  for (let i = 0; i < ok.length; i++) {
    let text = "";
    for (let j = i; j < ok.length; j++) {
      if (j > i && ok[j].start - ok[j - 1].end > 1.2) break;
      text += clean(ok[j].text);
      const d = ok[j].end - ok[i].start;
      if (d > 10) break;
      const n = text.replace(PUNCT, "").length, rate = n / d;
      if (d < 3 || n < 6) continue;
      const sc = Math.abs(d - 7) + (rate < 2 || rate > 7 ? 3 : 0);   // 一秒两到七个字算正常语速
      if (sc < score) { score = sc; best = { start: Math.max(0, ok[i].start - 0.15), end: Math.min(total || 1e9, ok[j].end + 0.25), text }; }
    }
  }
  if (best) return { ...best, needText: false };
  // 整段本来就 3～10 秒（听写没分句也没关系）：整段都用，文字就是听写出来的全部
  const all = (segs || []).map((s) => clean(s.text)).join("");
  if (total >= 3 && total <= 10 && all) return { start: 0, end: total, text: all, needText: false };
  // 挑不出来：从第一句开始截 8 秒，文字让老师自己填
  const s0 = ok.length ? ok[0].start : 0;
  return { start: s0, end: s0 + Math.max(3, Math.min(8, (total || 8) - s0)), text: "", needText: true };
}
// 参考文字后面要有个句号（GPT-SoVITS 的参考文字不带标点，开头容易念吞字）
const withStop = (t) => { t = clean(t); return t && !/[。！？.!?]$/.test(t) ? t + "。" : t; };

function create(o) {
  const dir = () => path.join(o.base(), "teacher-voice");   // 用到时才建（删掉以后看一眼状态不会又建出来）
  const F = (...a) => path.join(dir(), ...a);
  const META = () => F("voice.json");
  const log = o.log || (() => {});
  const read = () => { try { return JSON.parse(fs.readFileSync(META(), "utf8")); } catch (e) { return {}; } };
  const write = (m) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(META(), JSON.stringify(m, null, 1)); };
  const need = (c, m) => { if (!c) throw new Error(m); };

  function ff(args) {
    const c = o.ffmpeg ? o.ffmpeg() : "ffmpeg";
    const [cmd, ...pre] = Array.isArray(c) ? c : [c];   // 可以是 [程序, 前面固定的参数…]（测试用 node 跑一个假的）
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, [...pre, "-y", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => (err = (err + d).slice(-600)));
      p.on("error", (e) => reject(new Error("处理录音没成：" + e.message)));
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("处理录音没成（这个文件可能不是录音，或者坏了）：" + (err.split(/\r?\n/).filter(Boolean).slice(-1)[0] || code)))));
    });
  }
  const secsOf = (f) => { try { return o.media.readWav(fs.readFileSync(f)).seconds; } catch (e) { return 0; } };

  function info() {
    const m = read(), has = !!(m.ref && fs.existsSync(F(m.ref)));
    return { has, ready: has && !!m.text, text: m.text || "", secs: m.secs || 0, needText: has && !m.text, from: m.from || "", consent: m.consent || null, at: m.at || null };
  }
  // 录音文件 → 参考录音（ref.wav，32k 单声道）+ 参考文字
  async function fromFile(file, consent, say = () => {}) {
    need(consent && consent.ok, "要先勾选：录音里是我本人，或者我已经得到本人同意，只用来做捞小智的声音");
    const ext = path.extname(String(file || "")).slice(1).toLowerCase();
    need(AUDIO.includes(ext), "这个文件不是常见的录音格式（wav、mp3、m4a 都行）");
    need(fs.existsSync(file) && fs.statSync(file).size <= 300e6, "录音文件太大了（超过 300MB）：截短一点再传");
    const gd = o.gsvDir ? o.gsvDir() : null;
    need(gd, "要先装好声音组件（GPT-SoVITS）：照着老师的声音说话、听写录音都靠它");
    const tmp = path.join(os.tmpdir(), `lx-tv-${process.pid}-${Date.now()}.wav`);
    fs.mkdirSync(dir(), { recursive: true });
    try {
      say("把录音转成听写要的格式…", { p: 0.1 });
      await ff(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp]);
      const total = secsOf(tmp);
      need(total >= 3, "录音太短了（不到 3 秒）：至少说一两句完整的话");
      say(`听写录音（${Math.round(total)} 秒）、挑一段最合适的当参考…`, { p: 0.3 });
      const segs = await o.ear.segments(gd, tmp, (m) => say(m));
      const pick = pickRef(segs, total);
      say("截出参考录音…", { p: 0.8 });
      await ff(["-ss", pick.start.toFixed(2), "-t", (pick.end - pick.start).toFixed(2), "-i", file, "-vn", "-ac", "1", "-ar", "32000", "-c:a", "pcm_s16le", F("ref.new.wav")]);
      fs.renameSync(F("ref.new.wav"), F("ref.wav"));
      const m = { ref: "ref.wav", text: withStop(pick.text), secs: Math.round(secsOf(F("ref.wav")) * 10) / 10, from: path.basename(file), total: Math.round(total), at: Date.now(),
        consent: { at: Date.now(), by: String(consent.by || "").slice(0, 40) } };
      write(m);
      log(`老师的声音：从「${m.from}」（${m.total} 秒）里截了 ${m.secs} 秒当参考${m.text ? "：" + m.text : "，文字要老师自己填"}`);
      say(m.text ? "老师的声音准备好了" : "截好了，但是没听清这段说的什么：在下面填上录音里说的话", { p: 1, done: true });
      return { ...info(), preview: preview() };
    } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(F("ref.new.wav"), { force: true }); }
  }
  // 参考文字听写错了：老师改（要和录音里说的一字不差，念出来才像）
  function setText(t) {
    const m = read(); need(m.ref && fs.existsSync(F(m.ref)), "先上传一段老师的录音");
    t = withStop(String(t || "").slice(0, 120)); need(t.replace(PUNCT, "").length >= 2, "参考文字太短了：填上录音里说的话");
    m.text = t; write(m); return info();
  }
  function ref() { const i = info(); return i.ready ? { wav: F("ref.wav"), text: i.text, at: read().at || 0 } : null; }
  function preview() { const i = info(); return i.has ? fs.readFileSync(F("ref.wav")).toString("base64") : null; }
  function wipe() { fs.rmSync(dir(), { recursive: true, force: true }); return info(); }
  return { info, fromFile, setText, ref, preview, wipe, ready: () => !!ref() };
}

module.exports = { create, pickRef, AUDIO };
