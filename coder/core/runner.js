// 捞捞编程 · 编译、运行。只用 Node 自带的模块，可以不开 Electron 单独测试（test/runner.test.js）。
//   run()     交互运行：输出一点一点推给界面，界面打的字送进程序（scanf / input()）
//   runOnce() 练习题检查：给定输入，跑完拿全部输出（有时间限制）
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { byId, locate, WIN } = require("./langs");
const { parseDiags } = require("./diag");

const MAX_OUT = 2 * 1024 * 1024;   // 输出超过 2MB 多半是死循环在打印：停掉

// C / C++ 程序的输出接到管道上时会攒一大块才一起输出，「请输入：」要等程序结束才看得到。
// 编译时多带上这个文件：程序一开始就把输出改成不攒，和在黑窗口里运行一样
const UNBUF = `/* 捞捞编程自动加上的：让 printf 马上显示（不影响你的程序） */
#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
__attribute__((constructor)) static void laolao_unbuffer(void) { setvbuf(stdout, NULL, _IONBF, 0); }
#ifdef __cplusplus
}
#endif
`;

function toolEnv(tool, extra) {
  const env = { ...process.env, ...extra };
  if (tool) {
    const bin = path.join(tool.root, "bin");
    const add = [bin, tool.root].filter((d) => fs.existsSync(d));
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
    env[key] = add.join(path.delimiter) + path.delimiter + (env[key] || "");
  }
  return env;
}

// 一门语言怎么编译、怎么运行：返回 { compile?: {cmd,args,env}, run: {cmd,args,env} }
function plan(langId, file, opt) {
  const L = byId[langId];
  if (!L) throw new Error("还不支持这种文件");
  const tool = locate(L, opt.toolDirs || {}, !!opt.allowSystem);
  if (!tool) { const e = new Error(`还没有装 ${L.name}`); e.needInstall = L.tool; e.lang = L.id; throw e; }
  const build = opt.buildDir;
  fs.mkdirSync(build, { recursive: true });
  const tag = crypto.createHash("md5").update(path.resolve(file)).digest("hex").slice(0, 10);
  const env = toolEnv(tool);
  if (L.compiled) {
    const unbuf = path.join(build, "laolao_unbuf.c");
    if (!fs.existsSync(unbuf) || fs.readFileSync(unbuf, "utf8") !== UNBUF) fs.writeFileSync(unbuf, UNBUF);
    const out = path.join(build, `prog-${tag}${WIN ? ".exe" : ""}`);
    const std = L.id === "c" ? ["-std=c17"] : ["-std=c++17"];
    // 编译器在 Windows 上遇到中文路径可能打不开文件：在文件所在的文件夹里编译、只传文件名；
    // 文件名本身有中文（成绩.c）就拷一份英文名的去编译，报错里的文件名再换回来（见 diagName）
    let src = path.basename(file), diagName = src;
    if (!/^[\x20-\x7e]+$/.test(src)) {
      src = path.join(build, `src-${tag}${path.extname(file).toLowerCase()}`);
      fs.copyFileSync(file, src);
      diagName = path.basename(src);
    }
    const args = [...std, "-g", "-O0", "-Wall", "-fdiagnostics-color=never", "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-I.",
      src, unbuf, "-o", out, ...(L.id === "c" ? ["-lm"] : []), ...(WIN ? ["-static"] : [])];
    // 编译器的提示一律用英文（中文 Windows 上可能变成乱码的本地化提示；报错解析和中文提示都按英文写的）
    return { lang: L, tool, compile: { cmd: tool.exe, args, env: { ...env, LANG: "C", LC_ALL: "C", LANGUAGE: "C" } }, run: { cmd: out, args: [], env }, out, diagName };
  }
  if (L.id === "python") return { lang: L, tool, run: { cmd: tool.exe, args: ["-u", "-X", "utf8", file], env: toolEnv(tool, { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" }) } };
  if (L.id === "java") return { lang: L, tool, run: { cmd: tool.exe, args: ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xshare:auto", file], env } };
  if (L.id === "javascript") return { lang: L, tool, run: { cmd: tool.exe, args: [file], env } };
  if (L.id === "go") {
    const gd = path.join(build, "go");
    return { lang: L, tool, run: { cmd: tool.exe, args: ["run", file], env: toolEnv(tool, { GOCACHE: path.join(gd, "cache"), GOPATH: path.join(gd, "path"), GOTOOLCHAIN: "local", GOPROXY: "https://goproxy.cn,direct", GOTELEMETRY: "off" }) } };
  }
  throw new Error("还不支持 " + L.name);
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed && child.signalCode) return;
  try {
    if (WIN) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch (e) { try { child.kill("SIGKILL"); } catch (e2) {} }
}

// 跑一个命令：onOut(stream, text)；返回 { child, done: Promise<{code, signal, ms, killedFor}> }
function exec(step, cwd, onOut, { timeoutMs } = {}) {
  const t0 = Date.now();
  const child = spawn(step.cmd, step.args, { cwd, env: step.env, windowsHide: true, detached: !WIN, stdio: ["pipe", "pipe", "pipe"] });
  let total = 0, killedFor = "";
  const dec = { stdout: new TextDecoder("utf-8"), stderr: new TextDecoder("utf-8") };
  const feed = (name) => (buf) => {
    total += buf.length;
    if (total > MAX_OUT) { if (!killedFor) { killedFor = "output"; killTree(child); } return; }
    const s = dec[name].decode(buf, { stream: true });
    if (s) onOut(name, s);
  };
  child.stdout.on("data", feed("stdout"));
  child.stderr.on("data", feed("stderr"));
  child.stdin.on("error", () => {});
  const timer = timeoutMs ? setTimeout(() => { killedFor = "timeout"; killTree(child); }, timeoutMs) : null;
  const done = new Promise((resolve) => {
    let settled = false;
    const fin = (code, signal) => { if (settled) return; settled = true; clearTimeout(timer); for (const n of ["stdout", "stderr"]) { const s = dec[n].decode(); if (s) onOut(n, s); } resolve({ code, signal, ms: Date.now() - t0, killedFor }); };
    child.on("error", (e) => { onOut("stderr", (e.code === "ENOENT" ? "找不到程序：" + step.cmd : e.message) + "\n"); fin(-1, null); });
    child.on("close", fin);
  });
  return { child, done };
}

// ---------- 交互运行 ----------
class Session {
  constructor() { this.child = null; this.stopped = false; this.phase = ""; }
  // file：要运行的文件；ev：{ phase(name), out(stream, text), diags(list), exit(info) }
  async start(langId, file, opt, ev) {
    this.stopped = false;
    let p;
    try { p = plan(langId, file, opt); }
    catch (e) { ev.exit({ code: -1, error: e.message, needInstall: e.needInstall || null, lang: e.lang || langId }); return; }
    const cwd = path.dirname(file);
    if (p.compile) {
      this.phase = "compile"; ev.phase("compile");
      let errText = "";
      const swap = p.diagName && p.diagName !== path.basename(file) ? (t) => t.split(p.diagName).join(path.basename(file)) : (t) => t;
      const c = exec(p.compile, cwd, (s, t) => { errText += t; ev.out("compile", swap(t)); });
      this.child = c.child;
      const r = await c.done;
      const diags = parseDiags(p.lang.id, errText, file, p.diagName);
      ev.diags(diags);
      if (this.stopped) return ev.exit({ code: null, stopped: true });
      if (r.code !== 0) return ev.exit({ code: r.code, compileFailed: true, ms: r.ms });
    }
    this.phase = "run"; ev.phase("run");
    let errText = "";
    const x = exec(p.run, cwd, (s, t) => { if (s === "stderr") errText += t; ev.out(s, t); });
    this.child = x.child;
    const r = await x.done;
    this.child = null; this.phase = "";
    if (!p.compile || errText) { const d = parseDiags(p.lang.id, errText, file); if (d.length) ev.diags(d); }
    ev.exit({ code: r.code, signal: r.signal, ms: r.ms, stopped: this.stopped, tooMuch: r.killedFor === "output" });
  }
  // 只在程序真的跑起来以后才收输入（编译时打的字不能送给编译器）
  input(text) { if (this.phase === "run" && this.child && this.child.stdin && !this.child.stdin.destroyed) { this.child.stdin.write(text); return true; } return false; }
  endInput() { if (this.phase === "run" && this.child && this.child.stdin) try { this.child.stdin.end(); } catch (e) {} }
  stop() { this.stopped = true; killTree(this.child); }
  get running() { return !!this.child; }
}

// ---------- 练习题：一次跑完 ----------
async function runOnce(langId, file, opt, input, { timeoutMs = 6000 } = {}) {
  const p = plan(langId, file, opt);
  const cwd = path.dirname(file);
  if (p.compile) {
    let err = "";
    const r = await exec(p.compile, cwd, (s, t) => (err += t), { timeoutMs: 60000 }).done;
    if (r.code !== 0) return { compileFailed: true, stderr: p.diagName && p.diagName !== path.basename(file) ? err.split(p.diagName).join(path.basename(file)) : err, diags: parseDiags(p.lang.id, err, file, p.diagName) };
  }
  let out = "", err = "";
  const x = exec(p.run, cwd, (s, t) => (s === "stdout" ? (out += t) : (err += t)), { timeoutMs });
  try { x.child.stdin.end(input || ""); } catch (e) {}
  const r = await x.done;
  return { code: r.code, stdout: out, stderr: err, timedOut: r.killedFor === "timeout", tooMuch: r.killedFor === "output", ms: r.ms, diags: err ? parseDiags(p.lang.id, err, file) : [] };
}

module.exports = { plan, Session, runOnce, killTree, UNBUF };
