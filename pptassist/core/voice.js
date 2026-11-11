// 捞捞PPT助手 · 老师的声音（本机离线）：用 GPT-SoVITS 的整合包
//   老师上传一段 3～10 秒自己的录音 + 这段录音说的话，GPT-SoVITS 就能用这个声音念任何文字（不用训练）。
//   整合包老师自己下好、解压（几个 G，需要 NVIDIA 显卡），在软件里选一下那个文件夹；
//   我们用它自带的 Python 跑 api_v2.py（本机 127.0.0.1 上的一个小服务），再把文字发过去要 wav。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const DOWNLOAD_PAGE = "https://github.com/RVC-Boss/GPT-SoVITS/blob/main/docs/cn/README.md";

// 这个文件夹是不是 GPT-SoVITS：要有 api_v2.py；Python 优先用整合包里的 runtime
function inspect(dir) {
  if (!dir || !fs.existsSync(path.join(dir, "api_v2.py"))) return { ok: false, error: "这个文件夹里没有 api_v2.py：请选 GPT-SoVITS 整合包解压出来的那个文件夹（里面有 go-webui.bat）" };
  const cands = [path.join(dir, "runtime", "python.exe"), path.join(dir, "runtime", "bin", "python"), path.join(dir, ".venv", "Scripts", "python.exe"), path.join(dir, ".venv", "bin", "python")];
  const py = cands.find((p) => fs.existsSync(p)) || (process.platform === "win32" ? "python.exe" : "python3");
  return { ok: true, dir, python: py };
}
function freePort(pref) {
  return new Promise((resolve) => {
    const s = net.createServer(); s.unref();
    s.once("error", () => { const t = net.createServer(); t.listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => resolve(p)); }); });
    s.listen(pref, "127.0.0.1", () => s.close(() => resolve(pref)));
  });
}
function portOpen(port) {
  return new Promise((resolve) => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false)); c.setTimeout(800, () => { c.destroy(); resolve(false); }); });
}
function post(port, pathName, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, path: pathName, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length }, timeout: timeoutMs }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("等太久了（超过 " + Math.round(timeoutMs / 1000) + " 秒）")));
    req.on("error", reject);
    req.end(data);
  });
}

// opt.cmd / opt.args：测试时换成假的服务
function create({ log = () => {}, onState = () => {} } = {}) {
  let proc = null, port = 0, state = "off", lastErr = "", tail = [], cfg = null;
  const set = (s, e) => { state = s; if (e !== undefined) lastErr = e; onState({ state, error: lastErr, port }); };
  async function start(dir, opt = {}) {
    if (proc && cfg && cfg.dir === dir && state === "ready") return { state, port };
    stop();
    const info = opt.cmd ? { ok: true, dir, python: opt.cmd } : inspect(dir);
    if (!info.ok) { set("error", info.error); throw new Error(info.error); }
    cfg = info; port = await freePort(opt.port || 9880); tail = [];
    const args = opt.args ? opt.args(port) : ["api_v2.py", "-a", "127.0.0.1", "-p", String(port)];
    set("starting", "");
    proc = spawn(info.python, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const keep = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { tail.push(l); if (tail.length > 40) tail.shift(); log(l); } };
    proc.stdout.on("data", keep); proc.stderr.on("data", keep);
    const me = proc;
    proc.on("error", (e) => { if (proc === me) { proc = null; set("error", "启动不了 GPT-SoVITS：" + e.message); } });
    proc.on("exit", (code) => { if (proc === me) { proc = null; set(state === "ready" ? "off" : "error", state === "ready" ? "" : "GPT-SoVITS 退出了（" + code + "）：" + (tail.slice(-3).join(" ") || "没有输出")); } });
    // 模型加载要一会儿：等端口能连上（最多 opt.waitMs，默认 4 分钟）
    const t0 = Date.now(), waitMs = opt.waitMs || 240000;
    while (Date.now() - t0 < waitMs) {
      if (!proc) throw new Error(lastErr || "GPT-SoVITS 没起来");
      if (await portOpen(port)) { set("ready", ""); return { state, port }; }
      await new Promise((r) => setTimeout(r, 700));
    }
    stop(); set("error", "GPT-SoVITS 启动超时：" + (tail.slice(-3).join(" ") || "没有输出")); throw new Error(lastErr);
  }
  function stop() { if (proc) { const p = proc; proc = null; try { p.kill(); } catch (e) {} } if (state !== "error" && state !== "off") set("off"); }
  // 用参考录音的声音念 text，返回 wav（Buffer）
  async function tts({ text, refWav, promptText, speed = 1.0 }) {
    if (state !== "ready") throw new Error("老师的声音还没准备好：先在「我的声音」里启动 GPT-SoVITS");
    const r = await post(port, "/tts", {
      text: String(text), text_lang: "zh", ref_audio_path: refWav, prompt_text: String(promptText || ""), prompt_lang: "zh",
      text_split_method: "cut5", batch_size: 1, media_type: "wav", streaming_mode: false, speed_factor: speed, parallel_infer: true, repetition_penalty: 1.35,
    }, 10 * 60 * 1000);
    if (r.status !== 200 || r.body.toString("ascii", 0, 4) !== "RIFF") {
      let msg = r.body.toString("utf8").slice(0, 300); try { const j = JSON.parse(msg); msg = j.message || j.detail || msg; if (typeof msg !== "string") msg = JSON.stringify(msg); } catch (e) {}
      throw new Error("生成声音失败：" + msg);
    }
    return r.body;
  }
  return { start, stop, tts, get state() { return { state, error: lastErr, port, dir: cfg && cfg.dir }; }, get log() { return tail.slice(); } };
}

module.exports = { create, inspect, DOWNLOAD_PAGE };
