// 电脑自带的朗读（Windows 的 System.Speech，中文是系统里的「慧慧」这类声音）：
//   捞捞的声音还没训练好、或者这台电脑还没装声音组件（GPT-SoVITS）时，先用它把回答念出来；训练好了自动换成捞捞的声音。
//   不用下载任何东西，也不是照着谁的声音学的。一次只念一句（排队），每次开一个 PowerShell。
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PS = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
$v=$s.GetInstalledVoices()|Where-Object{$_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*'}|Select-Object -First 1
if(-not $v){[Console]::Out.Write('NOZH');exit 3}
if(-not $env:LG_TTS_OUT){[Console]::Out.Write('OK:'+$v.VoiceInfo.Name);exit 0}
$s.SelectVoice($v.VoiceInfo.Name)
$s.Rate=[int]$env:LG_TTS_RATE
$f=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:LG_TTS_OUT,$f)
$s.Speak([IO.File]::ReadAllText($env:LG_TTS_IN,[Text.Encoding]::UTF8))
$s.Dispose()
[Console]::Out.Write('OK:'+$v.VoiceInfo.Name)`;

// 跑一次 PowerShell：env 里放输入输出文件；返回 { code, out }
function runPs(env, o = {}) {
  return new Promise((resolve) => {
    let out = "", done = false;
    const enc = Buffer.from(PS, "utf16le").toString("base64");
    let p;
    try { p = (o.spawn || spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { resolve({ code: -1, out: String(e.message) }); return; }
    const t = setTimeout(() => { try { p.kill(); } catch (e) {} }, o.timeoutMs || 60e3);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    const end = (code) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out: out.trim() }); };
    p.on("error", (e) => { out += String(e.message); end(-1); });
    p.on("close", (code) => end(code));
  });
}

function create(o = {}) {
  const platform = o.platform || process.platform;
  const run = o.run || ((env) => runPs(env, o));
  let avail = null, chain = Promise.resolve();
  const state = { ok: false, name: null, why: platform === "win32" ? "还没看过" : "只有 Windows 电脑自带中文朗读" };

  // 这台电脑有没有中文朗读声音（只看一次）
  function available() {
    if (platform !== "win32") return Promise.resolve(state);
    if (!avail) avail = run({ LG_TTS_OUT: "", LG_TTS_IN: "", LG_TTS_RATE: "0" }).then((r) => {
      if (r.code === 0 && /^OK:/.test(r.out)) { state.ok = true; state.name = r.out.slice(3).trim(); state.why = ""; }
      else { state.ok = false; state.why = /NOZH/.test(r.out) ? "这台电脑没有中文朗读声音" : "电脑自带朗读打不开"; }
      return state;
    });
    return avail;
  }
  // 念一句 → wav（Buffer）
  function tts(text) {
    const job = chain.then(async () => {
      const s = await available();
      if (!s.ok) throw new Error(s.why);
      const tmp = path.join(o.tmpDir || os.tmpdir(), "laolao-tts-" + crypto.randomBytes(6).toString("hex"));
      const inF = tmp + ".txt", outF = tmp + ".wav";
      fs.writeFileSync(inF, String(text || ""), "utf8");
      try {
        const r = await run({ LG_TTS_IN: inF, LG_TTS_OUT: outF, LG_TTS_RATE: String(o.rate != null ? o.rate : 0) });
        if (r.code !== 0 || !fs.existsSync(outF)) throw new Error("电脑自带朗读没念出来" + (r.out ? "：" + r.out.slice(0, 200) : ""));
        return fs.readFileSync(outF);
      } finally { fs.rmSync(inF, { force: true }); fs.rmSync(outF, { force: true }); }
    });
    chain = job.catch(() => {});
    return job;
  }
  return { available, tts, state: () => state };
}

module.exports = { create, PS };
