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

// o.python / o.args：测试时换成假的；o.idleMs：多久没用就关（默认 10 分钟）
function create(o = {}) {
  const log = o.log || (() => {});
  let proc = null, port = 0, starting = null, dirNow = null, idle = null, tail = [];
  function stop() { clearTimeout(idle); if (proc) { const p = proc; proc = null; try { p.kill(); } catch (e) {} } starting = null; }
  function touch() { clearTimeout(idle); idle = setTimeout(stop, o.idleMs || 10 * 60e3); idle.unref && idle.unref(); }
  async function start(dir, say = () => {}) {
    if (proc && dirNow === dir && !starting) return port;
    if (starting && dirNow === dir) return starting;
    stop();
    const py = o.python || pythonOf(dir);
    if (!py) throw new Error("声音组件（GPT-SoVITS）里找不到 Python：重新点「装上声音组件」");
    dirNow = dir;
    starting = (async () => {
      port = await freePort(); tail = [];
      say("第一次打电话：正在准备听写（加载识别模型，第一次要从国内下几百 M）…");
      const args = o.args ? o.args(port) : ["-u", SCRIPT, "--port", String(port)];
      const me = spawn(py, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...(o.env || {}) } });
      proc = me;
      let dead = null;
      const keep = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { tail.push(l); if (tail.length > 30) tail.shift(); log(l); } };
      me.stdout.on("data", keep); me.stderr.on("data", keep);
      me.on("error", (e) => { dead = "启动不了听写：" + e.message; });
      me.on("exit", (c) => { dead = dead || "听写退出了（" + c + "）：" + (tail.slice(-3).join(" ") || "没有输出"); if (proc === me) proc = null; });
      const t0 = Date.now(), waitMs = o.waitMs || 10 * 60e3;
      while (Date.now() - t0 < waitMs) {
        if (dead) throw new Error(dead);
        if (proc !== me) throw new Error("听写被关掉了");
        if (await portOpen(port)) { touch(); return port; }
        await new Promise((r) => setTimeout(r, 500));
      }
      stop(); throw new Error("听写启动超时：" + (tail.slice(-3).join(" ") || "没有输出"));
    })();
    try { return await starting; } catch (e) { stop(); throw e; } finally { starting = null; }
  }
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
  return { start, hear, stop, get running() { return !!proc && !starting; } };
}

module.exports = { create, SCRIPT };
