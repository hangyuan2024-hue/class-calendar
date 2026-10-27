// 网页版：不能运行本机程序。
// 7.5 例外：思维导图「文字 / 图片生成导图」的后台任务原来 fork 一个 Node 子进程跑 text-worker.cjs，
// 网页版在同一个 Service Worker 里跑同一份代码（打包时把它包成一个函数，见 runtime/build.js 生成的 workers-gen.js），
// 父子之间照样用 send / on("message") 传消息。PDF 讲义的后台任务要本机的原生绘图库，网页版不支持（lecture-tasks 会提示）。
"use strict";
function no() { throw new Error("网页版不能运行本机程序"); }
function emitter() {
  const on = {};
  return {
    on(ev, fn) { (on[ev] = on[ev] || []).push(fn); return this; },
    once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); },
    off(ev, fn) { on[ev] = (on[ev] || []).filter((f) => f !== fn); return this; },
    removeListener(ev, fn) { return this.off(ev, fn); },
    emit(ev, ...a) { for (const f of (on[ev] || []).slice()) { try { f(...a); } catch (e) { console.error("[learn-sw] 后台任务出错", e); } } return true; },
  };
}
function fork(modulePath) {
  const name = String(modulePath).split(/[\\/]/).pop();
  const make = (require("../workers-gen.js") || {})[name];
  const child = emitter(), proc = emitter();
  const later = (f) => setTimeout(f, 0);
  child.stdout = { resume() {}, on() { return this; } }; child.stderr = { resume() {}, on() { return this; } };
  child.connected = true; child.pid = 2;
  let exited = false;
  const exit = (code) => { if (exited) return; exited = true; child.connected = proc.connected = false; later(() => { proc.emit("disconnect"); child.emit("exit", code == null ? 0 : code, null); }); };
  if (!make) { later(() => { child.emit("error", new Error("网页版不支持这种后台任务：" + name)); exit(1); }); return child; }
  child.send = (msg) => { if (!child.connected) return false; const m = JSON.parse(JSON.stringify(msg)); later(() => proc.emit("message", m)); return true; };
  child.disconnect = () => { if (!child.connected) return; exit(0); };
  child.kill = () => { exit(null); return true; };
  // 子进程看到的 process
  proc.connected = true; proc.pid = 2; proc.ppid = 1; proc.env = {}; proc.versions = { node: "0.0.0-browser" };
  proc.send = (msg) => { if (!proc.connected) return false; const m = JSON.parse(JSON.stringify(msg)); later(() => child.emit("message", m)); return true; };
  proc.disconnect = () => exit(0);
  proc.exit = (code) => exit(code);
  proc.kill = (pid) => { if (pid === 1 || pid === 2) return true; const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; };
  later(() => { try { make(proc); } catch (e) { child.emit("error", e); exit(1); } });
  return child;
}
module.exports = { spawn: no, exec: no, execFile: no, execSync: no, spawnSync: no, fork };
