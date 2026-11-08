// 捞捞编程 · 画出来：把程序「一行一行」走一遍，记下每一步所有变量的样子 → 界面画成动画
//   C / C++：gcc -g 编译，gdb 里跑 tracer/gdb_trace.py（gdb 自带 Python）一步步走，读变量（数组、结构体、指针、链表、STL）
//   Python：tracer/py_trace.py 用 sys.settrace 一行行记
// 结果：{ lang, steps: [{ l: 行号, f: [调用栈，最里面的在前 { fn, l, v: [[名字, 值]] }], g: 全局变量, o: 这一步新打印的 }], output, exit, error, trunc }
// 值：{ k: "n" 数 | "c" 字符 | "b" 真假 | "s" 字符串 | "a" 数组 | "o" 结构体 / 对象 | "m" 字典 | "p" 指针（d: 指向的东西）| "z" 空 | "x" 其它 }
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { plan, killTree } = require("./runner");
const { byId, locate, which, WIN, exe } = require("./langs");
const { parseDiags } = require("./diag");

const SCRIPTS = { gdb: path.join(__dirname, "tracer", "gdb_trace.py"), py: path.join(__dirname, "tracer", "py_trace.py") };

// 找 gdb：和 gcc 放在一起的（安装包自带的 MinGW 里有），开发时用电脑上的
function findGdb(tool, allowSystem) {
  const cands = [path.join(tool.root, "bin", exe("gdb")), path.join(path.dirname(tool.exe), exe("gdb"))];
  for (const f of cands) if (fs.existsSync(f)) return f;
  return allowSystem ? which("gdb") : null;
}

function readJsonl(file) {
  let txt = "";
  try { txt = fs.readFileSync(file, "utf8"); } catch (e) { return []; }
  const out = [];
  for (const ln of txt.split("\n")) { if (!ln.trim()) continue; try { out.push(JSON.parse(ln)); } catch (e) { /* 被强行停掉时最后一行可能不完整 */ } }
  return out;
}

function collect(rows, extra) {
  const steps = [], res = { steps, output: "", exit: null, error: null, trunc: false, ...extra };
  let out = "";
  for (const r of rows) {
    if (r.fatal) res.error = { msg: "调试器没跑起来：" + r.fatal };
    if (r.l != null) { if (r.o) out += r.o; steps.push(r); }
    if (r.end) {
      if (r.o) { out += r.o; if (steps.length) steps[steps.length - 1].o = (steps[steps.length - 1].o || "") + r.o; }
      res.exit = r.exit; res.trunc = !!r.trunc;
      if (r.signal) res.error = { msg: SIG[r.signal] || "程序出错停下了（" + r.signal + "）", signal: r.signal, line: steps.length ? steps[steps.length - 1].l : null };
      if (r.err) res.error = { msg: `${r.err.type}: ${r.err.msg}`, line: r.err.line };
      if (r.syntax) res.syntaxError = r.syntax;
    }
  }
  res.output = out;
  if (!rows.some((r) => r.end) && steps.length) res.trunc = true;
  return res;
}

const SIG = {
  SIGSEGV: "程序访问了不该访问的内存（数组越界、空指针、野指针）",
  SIGFPE: "算术错误（多半是除以 0）",
  SIGABRT: "程序自己中止了（assert 没通过，或者内存被写坏了）",
  SIGILL: "程序执行了非法指令",
};

/**
 * opt：{ toolDirs, allowSystem, buildDir, maxSteps, secs, channel }
 * 返回的 kill() 可以中途停掉（编辑器里接着打字时，上一次的追踪就不要了）
 */
function trace(langId, file, stdin, opt) {
  const ctl = { child: null, killed: false };
  const p = run(langId, file, stdin || "", opt, ctl);
  return { done: p, kill() { ctl.killed = true; killTree(ctl.child); } };
}

function spawnP(cmd, args, o, ctl, timeoutMs, input) {
  return new Promise((resolve) => {
    let err = "", out = "", done = false;
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, windowsHide: true, detached: !WIN, stdio: ["pipe", "pipe", "pipe"] });
    ctl.child = child;
    const t = setTimeout(() => { killTree(child); }, timeoutMs);
    child.stdout.on("data", (b) => { if (out.length < 200000) out += b; });
    child.stderr.on("data", (b) => { if (err.length < 200000) err += b; });
    child.stdin.on("error", () => {});
    if (input != null) child.stdin.end(input); else child.stdin.end();
    const fin = (code) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out, err }); };
    child.on("error", (e) => { err += e.message; fin(-1); });
    child.on("close", fin);
  });
}

async function run(langId, file, stdin, opt, ctl) {
  const L = byId[langId];
  const maxSteps = opt.maxSteps || 1500, secs = opt.secs || 12;
  const dir = path.join(opt.buildDir, "trace-" + (opt.channel || "main"));
  fs.mkdirSync(dir, { recursive: true });
  const resFile = path.join(dir, "ll-res.jsonl");
  try { fs.unlinkSync(resFile); } catch (e) {}

  if (langId === "python") {
    const tool = locate(L, opt.toolDirs || {}, !!opt.allowSystem);
    if (!tool) return { lang: langId, needInstall: L.tool, error: { msg: "还没有装 Python" } };
    const sc = path.join(dir, "py_trace.py");
    fs.writeFileSync(sc, fs.readFileSync(SCRIPTS.py));
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" };
    const r = await spawnP(tool.exe, ["-X", "utf8", sc, file, resFile, String(maxSteps), String(secs), opt.incDir || ""], { cwd: path.dirname(file), env }, ctl, (secs + 6) * 1000, stdin);
    if (ctl.killed) return { lang: langId, cancelled: true };
    const res = collect(readJsonl(resFile), { lang: langId });
    if (res.syntaxError) { const d = parseDiags("python", `  File "${file}", line ${res.syntaxError.line}\nSyntaxError: ${res.syntaxError.msg}\n`, file); return { lang: langId, compileFailed: true, diags: d, stderr: `第 ${res.syntaxError.line} 行：SyntaxError: ${res.syntaxError.msg}` }; }
    if (!res.steps.length && r.err) res.error = res.error || { msg: r.err.slice(-600) };
    return res;
  }

  if (langId !== "c" && langId !== "cpp") return { lang: langId, unsupported: true };
  // 1) 编译（-g -O0，和平常运行一样的参数）
  let pl;
  try { pl = plan(langId, file, { ...opt, buildDir: dir }); } catch (e) { return { lang: langId, error: { msg: e.message }, needInstall: e.needInstall || null }; }
  const gdb = findGdb(pl.tool, !!opt.allowSystem);
  const c = await spawnP(pl.compile.cmd, pl.compile.args, { cwd: path.dirname(file), env: pl.compile.env }, ctl, 60000);
  if (ctl.killed) return { lang: langId, cancelled: true };
  if (c.code !== 0) {
    const swap = (t) => (pl.diagName && pl.diagName !== path.basename(file) ? t.split(pl.diagName).join(path.basename(file)) : t);
    return { lang: langId, compileFailed: true, diags: parseDiags(langId, c.err, file, pl.diagName), stderr: swap(c.err.split("\n").filter((x) => !/^fix-it:/.test(x)).join("\n")) };
  }
  if (!gdb) return { lang: langId, noTracer: true };
  // 2) gdb 里一步步走。全用相对路径（工作目录 = dir）：用户名是中文时 gdb 也不会找不到文件
  fs.writeFileSync(path.join(dir, "ll-in.txt"), stdin);
  try { fs.unlinkSync(path.join(dir, "ll-out.txt")); } catch (e) {}
  fs.writeFileSync(path.join(dir, "gdb_trace.py"), fs.readFileSync(SCRIPTS.gdb));
  const srcNames = [path.basename(file), pl.diagName].filter(Boolean).join("|");
  // C++ 标准库的美化打印脚本（MinGW 的 share/gcc-版本/python）：Windows 上要手动加载
  let printers = "";
  if (WIN && langId === "cpp") { try { const sh = path.join(pl.tool.root, "share"); const g = fs.readdirSync(sh).find((d) => /^gcc-\d/.test(d) && fs.existsSync(path.join(sh, d, "python", "libstdcxx"))); if (g) printers = path.join(sh, g, "python"); } catch (e) {} }
  const env = { ...pl.run.env, LL_PRINTERS: printers, LL_SRC: srcNames, LL_MAX: String(maxSteps), LL_SECS: String(secs), LL_PROG: path.basename(pl.out), LL_RES: "ll-res.jsonl", PYTHONIOENCODING: "utf-8" };
  const r = await spawnP(gdb, ["-q", "-nx", "-batch", "-x", "gdb_trace.py"], { cwd: dir, env }, ctl, (secs + 8) * 1000);
  if (ctl.killed) return { lang: langId, cancelled: true };
  const rows = readJsonl(resFile);
  if (!rows.length) {
    // gdb 没有 Python（或者跑不起来）：告诉界面换成老办法（自动加 SHOW）
    return { lang: langId, noTracer: true, why: (r.err || r.out || "").split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300) };
  }
  return collect(rows, { lang: langId });
}

module.exports = { trace, findGdb, collect, SIG };
