// 捞捞算力 · 成品展示「打电话」的耳朵：在本机起一个小服务（py/asr_server.py，用 GPT-SoVITS 整合包的 Python 和 FunASR），
//   界面上录到的一句话（wav）发过去，拿回文字。第一次要加载模型（十几秒到一分钟），10 分钟没人说话就关掉，省内存。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "py", "asr_server.py").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");

function freePort() { return new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function portOpen(port) { return new Promise((r) => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.destroy(); r(true); }); c.once("error", () => r(false)); c.setTimeout(800, () => { c.destroy(); r(false); }); }); }
function pythonOf(dir) { return [path.join(dir, "runtime", "python.exe"), path.join(dir, "runtime", "bin", "python"), path.join(dir, ".venv", "Scripts", "python.exe"), path.join(dir, ".venv", "bin", "python")].find((p) => fs.existsSync(p)); }

// 听写模型：三个文件夹放在整合包的 tools/asr/models/ 里（asr_server.py 先认这里）。
//   捞捞的国内存储里有打好的包（AI 组件镜像里的 asrZh，约 1G，见 .github/workflows/build-asr.py）：先从那里下，
//   比魔搭一个文件一个文件地下快很多；镜像里没有、或者下不下来，再让 FunASR 自己从魔搭下（以前的办法）
const ASR_MODELS = ["speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch", "speech_fsmn_vad_zh-cn-16k-common-pytorch", "punc_ct-transformer_zh-cn-common-vocab272727-pytorch"];
const modelsDir = (dir) => path.join(dir, "tools", "asr", "models");
const MODELS_OK = (dir) => path.join(modelsDir(dir), ".laolao-asr-v2.0.4");
const PPT = (f) => require(path.join(__dirname, "ppt", f));
// 准备好过一次（模型下好了）就在整合包里记一笔：以后打开展示不用再提前下
const MARK = (dir) => path.join(dir, "tools", "asr", ".laolao-ear-ok");
// 下载进度：FunASR / 魔搭用 tqdm 打进度条（「 45%|████ 」，用 \r 刷新，不换行）
function pctOf(d) { const m = [...String(d).matchAll(/(\d{1,3})%\|/g)].pop(); return m ? Math.min(100, +m[1]) : null; }

// o.python / o.args：测试时换成假的；o.idleMs：多久没用就关（默认 10 分钟）
//   o.stallMs：多久没有任何输出（下载也没在动）才算卡住（默认 3 分钟）；o.waitMs：最多等多久（默认 40 分钟，网再慢也够下几百 M）
function create(o = {}) {
  const log = o.log || (() => {});
  let proc = null, port = 0, starting = null, dirNow = null, idle = null, tail = [], pct = null;
  const sayers = new Set();   // 正在等听写准备好的（提前准备时没人看；打电话时界面在等）：进度都告诉它们
  function stop() { clearTimeout(idle); if (proc) { const p = proc; proc = null; try { p.kill(); } catch (e) {} } starting = null; }
  function touch() { clearTimeout(idle); idle = setTimeout(stop, o.idleMs || 10 * 60e3); idle.unref && idle.unref(); }
  let mirror = o.mirror || null;
  const mir = () => { if (!mirror) { try { mirror = PPT("mirror.js").create(o.mirrorOpt || {}); } catch (e) { mirror = { model: async () => [], sources: () => [] }; } } return mirror; };
  const haveModels = (dir) => fs.existsSync(MODELS_OK(dir)) && ASR_MODELS.every((m) => fs.existsSync(path.join(modelsDir(dir), m)));
  // 从国内存储下听写模型包、解压；成功返回 true；镜像里没有 / 下不下来返回 false（交给 FunASR 自己从魔搭下）
  async function fetchModels(dir) {
    if (haveModels(dir)) return true;
    let hit = null;
    try { hit = (await mir().model("asrZh"))[0] || null; } catch (e) {}
    if (!hit) { log("国内存储里还没有听写模型包：让 FunASR 从魔搭下"); return false; }
    const urls = mir().sources(hit), tar = path.join(modelsDir(dir), "..", "asr-models.tar");
    const MB = hit.size ? Math.round(hit.size / 1048576) : 0;
    try {
      fs.mkdirSync(modelsDir(dir), { recursive: true });
      let lastTell = 0;
      await (o.dl || PPT("dl.js")).download(urls, tar, { want: { size: hit.size, sha256: hit.sha256 }, log,
        onProg: (x) => { pct = x.total ? Math.min(99, Math.floor((x.got / x.total) * 100)) : pct; if (Date.now() - lastTell > 1200) { lastTell = Date.now(); tell(`第一次用听写：正在下载识别模型 ${pct == null ? "" : pct + "%"}（从捞捞的国内存储${MB ? "，约 " + MB + " M" : ""}，只下这一次）`); } } });
      tell("第一次用听写：识别模型下好了，正在解压…");
      await (o.extract || PPT("installer.js").extract)(tar, modelsDir(dir), {});
      if (!ASR_MODELS.every((m) => fs.existsSync(path.join(modelsDir(dir), m)))) throw new Error("压缩包里少了模型文件夹");
      fs.writeFileSync(MODELS_OK(dir), new Date().toISOString());
      fs.rmSync(tar, { force: true });
      pct = null;
      return true;
    } catch (e) { log("从国内存储下听写模型没成（" + e.message + "）：让 FunASR 从魔搭下"); return false; }
  }
  const ready = (dir) => { try { return fs.existsSync(MARK(dir)); } catch (e) { return false; } };
  async function start(dir, say = () => {}) {
    if (proc && dirNow === dir && !starting) return port;
    if (starting && dirNow === dir) { sayers.add(say); if (pct != null) say(progressText()); try { return await starting; } finally { sayers.delete(say); } }
    stop();
    sayers.add(say);
    const py = o.python || pythonOf(dir);
    if (!py) throw new Error("声音组件（GPT-SoVITS）里找不到 Python：重新点「装上声音组件」");
    dirNow = dir;
    starting = (async () => {
      port = await freePort(); tail = []; pct = null;
      const first = !ready(dir);
      tell(first && !haveModels(dir) ? "第一次用听写：正在下载识别模型（只下这一次）…" : "正在打开听写（十几秒）…");
      if (!haveModels(dir) && (!o.args || o.mirror)) await fetchModels(dir);   // 测试换了假的听写（o.args）又没给假镜像：不下
      const args = o.args ? o.args(port) : ["-u", SCRIPT, "--port", String(port)];
      const me = spawn(py, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...(o.env || {}) } });
      proc = me;
      let dead = null;
      let lastOut = Date.now(), lastTell = 0;
      const keep = (d) => {
        lastOut = Date.now();
        const p = pctOf(d);
        if (p != null) { pct = p; if (Date.now() - lastTell > 1500) { lastTell = Date.now(); tell(progressText()); } }
        for (const l of String(d).split(/\r?\n|\r/)) if (l.trim() && pctOf(l) == null) { tail.push(l); if (tail.length > 30) tail.shift(); log(l); }
      };
      me.stdout.on("data", keep); me.stderr.on("data", keep);
      me.on("error", (e) => { dead = "启动不了听写：" + e.message; });
      me.on("exit", (c) => { dead = dead || explain(c); if (proc === me) proc = null; });
      // 退出的原因：asr_server.py 自己写的「ERROR: …」最清楚；没有就取最后几行（跳过 FunASR 列的那一长串「  - 某模块没装」）
      const explain = (c) => { const e = tail.filter((l) => /^ERROR: /.test(l)).pop(); return e ? e.slice(7) : "听写退出了（" + c + "）：" + (tail.filter((l) => !/^\s+- /.test(l)).slice(-3).join(" ") || "没有输出"); };
      const t0 = Date.now(), waitMs = o.waitMs || 40 * 60e3, stallMs = o.stallMs || 3 * 60e3;
      while (Date.now() - t0 < waitMs) {
        if (dead) throw new Error(dead);
        if (proc !== me) throw new Error("听写被关掉了");
        if (await portOpen(port)) { touch(); try { fs.mkdirSync(path.dirname(MARK(dir)), { recursive: true }); fs.writeFileSync(MARK(dir), new Date().toISOString()); } catch (e) {} pct = null; tell("听写准备好了", true); return port; }
        // 下载在动（或者有别的输出）就接着等；3 分钟一点动静都没有才算卡住
        if (Date.now() - lastOut > stallMs) { stop(); throw new Error("下载听写模型卡住了（3 分钟没有进展）：检查一下网络，再点「打电话」会接着下"); }
        await new Promise((r) => setTimeout(r, 500));
      }
      stop(); throw new Error("听写启动超时：" + (tail.slice(-3).join(" ") || "没有输出"));
    })();
    try { return await starting; } catch (e) { stop(); throw e; } finally { starting = null; sayers.clear(); }
  }
  function progressText() { return `第一次用听写：正在下载识别模型 ${pct}%（几百 M，只下这一次）`; }
  function tell(m, done) { for (const f of sayers) { try { f(m, { pct: done ? 100 : pct, done: !!done }); } catch (e) {} } }
  // 提前准备（打开展示、接通电话时）：下载、加载模型，出错不报（真打电话时再说）
  function warm(dir, say) { return start(dir, say || (() => {})).then(() => true, (e) => { log("提前准备听写没成：" + e.message); return false; }); }
  // wav（Buffer）→ 文字
  async function hear(dir, wav, say) {
    const p = await start(dir, say);
    touch();
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: p, path: "/asr", method: "POST", headers: { "Content-Type": "audio/wav", "Content-Length": wav.length }, timeout: 120e3 }, (res) => {
        const cs = []; res.on("data", (c) => cs.push(c)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString("utf8") }));
      });
      req.on("timeout", () => req.destroy(new Error("听写等太久了")));
      req.on("error", reject); req.end(wav);
    });
    let j = {}; try { j = JSON.parse(r.body); } catch (e) {}
    if (r.status !== 200) throw new Error("没听清（" + (j.error || r.body.slice(0, 200)) + "）");
    return String(j.text || "").trim();
  }
  // 长录音（课程视频的音轨，16k 单声道 wav 文件）→ 一句一句带时间 [{ start, end, text }]（秒）
  async function segments(dir, wavFile, say) {
    const p = await start(dir, say);
    touch();
    const size = fs.statSync(wavFile).size;
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: p, path: "/asr?ts=1", method: "POST", headers: { "Content-Type": "audio/wav", "Content-Length": size }, timeout: 3 * 3600e3 }, (res) => {
        const cs = []; res.on("data", (c) => cs.push(c)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString("utf8") }));
      });
      req.on("timeout", () => req.destroy(new Error("听写等太久了")));
      req.on("error", reject);
      fs.createReadStream(wavFile).pipe(req);
    });
    let j = {}; try { j = JSON.parse(r.body); } catch (e) {}
    if (r.status !== 200) throw new Error("听写没成（" + (j.error || r.body.slice(0, 200)) + "）");
    return Array.isArray(j.segments) ? j.segments : [];
  }
  return { start, hear, segments, stop, warm, ready, get running() { return !!proc && !starting; }, get preparing() { return !!starting; }, progress: () => pct };
}

module.exports = { create, SCRIPT, pctOf, MARK, ASR_MODELS, MODELS_OK };
