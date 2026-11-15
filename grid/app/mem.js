// 捞捞算力 · 内存和显存：24 小时开着也不越用越满
//   1. 任务开始前：这个配方用不上的引擎（画图引擎 ComfyUI、本地大模型）先关掉，把显存和内存让出来
//   2. 画图引擎连续开了好几个小时：在两个任务之间重启一次（ComfyUI 开久了会越占越多）
//   3. 可用内存太少：两个任务之间把能关的都关掉，再收一遍后台残留
//   4. 后台残留：数据文件夹里的程序（Python、llama-server……）既不是捞捞正在用的、它的上级也已经没了
//      （任务出错、客户端被关掉时留下的）→ 收掉。用户自己从别处打开的（上级还活着）不碰
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const norm = (p) => { const x = path.resolve(String(p || "")).replace(/[\\/]+$/, ""); return process.platform === "win32" ? x.toLowerCase() : x; };

// 列出所有程序：[{ pid, ppid, exe }]
function listProcs() {
  if (process.platform === "win32") {
    return new Promise((done) => {
      const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,Name,WorkingSetSize | ConvertTo-Json -Compress";
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 60000, maxBuffer: 64 << 20 }, (err, out) => {
        try { done([].concat(JSON.parse(out || "[]")).filter(Boolean).map((x) => ({ pid: x.ProcessId, ppid: x.ParentProcessId, exe: x.ExecutablePath || "", name: x.Name || "", mem: x.WorkingSetSize || 0 }))); } catch (e) { done([]); }
      });
    });
  }
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync("/proc"); } catch (e) { return Promise.resolve(out); }
  for (const d of ents) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = +st.slice(st.lastIndexOf(")") + 2).split(" ")[1];
      let exe = "";
      try { exe = fs.readlinkSync(`/proc/${d}/exe`); } catch (e) {}
      // 命令行里的脚本路径也算（python 自己可能不在数据文件夹里，脚本在）
      let cmd = "";
      try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean).slice(0, 3).join(" "); } catch (e) {}
      out.push({ pid: +d, ppid, exe, cmd, name: path.basename(exe), mem: 0 });
    } catch (e) {}
  }
  return Promise.resolve(out);
}

// 挑出后台残留（纯计算，方便测试）：
//   在数据文件夹里的程序，不是 root（捞捞自己）的子孙；而且它的上级已经没了，或者上级也是这样的残留
function pickOrphans(procs, { root, base, skip = [] }) {
  const B = norm(base) + path.sep;
  const SK = skip.map((x) => norm(x) + path.sep);
  const under = (x) => !!x && (norm(x) + path.sep).startsWith(B) && !SK.some((k) => (norm(x) + path.sep).startsWith(k));
  const inBase = (p) => under(p.exe) || String(p.cmd || "").split(/\s+/).some(under);
  const byParent = new Map();
  for (const p of procs) { if (!byParent.has(p.ppid)) byParent.set(p.ppid, []); byParent.get(p.ppid).push(p); }
  const ours = new Set([root]);
  const q = [root];
  while (q.length) { const x = q.shift(); for (const c of byParent.get(x) || []) if (!ours.has(c.pid)) { ours.add(c.pid); q.push(c.pid); } }
  const alive = new Set(procs.map((p) => p.pid));
  const cand = procs.filter((p) => !ours.has(p.pid) && inBase(p));
  const candSet = new Set(cand.map((p) => p.pid));
  // 上级没了：Windows 上上级进程号还记着、但已经不在了；Linux 上会被过继给 1 号进程
  const orphan = new Set(cand.filter((p) => !alive.has(p.ppid) || p.ppid === 0 || (process.platform !== "win32" && p.ppid === 1)).map((p) => p.pid));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of cand) if (!orphan.has(p.pid) && candSet.has(p.ppid) && orphan.has(p.ppid)) { orphan.add(p.pid); changed = true; }
  }
  return cand.filter((p) => orphan.has(p.pid));
}

function kill(pid) {
  if (process.platform === "win32") return new Promise((done) => execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 20000 }, () => done()));
  try { process.kill(pid, "SIGKILL"); } catch (e) {}
  return Promise.resolve();
}

function memNow() { return { free: os.freemem(), total: os.totalmem() }; }

// o: { base(), ai: { stop, status, runningSince }, llm: { stop, running }, set(): 设置, log(msg), busy(): 主任务现在要用哪些引擎 }
function create(o) {
  const log = o.log || (() => {});
  const S = () => ({ memAuto: true, aiRecycleH: 6, memLowPct: 12, sweep: true, ...(o.set ? o.set() : {}) });
  const aiOn = () => { try { return !!(o.ai && o.ai.status && o.ai.status().running); } catch (e) { return false; } };
  const llmOn = () => { try { return !!(o.llm && o.llm.running && o.llm.running()); } catch (e) { return false; } };
  let lastSweep = null;

  async function sweep(why) {
    const procs = await (o.listProcs || listProcs)();
    // 新版本安装包（update 文件夹）不碰：更新时旧客户端退出了，安装程序还在跑
    const bad = pickOrphans(procs, { root: o.root || process.pid, base: o.base(), skip: [path.join(o.base(), "update")] });
    for (const p of bad) await (o.kill || kill)(p.pid);
    const mb = bad.reduce((a, p) => a + (p.mem || 0), 0) / 1048576;
    lastSweep = { at: Date.now(), n: bad.length, names: bad.map((p) => p.name || path.basename(p.exe || "")).slice(0, 8) };
    if (bad.length) log(`${why || "清理"}：收掉了 ${bad.length} 个留在后台的程序（${lastSweep.names.join("、")}${mb ? `，约 ${Math.round(mb)}M 内存` : ""}）`);
    return bad.length;
  }

  // 主任务开始前（lane 是多显卡的其它显卡：不动共用的引擎）
  async function beforeTask({ needs = [], lane } = {}) {
    if (lane != null || !S().memAuto) return;
    const need = new Set(needs);
    if (!need.has("comfy") && aiOn()) { log("这个任务用不上画图引擎：先关掉，让出显存和内存"); await o.ai.stop(); }
    if (!need.has("llm") && llmOn()) { log("这个任务用不上本地大模型：先关掉，让出显存和内存"); o.llm.stop(); }
    const since = o.ai && o.ai.runningSince ? o.ai.runningSince() : 0;
    const rh = S().aiRecycleH;
    if (need.has("comfy") && aiOn() && rh > 0 && since && Date.now() - since > rh * 3600e3) { log(`画图引擎已经连续开了 ${((Date.now() - since) / 3600e3).toFixed(1)} 小时：重启一次（开久了会越占越多内存）`); await o.ai.stop(); }
    const m = (o.memNow || memNow)();
    if (S().memLowPct > 0 && m.free / m.total < S().memLowPct / 100) {
      log(`可用内存只剩 ${(m.free / 1e9).toFixed(1)}/${(m.total / 1e9).toFixed(0)}G：先释放一下`);
      if (S().sweep) await sweep("内存紧张");
    }
  }

  // 点「现在释放」：没在用的引擎关掉 + 收后台残留
  async function freeNow() {
    const before = (o.memNow || memNow)().free;
    const busy = new Set(o.busy ? o.busy() : []);
    let stopped = [];
    if (aiOn() && !busy.has("comfy")) { await o.ai.stop(); stopped.push("画图引擎"); }
    if (llmOn() && !busy.has("llm")) { o.llm.stop(); stopped.push("本地大模型"); }
    const n = await sweep("手动释放");
    await new Promise((r) => setTimeout(r, o.settleMs != null ? o.settleMs : 3000));
    const after = (o.memNow || memNow)().free;
    return { stopped, swept: n, freed: Math.max(0, after - before), free: after, total: (o.memNow || memNow)().total };
  }

  function status() {
    const m = (o.memNow || memNow)();
    const since = o.ai && o.ai.runningSince ? o.ai.runningSince() : 0;
    return { free: m.free, total: m.total, ai: aiOn(), aiSince: aiOn() ? since : 0, llm: llmOn(), lastSweep };
  }

  // 定时：每 30 分钟收一遍后台残留；开机 1 分钟后先收一遍（上次客户端被关掉时留下的）
  let t1 = null, t2 = null;
  function start() {
    t1 = setTimeout(() => { if (S().sweep) sweep("开机检查").catch(() => {}); }, o.firstMs != null ? o.firstMs : 60e3);
    t2 = setInterval(() => { if (S().sweep) sweep("定时检查").catch(() => {}); }, o.everyMs || 30 * 60e3);
    t1.unref && t1.unref(); t2.unref && t2.unref();
  }
  function stop() { clearTimeout(t1); clearInterval(t2); }
  return { beforeTask, freeNow, sweep, status, start, stop };
}

module.exports = { create, pickOrphans, listProcs };
