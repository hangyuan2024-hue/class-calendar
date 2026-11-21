// 捞小智 · 好听的默认声音：Kokoro 中文女声（kokoro-multi-lang-v1_0，Apache-2.0），用 sherpa-onnx 在本机合成，不用显卡、不联网
//   · 合成用 sherpa-onnx 的 Node 版（npm 包 sherpa-onnx-node，跟着安装包走），在单独的小进程里（tts-worker.js），模型只加载一次
//   · 模型（约 330M）第一次用时下载：先从捞捞的国内存储（AI 组件镜像里的 kokoroZh，见 .github/workflows/build-kokoro.py），
//     再从 GitHub 加速镜像、GitHub 原地址；解压到 数据文件夹/tts/kokoro-multi-lang-v1_0/
//   · 一句一句合成（排队），输出 24000Hz 的 wav
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const PPT = (f) => require(path.join(__dirname, "ppt", f));

const DIRNAME = "kokoro-multi-lang-v1_0";
const GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2";
const URLS = ["https://ghfast.top/" + GH, "https://gh-proxy.com/" + GH, GH];
// 中文女声（v1_0 的说话人编号）：45 zf_xiaobei、46 zf_xiaoni、47 zf_xiaoxiao、48 zf_xiaoyi
const VOICES = { xiaoxiao: 47, xiaobei: 45, xiaoni: 46, xiaoyi: 48 };
const NEED = ["model.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt", "espeak-ng-data"];

function create(o) {
  const base = o.base;   // () => 数据文件夹
  const log = o.log || (() => {});
  const dir = () => path.join(base(), "tts", DIRNAME);
  const modelOk = () => NEED.every((f) => fs.existsSync(path.join(dir(), f)));
  let fetching = null, chain = Promise.resolve();
  let mirror = o.mirror || null;
  const mir = () => { if (!mirror) { try { mirror = PPT("mirror.js").create(o.mirrorOpt || {}); } catch (e) { mirror = { model: async () => [], sources: () => [] }; } } return mirror; };

  // 下载、解压模型。say(文字, { pct, done })
  function ensure(say = () => {}) {
    if (modelOk()) return Promise.resolve(true);
    if (fetching) return fetching;
    fetching = (async () => {
      const top = path.join(base(), "tts"); fs.mkdirSync(top, { recursive: true });
      let hit = null; try { hit = (await mir().model("kokoroZh"))[0] || null; } catch (e) {}
      // 国内存储里是解压过一层的 .tar（7-Zip 一次解开）；GitHub 上的是 .tar.bz2（要解两次）
      const plans = [];
      if (hit) plans.push({ urls: mir().sources(hit), file: path.join(top, "kokoro.tar"), size: hit.size, sha256: hit.sha256 });
      plans.push({ urls: URLS, file: path.join(top, "kokoro.tar.bz2"), size: 0 });
      let lastErr = null;
      for (const p of plans) {
        try {
          let last = 0;
          const MB = p.size ? Math.round(p.size / 1048576) : 330;
          say(`下载好听的声音（Kokoro 中文女声，约 ${MB} M，只下这一次）…`, { pct: 0 });
          await (o.dl || PPT("dl.js")).download(p.urls, p.file, { want: { size: p.size || 0, sha256: p.sha256 || "" }, log,
            onProg: (x) => { if (Date.now() - last < 1000) return; last = Date.now(); const pct = x.total ? Math.min(99, Math.floor((x.got / x.total) * 100)) : null; say(`下载好听的声音：${pct == null ? Math.round(x.got / 1048576) + " M" : pct + "%"}${x.speed ? `，${(x.speed / 1e6).toFixed(1)}M/秒` : ""}`, { pct }); } });
          say("解压声音模型…", { pct: 99 });
          const ex = o.extract || PPT("installer.js").extract;
          if (/\.bz2$/.test(p.file)) { await ex(p.file, top, {}); const t = p.file.replace(/\.bz2$/, ""); await ex(t, top, {}); fs.rmSync(t, { force: true }); }
          else await ex(p.file, top, {});
          fs.rmSync(p.file, { force: true });
          if (!modelOk()) throw new Error("压缩包里少了文件");
          say("好听的声音准备好了", { pct: 100, done: true });
          return true;
        } catch (e) { lastErr = e; log("Kokoro 声音下载没成（" + e.message + "）"); try { fs.rmSync(p.file, { force: true }); } catch (x) {} }
      }
      throw new Error("好听的声音下载不下来：" + (lastErr ? lastErr.message : "") + "（检查网络后再试）");
    })().finally(() => { fetching = null; });
    return fetching;
  }

  // 合成用的小进程（见 tts-worker.js）：第一次用时起来、加载模型，之后一直用；出错就重起
  let wk = null, seq = 0;
  const pend = new Map();
  function worker() {
    if (wk) return wk;
    // 打包后：小进程和语音库都解压在 app.asar.unpacked 里（Electron 当 Node 用时读 asar 里的原生模块不稳），从那里跑、从那里加载
    const un = (f) => f.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const script = o.workerScript || un(path.join(__dirname, "tts-worker.js"));
    const lib = un(path.join(__dirname, "..", "node_modules", "sherpa-onnx-node"));
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(fs.existsSync(lib) ? { LG_SHERPA: lib } : {}), ...(o.env || {}) };
    const p = (o.spawn || spawn)(o.node || process.execPath, [script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
    let buf = "", err = "";
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch (e) { continue; } const w = pend.get(m.id); if (w) { pend.delete(m.id); m.error ? w.bad(new Error(m.error)) : w.ok(m); } } });
    p.stderr.on("data", (d) => { err = (err + d).slice(-1500); });
    const dead = (why) => { if (wk && wk.p === p) wk = null; for (const [, w] of pend) w.bad(new Error(why + (err ? "：" + err.trim().split(/\r?\n/).slice(-2).join(" ") : ""))); pend.clear(); };
    p.on("error", (e) => dead("语音合成程序打不开：" + e.message));
    p.on("exit", (c) => dead("语音合成程序退出了（" + c + "）"));
    const ask = (msg, ms) => new Promise((ok, bad) => { const id = ++seq; const t = setTimeout(() => { if (pend.delete(id)) { bad(new Error("语音合成等太久了")); try { p.kill(); } catch (e) {} } }, ms || 60e3); pend.set(id, { ok: (m) => { clearTimeout(t); ok(m); }, bad: (e) => { clearTimeout(t); bad(e); } }); p.stdin.write(JSON.stringify({ id, ...msg }) + "\n"); });
    const init = ask({ init: { dir: dir(), threads: Math.max(1, Math.min(4, (os.cpus() || []).length - 1)) } }, 120e3);
    wk = { p, ask, init };
    init.catch(() => { try { p.kill(); } catch (e) {} });
    return wk;
  }
  function stop() { if (wk) { try { wk.p.kill(); } catch (e) {} wk = null; } }
  // 一句话 → wav（Buffer）
  function tts(text, voice) {
    const job = chain.then(async () => {
      if (!modelOk()) await ensure();
      const out = path.join(os.tmpdir(), "laolao-kokoro-" + crypto.randomBytes(6).toString("hex") + ".wav");
      const sid = VOICES[voice] != null ? VOICES[voice] : VOICES[o.voice] != null ? VOICES[o.voice] : VOICES.xiaoxiao;
      try {
        const w = worker(); await w.init;
        await w.ask({ text: String(text || "").slice(0, 400), sid, speed: o.speed || 1.0, out });
        return fs.readFileSync(out);
      } finally { fs.rmSync(out, { force: true }); }
    });
    chain = job.catch(() => {});
    return job;
  }
  return { ensure, tts, stop, ready: modelOk, modelOk, dir, VOICES };
}

module.exports = { create, VOICES, DIRNAME, URLS };
