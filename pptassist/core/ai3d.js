// 捞捞PPT助手 · AI 3D 形象：调「捞捞形象工坊」（ai3d/lao3d，Python），全部在老师自己电脑上跑
//   1. 照片 + 参考图 → 几张公仔立绘（Qwen-Image-Edit-2509 4bit，要 NVIDIA 显卡）
//   2. 选一张（或者直接用老师自己已经有的公仔图）→ 带贴图的 3D 模型（Hunyuan3D-2，要显卡）
//   3. 绑骨骼、让眼睛和嘴会动（不用显卡）→ avatar.glb
//   用的 Python 是 Hunyuan3D-2 整合包里带的（老师下好、解压，在软件里选一下那个文件夹）。
//   工坊往标准输出写「@@{json}」一行一条：进度、结果、出错；其余的行是日志（留最后几十行，出错时带上）。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PAGES = {
  hy: "https://github.com/deepbeepmeep/Hunyuan3D-2GP",
  portable: "https://github.com/YanWenKun/Hunyuan3D-2-WinPortable",
};

// 工坊的代码在哪（打包后在 app.asar.unpacked 里，Python 读不了 asar）
function libDir() {
  return path.join(__dirname, "..", "ai3d").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

function findHy(dir) {
  const ok = (d) => fs.existsSync(path.join(d, "hy3dgen", "shapegen", "__init__.py"));
  const cands = [dir, ...["Hunyuan3D-2", "Hunyuan3D-2GP", "Hunyuan3D2", "hunyuan3d-2"].map((d) => path.join(dir, d))];
  try { for (const d of fs.readdirSync(dir)) cands.push(path.join(dir, d)); } catch (e) {}
  return cands.find((d) => { try { return ok(d); } catch (e) { return false; } }) || null;
}

// 这个文件夹能用吗：要有 Python（整合包自带的优先），最好也有 hy3dgen（Hunyuan3D-2 的代码）
function inspect(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: "文件夹不在了" };
  const win = process.platform === "win32";
  const rel = win
    ? ["python_standalone\\python.exe", "python\\python.exe", "python_embeded\\python.exe", "runtime\\python.exe", ".venv\\Scripts\\python.exe", "venv\\Scripts\\python.exe", "python.exe"]
    : ["python_standalone/bin/python3", ".venv/bin/python", "venv/bin/python", "runtime/bin/python"];
  let py = rel.map((r) => path.join(dir, r)).find((p) => fs.existsSync(p));
  if (!py) try { for (const d of fs.readdirSync(dir)) { const p = path.join(dir, d, win ? "python.exe" : "bin/python3"); if (fs.existsSync(p)) { py = p; break; } } } catch (e) {}
  const hy = findHy(dir);
  if (!py && !hy) return { ok: false, error: "这个文件夹里既没有 Python 也没有 Hunyuan3D-2 的代码：请选 Hunyuan3D-2 整合包解压出来的那个文件夹" };
  return { ok: true, dir, python: py || (win ? "python.exe" : "python3"), hy, ownPython: !!py };
}

function create(opt = {}) {
  let job = null;   // 一次只跑一件事
  const log = [];
  const state = () => (job ? { busy: true, cmd: job.cmd, last: job.last } : { busy: false });
  function run(rt, args, onMsg, extraEnv = {}) {
    if (job) return Promise.reject(new Error("上一件还没做完：" + job.cmd));
    if (!rt || !rt.python) return Promise.reject(new Error("先选 Hunyuan3D-2 整合包的文件夹"));
    const lib = opt.lib || libDir();
    const env = { ...process.env, PYTHONPATH: lib, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...extraEnv };
    if (opt.models) env.HY3DGEN_MODELS = env.HY3DGEN_MODELS || opt.models;
    const cmd = opt.cmd || rt.python;
    const argv = (opt.argsPrefix || []).concat(["-u", "-m", "lao3d.run"], args, rt.hy ? ["--hy", rt.hy] : []);
    return new Promise((resolve, reject) => {
      let p;
      try { p = spawn(cmd, argv, { cwd: lib, env, windowsHide: true }); } catch (e) { return reject(new Error("Python 没启动起来：" + e.message)); }
      job = { cmd: args[0], p, last: null, done: null, err: null };
      let buf = "";
      const line = (l) => {
        if (l.startsWith("@@")) {
          let m; try { m = JSON.parse(l.slice(2)); } catch (e) { return; }
          if (job) job.last = m;
          if (m.error) job.err = m.error;
          if (m.done) job.done = m;
          try { onMsg && onMsg(m); } catch (e) {}
        } else if (l.trim()) { log.push(l); if (log.length > 60) log.shift(); }
      };
      p.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); } });
      p.stderr.on("data", (d) => { for (const l of d.toString("utf8").split(/\r?\n/)) if (l.trim()) { log.push(l); if (log.length > 60) log.shift(); } });
      p.on("error", (e) => { const j = job; job = null; reject(new Error((e.code === "ENOENT" ? "找不到 Python：" : "Python 出错：") + (e.message || e))); });
      p.on("close", (code) => {
        if (buf) line(buf);
        const j = job; job = null;
        if (!j) return;
        if (j.killed) return reject(new Error("已经停了"));
        if (j.done && !j.err) return resolve(j.done);
        const tail = log.slice(-6).join("\n");
        reject(new Error((j.err || `工坊没做完（退出码 ${code}）`) + (tail && !j.err ? "\n" + tail : "")));
      });
    });
  }
  function cancel() {
    if (!job) return false;
    job.killed = true;
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(job.p.pid), "/T", "/F"], { windowsHide: true });
      else job.p.kill("SIGTERM");
    } catch (e) {}
    return true;
  }
  return { run, cancel, state, log };
}

module.exports = { create, inspect, findHy, libDir, PAGES };
