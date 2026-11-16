// 捞捞算力 · 客户端核心：报平安、按设置挂机、领活、跑配方（Python）、实时把代码行 / 日志 / 曲线 / 图片报给界面、
// 存档上传、做完交结果；电脑要用了、被管理员暂停了、任务转给别人了，就停下。客户端（Electron）和命令行版都用它。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { EventEmitter } = require("events");
const probe = require("./probe");

const PY_DIR = path.join(__dirname, "..", "py").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");  // 打包后 Python 读不了 asar 里的文件

// 邀请链接 LG1.xxxx → { u: 调度中心地址, c: 邀请码, k: 管理员公钥 }
function parseInvite(s) {
  s = String(s || "").trim();
  const m = /LG1\.([A-Za-z0-9_\-]+)/.exec(s);
  if (!m) throw new Error("邀请链接不对：应该是 LG1. 开头的一串字");
  const o = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  if (!o.u || !o.c) throw new Error("邀请链接不完整");
  return { server: o.u.replace(/\/+$/, ""), code: o.c, pubkey: o.k || "" };
}

function verifySig(pub, msg, sig) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64url")]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(msg, "utf8"), key, Buffer.from(String(sig || ""), "base64url"));
  } catch (e) { return false; }
}

// 上传 / 下载（带 Content-Length，COS 的预签名 PUT 要它）
// 同一个文件同时只下一次（比如刚重启时旧的下载还没停）：后来的等前面那个
const inflight = new Map();
// 网速上限（所有上传下载一起算，字节/秒；0 = 不限）：每秒一个额度，用完了暂停到下一秒
const net = { bps: 0, winStart: 0, used: 0 };
function setNetLimit(mbps) { net.bps = Math.max(0, +mbps || 0) * 1048576; }
function throttle(stream, n) {
  if (!net.bps) return;
  const now = Date.now();
  if (now - net.winStart >= 1000) { net.winStart = now; net.used = 0; }
  net.used += n;
  if (net.used > net.bps) { stream.pause(); setTimeout(() => stream.resume(), Math.max(50, 1000 - (Date.now() - net.winStart))); }
}
// 按顺序试几个地址：字符串就直接下；{ parts: [...] }（GitHub 上切块的）每块下好再接起来
async function xferAny(srcs, file, o = {}) {
  let err = null;
  for (const s of (srcs || []).filter(Boolean)) {
    try {
      if (typeof s === "string") { await xfer("GET", s, file, o); return file; }
      if (!s.parts || !s.parts.length) continue;
      const dir = file + ".parts"; fs.mkdirSync(dir, { recursive: true });
      let before = 0;
      for (let i = 0; i < s.parts.length; i++) {
        const pf = path.join(dir, String(i + 1).padStart(3, "0"));
        await xfer("GET", s.parts[i], pf, { ...o, onProgress: (a, b) => o.onProgress && o.onProgress(before + a, 0) });
        before += fs.statSync(pf).size;
      }
      fs.rmSync(file + ".part", { force: true });
      for (let i = 0; i < s.parts.length; i++) fs.appendFileSync(file + ".part", fs.readFileSync(path.join(dir, String(i + 1).padStart(3, "0"))));
      fs.renameSync(file + ".part", file); fs.rmSync(dir, { recursive: true, force: true });
      return file;
    } catch (e) { err = e; }
  }
  throw err || new Error("没有能下载的地址");
}
// 传文件断了（socket hang up、连接被重置、超时、存储临时 5xx）：等一会儿再试，下载从断的地方接着下；试 6 次还不行才算失败。
// 以前断一次整个任务就算出错、从头再来（训练了几个小时的也一样）
async function xferRetry(method, url, file, o = {}) {
  let err = null;
  const tries = o.tries || 6;
  for (let i = 0; i < tries; i++) {
    try { return await xfer1(method, url, file, o); } catch (e) {
      err = e;
      if (o.signal && o.signal.aborted) throw e;
      // 只重试「连上了又断了 / 卡住了」这种临时的；地址不通（连接被拒绝、域名不对）、存储报错交给下一个下载地址
      if (!/^(ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|EAI_AGAIN|UND_ERR_SOCKET)$/.test(netCode(e)) && !/socket hang up|aborted/i.test(e.message || "")) throw e;
      if (i < tries - 1) await sleep(o.retryMs != null ? o.retryMs : Math.min(30000, 2000 * 2 ** i));
    }
  }
  const n = new Error(`${method === "PUT" ? "上传" : "下载"}断了 ${tries} 次：${netWhy(err)}`); n.net = isNet(err); n.cause = err; throw n;
}
function xfer(method, url, file, o = {}) {
  if (method !== "GET") return xferRetry(method, url, file, o);
  const k = path.resolve(file);
  if (inflight.has(k)) return inflight.get(k);
  const p = xferRetry(method, url, file, o).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}
function xfer1(method, url, file, { onProgress, signal } = {}) {
  return new Promise((ok, bad) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    if (method === "PUT") {
      const size = fs.statSync(file).size;
      const req = mod.request(u, { method: "PUT", headers: { "content-length": size } }, (res) => {
        let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => (res.statusCode < 300 ? ok({ size }) : bad(new Error(`上传失败 ${res.statusCode} ${b.slice(0, 200)}`))));
      });
      req.on("error", bad);
      req.setTimeout(120000, () => req.destroy(Object.assign(new Error("上传卡住了（2 分钟没动静）"), { code: "ETIMEDOUT" })));
      if (signal) signal.addEventListener("abort", () => req.destroy(new Error("停了")));
      let sent = 0;
      const rs = fs.createReadStream(file);
      rs.on("data", (c) => { sent += c.length; throttle(rs, c.length); onProgress && onProgress(sent, size); });
      rs.pipe(req);
      return;
    }
    // 下载：断了接着下
    const tmp = file + ".part";
    let have = 0; try { have = fs.statSync(tmp).size; } catch (e) {}
    const req = mod.get(u, { headers: have ? { range: `bytes=${have}-` } : {} }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return xfer1("GET", new URL(res.headers.location, u).href, file, { onProgress, signal }).then(ok, bad); }
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return bad(new Error(`下载失败 ${res.statusCode}`)); }
      if (res.statusCode === 200) have = 0;
      const total = have + (+res.headers["content-length"] || 0);
      const ws = fs.createWriteStream(tmp, { flags: have ? "a" : "w" });
      let got = have;
      res.on("data", (c) => { got += c.length; throttle(res, c.length); onProgress && onProgress(got, total); });
      res.pipe(ws);
      // 改名失败（同一个文件另一处刚好也下完、已经改过名了）：文件在就算成功，不让整个程序崩掉
      ws.on("finish", () => { try { fs.renameSync(tmp, file); ok({ size: got }); } catch (e) { if (fs.existsSync(file)) ok({ size: fs.statSync(file).size }); else bad(e); } });
      ws.on("error", bad);
      res.on("error", (e) => { ws.destroy(); bad(e); });
      res.on("aborted", () => { ws.destroy(); bad(Object.assign(new Error("下载断了（socket hang up）"), { code: "ECONNRESET" })); });
    });
    req.on("error", bad);
    req.setTimeout(120000, () => req.destroy(Object.assign(new Error("下载卡住了（2 分钟没动静）"), { code: "ETIMEDOUT" })));
    if (signal) signal.addEventListener("abort", () => req.destroy(new Error("停了")));
  });
}

// ---- 网络问题：连不上 / 断了 / 超时（和调度中心明确拒绝分开：网络问题等连上了再交，不丢结果） ----
const NET_CODES = {
  ECONNREFUSED: "调度中心没开（连接被拒绝）", ENOTFOUND: "找不到调度中心的地址（域名解析失败）", EAI_AGAIN: "域名解析失败（这台电脑可能没网）",
  ETIMEDOUT: "连接超时", ECONNRESET: "连接被断开", EPIPE: "连接被断开", EHOSTUNREACH: "到不了调度中心的服务器", ENETUNREACH: "这台电脑没网",
  UND_ERR_CONNECT_TIMEOUT: "连接超时（端口没放行或服务器没开）", UND_ERR_SOCKET: "连接被断开", UND_ERR_HEADERS_TIMEOUT: "调度中心没回应",
  CERT_HAS_EXPIRED: "调度中心的 HTTPS 证书过期了", ERR_TLS_CERT_ALTNAME_INVALID: "HTTPS 证书和域名对不上",
  DEPTH_ZERO_SELF_SIGNED_CERT: "调度中心的 HTTPS 证书不受信任", SELF_SIGNED_CERT_IN_CHAIN: "调度中心的 HTTPS 证书不受信任", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "调度中心的 HTTPS 证书不受信任",
  ERR_SSL_WRONG_VERSION_NUMBER: "地址写成了 https，但服务器只有 http（或者被拦了）", EPROTO: "HTTPS 握手失败（证书没申请下来，或者被拦了）",
};
function netCode(e) {
  for (let x = e, i = 0; x && i < 6; i++) {
    if (x.code && NET_CODES[x.code]) return x.code;
    x = (x.errors && x.errors[0]) || x.cause;
  }
  for (let x = e, i = 0; x && i < 6; i++) { if (x.code) return x.code; x = (x.errors && x.errors[0]) || x.cause; }
  return "";
}
function netWhy(e) {
  if (e && (e.name === "TimeoutError" || /aborted due to timeout/i.test(e.message || ""))) return "调度中心 20 秒没回应";
  const code = netCode(e);
  return NET_CODES[code] ? `${NET_CODES[code]}（${code}）` : code ? `网络出错（${code}）` : String((e && e.message) || e);
}
function isNet(e) {
  if (!e || e.status) return false;
  if (e.net) return true;
  if (e.name === "TimeoutError") return true;
  const code = netCode(e);
  return !!(NET_CODES[code] || /^(E[A-Z]+|UND_ERR_\w+)$/.test(code) || /fetch failed|socket hang up|network|aborted due to timeout/i.test(e.message || ""));
}
// 换一套新的网络连接：Node 自带的 fetch 会复用老连接，电脑睡醒、换 Wi-Fi、校园网重新登录以后，老连接可能一直坏着，
// 表现就是一直「fetch failed」、重开软件才好。连续连不上时自动换一套（就是重开软件那一下），不用重开。
function resetConnections() {
  try {
    const sym = Symbol.for("undici.globalDispatcher.1");
    const old = globalThis[sym];
    if (!old || typeof old.constructor !== "function") return false;
    globalThis[sym] = new old.constructor();
    try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    return true;
  } catch (e) { return false; }
}
// 这台电脑能不能上网（连不上调度中心时用来说清楚是哪边的问题）
const NET_PROBES = ["https://laolao-1518432293.cos.ap-guangzhou.myqcloud.com/download/grid-version.json", "https://api.github.com/zen"];
async function canReachInternet(urls = NET_PROBES) {
  if (!urls.length) return null;
  try { await Promise.any(urls.map((u) => fetch(u, { signal: AbortSignal.timeout(6000) }).then((r) => { r.body && r.body.cancel && r.body.cancel().catch(() => {}); return true; }))); return true; } catch (e) { return false; }
}
function netErr(e) { const n = new Error(netWhy(e)); n.net = true; n.cause = e; return n; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 配方自己开的子程序（念句子的服务、识别、训练……）要跟着配方一起收掉：Windows 上只杀配方本身的话，
// 它开的子程序会留在后台，一直占着显存和内存（一个就是几百 M 到几 G），攒多了后面的任务就内存不够、显存不够。
//   配方还在跑（停任务）：taskkill /T 连子程序一起杀；
//   配方已经退出：Windows 会记着子程序的「父进程号」，找出在配方运行期间、由它开出来的子程序，连同它们的子程序一起杀
//   （按创建时间筛，进程号被别的程序重用了也不会误杀）。
function killTree(pid, since, until) {
  if (!pid) return Promise.resolve();
  if (process.platform !== "win32") {   // Linux / macOS：配方在自己的进程组里，整组杀掉
    try { process.kill(-pid, "SIGKILL"); } catch (e) {}
    return Promise.resolve();
  }
  const tk = (k) => new Promise((done) => execFile("taskkill", ["/F", "/T", "/PID", String(k)], { windowsHide: true, timeout: 20000 }, () => done()));
  if (!until) return tk(pid);
  return new Promise((done) => {
    const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{n='t';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 30000, maxBuffer: 32 << 20 }, async (err, out) => {
      let kids = [];
      try {
        kids = [].concat(JSON.parse(out || "[]")).filter((x) => x && x.ParentProcessId === pid && x.t && Date.parse(x.t) >= since - 3000 && Date.parse(x.t) <= until + 1000).map((x) => x.ProcessId);
      } catch (e) {}
      for (const k of kids) await tk(k);
      done(kids.length);
    });
  });
}

function create(opt) {
  const ev = new EventEmitter();
  const server = opt.server.replace(/\/+$/, "");
  const work = opt.workDir;
  fs.mkdirSync(path.join(work, "recipes"), { recursive: true });
  fs.mkdirSync(path.join(work, "tasks"), { recursive: true });
  // 下载缓存（任务要用的输入文件）：10 天没用到的清掉
  try { const d = path.join(work, "cache", "inputs"); for (const f of fs.readdirSync(d)) { const x = path.join(d, f); try { if (Date.now() - fs.statSync(x).mtimeMs > 10 * 86400e3) fs.rmSync(x, { force: true }); } catch (e) {} } } catch (e) {}
  const python = () => (typeof opt.python === "function" ? opt.python() : opt.python) || (process.platform === "win32" ? "python" : "python3");
  let policy = { mode: "always", idleMin: 5, from: "22:00", to: "08:00", maxTemp: 83, yieldGames: true, ...(opt.policy || {}) };
  let caps = opt.caps || null;
  let state = "starting";       // starting / waiting（按设置还不能算）/ idle（能算，没活）/ busy / paused（自己点了暂停）/ offline
  let why = "";
  let cur = null;               // 正在跑的任务
  let stopped = false, paused = false, draining = false;
  // 手动开关：auto 按挂机设置；on 手动开始（不管空闲 / 定时，一直算到点「停止」，但还是让着游戏、怕过热）；off 停止
  let manual = opt.manual || "auto";
  let lastHb = 0, lastLease = 0, lastTick = Date.now(), extraEnv = {};
  // 这台电脑自己的毛病（包装不上、引擎起不来、显存被占）：歇一会儿再领，别 2 秒一个把任务挨个领来弄失败
  let hold = { until: 0, why: "", n: 0 };
  const HOLD_MIN = opt.holdMin || [5, 15, 30, 60];
  function holdOff(why) {
    const m = HOLD_MIN[Math.min(hold.n, HOLD_MIN.length - 1)];
    hold = { until: Date.now() + m * 60e3, why, n: hold.n + 1 };
    log(`这台电脑现在算不了：${why}。${m} 分钟后自动再试（修好了点「开始」马上试）`, "error");
  }
  const CMD_NAMES = { start: "开始", stop: "停止", auto: "按设置自动", update: "立刻更新", restart: "重启软件", logs: "交日志", clean: "清理缓存", probe: "重新体检" };
  const logs = [];
  let gpuNow = null;
  const emit = (k, v) => { try { ev.emit(k, v); ev.emit("any", { k, v }); } catch (e) {} };
  const setState = (s, w = "") => { if (s !== state || w !== why) { state = s; why = w; emit("state", { state, why, running: !!cur }); } };
  const log = (msg, level = "info") => { const l = { t: Date.now(), msg: String(msg), level }; logs.push(l); if (logs.length > 500) logs.shift(); emit("log", l); };

  let netFails = 0, lastReset = 0, netNote = "", resets = 0;
  async function api(p, body, { method, timeout = 20000 } = {}) {
    let r;
    try { r = await (opt.fetch || fetch)(server + p, { method: method || (body ? "POST" : "GET"), headers: { authorization: "Bearer " + opt.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
    catch (e) {
      if (!isNet(e)) throw e;
      netFails++;
      if (netFails === 1) {   // 刚断：看看是这台电脑没网，还是只是连不上调度中心
        netNote = "";
        const probes = opt.netProbe || (opt.fetch ? [] : NET_PROBES);
        canReachInternet(probes).then((ok) => { if (netFails) netNote = ok === true ? "这台电脑能上网，是调度中心那边或去调度中心的路上有问题" : ok === false ? "这台电脑现在上不了网（看看 Wi-Fi、校园网是不是要重新登录）" : ""; }).catch(() => {});
      }
      if (netFails >= 3 && Date.now() - lastReset > 60000) {
        lastReset = Date.now();
        if (resetConnections()) { resets++; log("连续连不上调度中心：换了一套新的网络连接再试（相当于重开软件）", "warn"); }
      }
      throw netErr(e);
    }
    if (netFails) { if (netFails >= 3) log(`又连上调度中心了（断了 ${netFails} 次请求）`, "ok"); netFails = 0; netNote = ""; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "调度中心出错 " + r.status); e.status = r.status; throw e; }
    return j;
  }

  // 连不上调度中心时：东西先留在本机，等连上了再交（每次等 5 秒，越等越久，最多 1 分钟一次）。
  //   skip()：等的时候已经不需要了（比如有了更新的存档）就不交了
  async function whenOnline(c, what, fn, skip) {
    let wait = 5000, told = false;
    const t0 = Date.now();
    for (;;) {
      if (told && skip && skip()) return undefined;
      try {
        const r = await fn();
        if (told) log(`${what}：连上了，交上去了`, "ok");
        if (c && c.waitNet === what) c.waitNet = "";
        return r;
      } catch (e) {
        if (!isNet(e) || stopped || (c && c.stopping && !c.finishing && !opt.uploadWhileStopping) || Date.now() - t0 > (opt.offlineMaxMs || 48 * 3600e3)) throw e;
        if (!told) { log(`${what}：连不上调度中心（${e.message}），先存在本机，连上了自动交`, "warn"); told = true; }
        if (c) { c.waitNet = what; c.lastOut = Date.now(); }   // 在等网，不是卡住了
        await sleep(opt.retryMs ? opt.retryMs : wait); wait = Math.min(wait * 2, 60000);
      }
    }
  }

  // ---- 什么时候能算 ----
  const minutes = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  function inWindow(d = new Date()) {
    const a = minutes(policy.from), b = minutes(policy.to), x = d.getHours() * 60 + d.getMinutes();
    return a <= b ? x >= a && x < b : x >= a || x < b;
  }
  // 硬盘：数据文件夹所在的盘快满了，先不领新任务；只剩 3G 以下，手上的也停。
  //   系统盘（C 盘）：数据文件夹就在 C 盘上才按同一条线卡；已经换到别的盘了，捞捞不再往 C 盘写东西，
  //   C 盘剩得少也照常算（以前换到 E 盘了还提示「C 盘只剩 7.9G」不让算），只在快写满（2G 以下，Windows 自己会出问题）时停
  let diskAt = 0, diskNow = null;
  async function diskCheck() {
    if (!opt.minFreeGB) return null;
    if (Date.now() - diskAt < 60000) return diskNow;
    diskAt = Date.now();
    const win = process.platform === "win32";
    const sysDrive = (opt.sysDrive || process.env.SystemDrive || "C:");
    const sys = win || opt.sysDrive ? sysDrive + "\\" : "/";
    const onSys = win || opt.sysDrive ? (/^[A-Za-z]:/.test(work) ? work : path.resolve(work)).toUpperCase().startsWith(sysDrive.toUpperCase()) : true;
    const sysMin = onSys ? opt.minFreeGB : Math.min(opt.minFreeGB, opt.sysMinFreeGB != null ? opt.sysMinFreeGB : 2);
    const drives = [[opt.sysPath || sys, win || opt.sysDrive ? sysDrive.replace(":", "") + " 盘" : "系统盘", sysMin, !onSys], [work, "数据文件夹所在的盘", opt.minFreeGB, false]];
    diskNow = null;
    for (const [p, name, min, sysOnly] of drives) {
      try {
        const s = await (opt.statfs || fs.promises.statfs)(p);
        const gb = (s.bavail * s.bsize) / 1e9;
        if (gb < min && (!diskNow || gb < diskNow.gb)) diskNow = { gb, name, sysOnly };
      } catch (e) {}
    }
    return diskNow;
  }

  async function gate() {
    if (paused) return { ok: false, why: "你点了暂停" };
    const dk = await diskCheck();
    if (dk) return { ok: false, why: dk.sysOnly ? `${dk.name}快写满了（只剩 ${dk.gb.toFixed(1)}G）：捞捞的数据已经不在这个盘上，是别的东西占的。清一下${dk.name}（回收站、下载、微信文件），不然 Windows 自己会出问题` : `${dk.name}只剩 ${dk.gb.toFixed(1)}G：先不领新任务。打开「设置 → 硬盘」清理一下，或者把数据文件夹换到空间大的盘`, disk: true, diskCritical: dk.gb < 3 };
    if (draining) return { ok: false, why: "有新版本：手上的算完就自动更新" };
    if (manual === "off") return { ok: false, why: "你点了停止" };
    if (hold.until > Date.now()) return { ok: false, why: `这台电脑现在算不了：${hold.why}（${Math.ceil((hold.until - Date.now()) / 60e3)} 分钟后自动再试）`, hold: true };
    if (manual !== "on" && policy.mode === "off") return { ok: false, why: "想算的时候点「开始」" };
    if (manual !== "on" && policy.mode === "schedule" && !inWindow()) return { ok: false, why: `只在 ${policy.from}～${policy.to} 算` };
    if (manual !== "on" && policy.mode === "idle") {
      const idle = opt.idleSecs ? await opt.idleSecs() : 1e9;
      if (idle < (policy.idleMin || 5) * 60) return { ok: false, why: `你在用电脑，空闲 ${policy.idleMin} 分钟后开始`, active: true };
    }
    // 笔记本拔了电源：停（插上电接着算）；「开始」了也一样，不然电池几十分钟就没了
    if (policy.pauseOnBattery !== false && opt.onBattery && (await opt.onBattery())) return { ok: false, why: "拔了电源：插上电就接着算", battery: true };
    if (manual !== "on" && policy.mode === "schedule" && Array.isArray(policy.days) && policy.days.length && !policy.days.includes(new Date().getDay())) return { ok: false, why: "今天不在定时算的日子里" };
    if (gpuNow && gpuNow.temp != null && gpuNow.temp >= (policy.maxTemp || 83)) return { ok: false, why: `显卡 ${gpuNow.temp}℃，凉一凉再算` };
    if (policy.maxPower && gpuNow && gpuNow.power != null && gpuNow.power > policy.maxPower * 1.15) return { ok: false, why: `显卡功耗 ${Math.round(gpuNow.power)}W 超过上限 ${policy.maxPower}W，歇一会儿` };
    if (policy.yieldGames && opt.gpuApps) {
      const apps = await opt.gpuApps(cur && cur.child ? [cur.child.pid] : []);
      const big = apps.filter((a) => a.mem > 300 || /game|steam|\.exe$/i.test(a.name || "") && a.mem > 100);
      if (big.length) return { ok: false, why: `${path.basename(big[0].name || "别的程序")} 在用显卡，先让给它`, active: true };
    }
    return { ok: true };
  }

  // ---- 主循环 ----
  async function tick() {
    if (stopped) return;
    try {
      if (opt.gpuInfo) { const g = await opt.gpuInfo().catch(() => null); if (g) { gpuNow = g; emit("gpu", g); } }
      const g = await gate();
      if (Date.now() - lastHb > (opt.hbMs || 15000)) {
        lastHb = Date.now();
        const hb = await api("/api/hb", { state: cur ? "busy" : g.ok ? "idle" : "waiting", why: g.ok ? "" : g.why, info: { ...(caps || {}), gpuNow, version: opt.version || "", ...(opt.extraInfo ? opt.extraInfo() : {}) }, policy, live: cur ? liveOf() : null });
        // 控制中心远程遥控：开始 / 停止 / 更新 / 重启 / 取日志……交给软件去做，做完回个话
        for (const c of (hb && hb.cmds) || []) { log("控制中心让这台电脑：" + (CMD_NAMES[c.cmd] || c.cmd)); emit("command", c); }
        if (state === "offline") setState(cur ? "busy" : "idle");
      }
      lastTick = Date.now();
      if (cur) {
        if (cur.finishing) { /* 已经算完了，只等着交结果：不用停 */ }
        else if (!g.ok && (paused || manual === "off" || g.active || g.battery || g.diskCritical || /℃|功耗/.test(g.why))) { log("停下：" + g.why, "warn"); await stopTask(true, g.why); }
        // 卡住了：好久没有任何输出（日志、进度、曲线）→ 结束它，交给别的电脑从存档接着算
        else if (opt.stallMin !== 0 && cur.child && Date.now() - (cur.lastOut || cur.started) > (opt.stallMin || 45) * 60e3 && !cur.stopping) { log(`这个任务 ${opt.stallMin || 45} 分钟没有动静，像是卡住了：结束它，交给别的电脑接着算`, "error"); await stopTask(true, "卡住了（很久没有输出）"); }
      } else if (!g.ok) setState(paused || manual === "off" ? "paused" : "waiting", g.why);
      else if (Date.now() - lastLease > (opt.leaseEveryMs || 10000)) {
        lastLease = Date.now();
        const r = await api("/api/lease", { caps: caps || {} });
        if (r.task) runTask(r.task).catch((e) => log("任务出错：" + e.message, "error"));
        else setState("idle", "现在没有要算的");
      }
    } catch (e) {
      if (e.status === 401) { setState("offline", e.message); emit("kicked", e.message); }
      else { const w = (isNet(e) ? e.message : netWhy(e)) + (netNote ? "；" + netNote : ""); setState("offline", cur ? `连不上调度中心：${w}。手上的还在接着算，结果先存在本机，连上了自动交` : "连不上调度中心：" + w); }
    }
  }
  let timer = null;
  function start() { stopped = false; if (!timer) { timer = setInterval(tick, opt.tickMs || 2000); tick(); } return api; }
  async function stop() { stopped = true; clearInterval(timer); timer = null; if (cur) await stopTask(true, "客户端关闭"); }

  function liveOf() {
    if (!cur) return null;
    return { job: cur.job.name, jobId: cur.job.id, recipe: cur.recipe && cur.recipe.name, recipeId: cur.recipe && cur.recipe.id, line: cur.line, fn: cur.fn, progress: cur.progress, note: cur.note, logs: cur.logs.slice(-12), metric: cur.lastMetric, gpu: gpuNow, started: cur.started };
  }

  // ---- 跑一个任务 ----
  async function fetchRecipe(r) {
    const f = path.join(work, "recipes", r.id + ".py");
    if (!fs.existsSync(f)) await xfer("GET", r.url, f);
    const src = fs.readFileSync(f);
    const id = crypto.createHash("sha256").update(src).digest("hex");
    if (id !== r.id) { fs.rmSync(f, { force: true }); throw new Error("配方文件对不上（下载坏了），下次重新下"); }
    if (opt.pubkey && !verifySig(opt.pubkey, r.id, r.sig)) throw new Error("配方的签名不对：不是管理员发的，不跑");
    if (!opt.pubkey && !opt.allowUnsigned) throw new Error("没有管理员公钥，不能核对配方签名");
    return { file: f, source: src.toString("utf8") };
  }

  const ensured = new Set();   // 装过的包这次开机不再装
  async function runTask(L) {
    const dir = path.join(work, "tasks", String(L.task.id));
    fs.mkdirSync(dir, { recursive: true });
    const c = cur = { id: L.task.id, task: L.task, job: L.job, recipe: L.recipe, dir, started: Date.now(), progress: 0, logs: [], metrics: [], lastMetric: null, line: null, fn: null, note: "", uploads: Promise.resolve(), result: null, outputs: [], reviews: [], ckpts: 0, stopping: false };
    setState("busy", L.job.name);
    emit("task", { id: c.id, job: L.job, task: L.task, recipe: L.recipe && { id: L.recipe.id, name: L.recipe.name } });
    log(`领到任务：「${L.job.name}」`);
    // 一领到就开始续租：第一次装 GPT-SoVITS / AI 引擎、下大文件（讲课视频）都可能要几十分钟，不续租调度中心会以为掉线了、把任务给别人
    let renewTimer = setInterval(() => {
      renew(c).catch(() => {});
      // 本地大模型「10 分钟没人用就关」：任务一直在直接问它（不经过客户端），所以任务还在算就替它报个平安，别中途被关掉
      if (c.needsLlm && opt.llm && opt.llm.touch) { try { opt.llm.touch(); } catch (e) {} }
    }, opt.renewMs || 20000);
    c.lastOut = Date.now();
    try {
      const rc = await fetchRecipe(L.recipe);
      emit("source", { id: c.id, name: L.recipe.name, source: rc.source });
      // 配方开头写「# requires: diffusers==0.35.1 transformers」：先把要的包装好（装过的 pip 会跳过）
      const req = (/^#\s*requires:\s*(.+)$/m.exec(rc.source) || [])[1];
      if (req && opt.ensure && !ensured.has(req.trim())) { c.note = "装配方要的包…"; log("装配方要的包：" + req); await opt.ensure(req.trim().split(/\s+/)); ensured.add(req.trim()); }
      // 开始之前：这个配方用不上的 AI 引擎（上一个任务留下的画图引擎、本地大模型）关掉，内存不够了也先释放一下
      if (opt.beforeTask) {
        const needs = ((/^#\s*needs:(.*)$/m.exec(rc.source) || [])[1] || "").split(/[\s,，]+/).filter(Boolean);
        try { await opt.beforeTask({ needs, job: L.job, lane: opt.caps && opt.caps.lane }); } catch (e) { log("释放内存没成功：" + e.message, "warn"); }
      }
      // 配方开头写「# needs: comfy」：要用本机的 AI 引擎画图，先把它开起来
      if (/^#\s*needs:.*\bcomfy\b/m.test(rc.source)) {
        if (!opt.comfy) throw new Error("这台电脑还没装好 AI 引擎");
        c.note = "启动 AI 引擎（ComfyUI）…"; log("启动 AI 引擎（第一次要 1～3 分钟）");
        await opt.comfy.ensure();
      }
      // 配方开头写「# needs: llm」：要用本机的大模型（llama.cpp）。模型由任务参数 llm 指定，第一次先下载
      let llmUrl = null;
      if (/^#\s*needs:.*\bllm\b/m.test(rc.source)) {
        if (!opt.llm) throw new Error("这台电脑的客户端太旧，跑不了本地大模型");
        c.needsLlm = true;
        c.note = "准备本地大模型…";
        // lazy：配方自己决定什么时候开（比如先训练、训完再开大模型考试），这里不先开
        if (!((L.job.params || {}).llm || {}).lazy) llmUrl = await opt.llm.ensure((L.job.params || {}).llm || {}, (m) => { c.note = m; c.lastOut = Date.now(); log(m); emit("progress", { id: c.id, p: c.progress, note: m }); });
      }
      // 配方开头写「# needs: gsv」：要用 GPT-SoVITS 整合包（训练声音）；第一次自动装（几个 G）
      let gsv = null;
      if (/^#\s*needs:.*\bgsv\b/m.test(rc.source)) {
        if (!opt.gsv) throw new Error("这台电脑的客户端太旧，训练不了声音");
        c.note = "准备 GPT-SoVITS…";
        gsv = await opt.gsv.ensure((m) => { c.note = m; c.lastOut = Date.now(); log(m); emit("progress", { id: c.id, p: c.progress, note: m }); });
      }
      const t = { kind: L.task.kind, task: L.task, input: L.task.input, job: L.job, work: dir, cache: opt.cacheDir || path.join(work, "cache", "shared"), resume: null, parts: [], llm: llmUrl, gsv, extra: L.extra || {}, region: opt.region ? opt.region() : "cn" };
      // 下载的时候在界面上、日志里报进度（大存档、录音几百 M 到几 G，不报就像卡在 0% 不动了）
      const dlProg = (what) => {
        let lastEmit = 0, lastLog = 0, t0 = Date.now();
        return (got, total) => {
          c.lastOut = Date.now();
          if (Date.now() - lastEmit < 1000) return;
          lastEmit = Date.now();
          const mb = (x) => (x / 1048576).toFixed(0) + "M";
          const sp = got / Math.max(1, (Date.now() - t0) / 1000);
          c.note = total ? `${what}：${Math.round((got / total) * 100)}%（${mb(got)}/${mb(total)}，${mb(sp)}/秒）` : `${what}：${mb(got)}（${mb(sp)}/秒）`;
          emit("progress", { id: c.id, p: c.progress, note: c.note });
          if (Date.now() - lastLog > 60000) { lastLog = Date.now(); log(c.note); }
        };
      };
      if (L.resume) {
        const f = path.join(dir, "resume-" + path.basename(L.resume.key));
        log(`下载上次的存档（第 ${L.resume.step || 0} 步）…`);
        await xfer("GET", L.resume.url, f, { onProgress: dlProg("下载存档") });
        log(`存档下好了（${(fs.statSync(f).size / 1048576).toFixed(0)}M）`);
        t.resume = f; t.resumeInfo = { step: L.resume.step, round: L.resume.round };
      }
      for (const [i, u] of (L.task.input.partUrls || []).entries()) { const f = path.join(dir, `part-${i}.npz`); await xfer("GET", u, f); t.parts.push(f); }
      delete t.input.partUrls;
      // 前面步骤的结果文件、接着训练的起点：下载到本机
      t.files = {}; t.deps = L.deps || {};
      // 存储里的文件不会变（每个都是新名字）：按存储路径记在本机，同一个任务重来、下一轮再用到，不用重下
      const inCache = path.join(work, "cache", "inputs");
      fs.mkdirSync(inCache, { recursive: true });
      const nIn = Object.keys(L.fileUrls || {}).length;
      if (nIn > 3) log(`下载要用的文件：${nIn} 个…`);
      let iIn = 0;
      for (const [k, u] of Object.entries(L.fileUrls || {})) {
        iIn++;
        const f = path.join(dir, "in-" + k.replace(/[^\w.\-]/g, "_"));
        const key = (L.files || {})[k];
        const cf = key ? path.join(inCache, crypto.createHash("sha1").update(String(key)).digest("hex") + path.extname(String(key)).slice(0, 12)) : null;
        c.note = "下载 " + k + "…";
        try {
          if (cf && fs.existsSync(cf)) { try { const now = new Date(); fs.utimesSync(cf, now, now); } catch (e) {} }
          else await xfer("GET", u, cf || f, { onProgress: dlProg(nIn > 1 ? `下载要用的文件（${iIn}/${nIn}）${k}` : `下载 ${k}`) });
          if (cf) { fs.mkdirSync(path.dirname(f), { recursive: true }); try { fs.linkSync(cf, f); } catch (e) { fs.copyFileSync(cf, f); } }
        } catch (e) { throw new Error(`下载要用的文件「${k}」失败：${e.message}`); }
        t.files[k] = f;
      }
      // 训练要用的人工审核结果（params.dataset）
      if (L.job.params && L.job.params.dataset) { c.note = "取审核数据…"; const d = await api("/api/dataset", { task: c.id }); t.dataset = path.join(dir, "dataset.json"); fs.writeFileSync(t.dataset, JSON.stringify(d.items || [])); log(`审核数据：${(d.items || []).length} 条`); }
      fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(t));
      if (c.stopping) return;   // 准备的时候被叫停了（管理员暂停、你要用电脑）
      c.spawned = true;   // 到这里准备工作（下配方、装包、开引擎、下输入文件）都过了
      const code = await spawnPy(c, rc.file, path.join(dir, "task.json"));
      if (code === 0 && c.result) c.finishing = true;   // 算完了：接下来只是交结果，点「停止」、断网都不丢；续约也接着报，免得被收回
      else clearInterval(renewTimer);
      await c.uploads;
      if (c.stopping && !c.finishing) return;
      if (c.unfit && (code !== 0 || !c.result)) { await c.uploads.catch(() => {}); throw new Error(c.unfit); }
      if (code !== 0 || !c.result) throw new Error((c.logs.filter((l) => l.level === "error").slice(-6).map((l) => l.msg).join("\n")) || `配方退出码 ${code}`);
      // 结果里的文件：上传，换成存储地址
      const result = {};
      for (const [k, v] of Object.entries(c.result)) {
        if (!(v && v.$file)) { result[k] = v; continue; }
        result[k] = await whenOnline(c, "上传结果「" + k + "」", () => put(c, v.$file, k));
        // 发布给老师端要用：大小和 sha256
        result[k + "_size"] = fs.statSync(v.$file).size;
        result[k + "_sha256"] = await new Promise((ok, bad) => { const h = crypto.createHash("sha256"); fs.createReadStream(v.$file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });
      }
      const secs = (Date.now() - c.started) / 1000;
      const doneMetrics = c.metrics.splice(0);
      clearInterval(renewTimer); c.submitting = true;   // 要交结果了：不再续约（断网等太久被收回的，连回来交的时候调度中心会还给它）
      if (state === "offline") { c.note = "算完了，等连上调度中心交结果"; emit("progress", { id: c.id, p: c.progress, note: c.note }); }
      const r = await whenOnline(c, "交结果", () => api("/api/done", { task: c.id, result, outputs: c.outputs, reviews: c.reviews, secs, metrics: doneMetrics }));
      log(r.ok ? `做完了「${L.job.name}」，用了 ${Math.round(secs)} 秒` : r.why, r.ok ? "ok" : "warn");
      emit("done", { id: c.id, ok: r.ok, secs, result });
      hold.n = 0;
    } catch (e) {
      clearInterval(renewTimer);
      if (!c.stopping) {
        log("出错：" + e.message, "error");
        // 配方还没开始跑就出错（包装不上、引擎起不来、文件下不下来）：是这台电脑的问题，不是任务的问题
        //   → 任务还给调度中心（不算它失败），这台电脑歇一会儿再试
        const prep = !c.spawned || !!c.unfit;
        await api("/api/fail", { task: c.id, ...(prep ? { release: true, env: true } : {}), error: c.logs.slice(-20).map((l) => l.msg).join("\n") + "\n出错：" + e.message }).catch(() => {});
        emit("done", { id: c.id, ok: false, error: e.message });
        if (prep) holdOff(e.message.split("\n")[0].slice(0, 200));
      }
    } finally {
      clearInterval(renewTimer);
      if (cur === c) cur = null;
      if (!opt.keepTaskDirs) fs.rm(dir, { recursive: true, force: true }, () => {});
      lastLease = 0;
      setState(paused || manual === "off" ? "paused" : "idle");
    }
  }
  async function put(c, file, name) {
    const r = await api("/api/put", { job: c.job.id, task: c.id, name: path.basename(file), prefix: name });
    try { await xfer("PUT", r.url, file); } catch (e) { throw isNet(e) ? netErr(e) : e; }
    return r.key;
  }
  async function renew(c) {
    const ms = c.metrics.splice(0);
    const r = await api("/api/renew", { task: c.id, progress: c.progress, metrics: ms, live: liveOf() });
    // 只管这一个任务：交结果前后还在路上的续约回来说「任务已经结束」，不能把下一个任务停了
    if (r.cancel && !c.stopping && cur === c && !c.submitting) { log("停下：" + r.why, "warn"); await stopTask(false, r.why); }
  }
  // 停下当前任务；release=true 告诉调度中心「我要用电脑了，交给别人」
  async function stopTask(release, reason) {
    const c = cur;
    if (!c || c.stopping) return;
    // 已经算完了、只差交结果：不扔掉，交完就停（renew 说「已经给别人了」除外）
    if (c.finishing && release) { log("这个任务已经算完了，交完结果就停", "warn"); return; }
    c.stopping = true;
    // 先马上停掉配方本身（和以前一样快）；它开的子程序在配方退出时由 spawnPy 按「父进程号 + 时间」一起收掉
    if (c.child) { try { c.child.kill(); } catch (e) {} }
    if (opt.comfy) { try { await opt.comfy.abort(); if (release) opt.comfy.stop(); } catch (e) {} }   // 你要用电脑了：AI 引擎也关掉，让出显存
    if (opt.llm && release) { try { opt.llm.stop(); } catch (e) {} }
    await c.uploads.catch(() => {});
    // 不管是自己停的还是调度中心叫停的（活被暂停了、换成新的活了）：都告诉调度中心「这台电脑空出来了」，
    // 不然调度中心以为它还在算这个任务，不给它派新活（任务已经给了别人的，调度中心会忽略）
    await api("/api/fail", { task: c.id, release: true, error: reason || "停下了" }).catch(() => {});
    emit("done", { id: c.id, ok: false, stopped: true, why: reason });
  }

  function spawnPy(c, file, taskFile) {
    return new Promise((ok) => {
      // 模型缓存、临时文件都放到数据文件夹里（不放 C 盘）：识别模型、Hugging Face / 魔搭下的模型一个就是几 G，C 盘满了连虚拟内存都涨不了
      const cacheDir = path.join(work, "cache");
      const cacheEnv = {};
      for (const [k, sub] of [["HF_HOME", "hf"], ["MODELSCOPE_CACHE", "modelscope"], ["TORCH_HOME", "torch"], ["XDG_CACHE_HOME", "xdg"], ["PIP_CACHE_DIR", "pip"], ["TEMP", "tmp"], ["TMP", "tmp"]]) {
        if (opt.keepCacheEnv && process.env[k]) continue;
        cacheEnv[k] = path.join(cacheDir, sub);
        try { fs.mkdirSync(cacheEnv[k], { recursive: true }); } catch (e) {}
      }
      const env = { ...process.env, ...cacheEnv, ...(opt.env || {}), ...extraEnv, PYTHONPATH: PY_DIR + path.delimiter + (process.env.PYTHONPATH || ""), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", LG_TASK: taskFile, LG_RECIPE: file };
      const t0 = Date.now();
      const child = c.child = spawn(python(), ["-u", file], { cwd: c.dir, env, windowsHide: true, detached: process.platform !== "win32" });
      const lines = (s, err) => {
        let buf = "";
        s.on("data", (d) => {
          buf += d.toString("utf8");
          let i;
          while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); onLine(c, l, err); }
        });
      };
      lines(child.stdout, false); lines(child.stderr, true);
      // 配方已经退出了，迟到的回复（比如 AI 引擎画完的图）写不进去：忽略，别让整个客户端崩掉（Windows 上是 EPIPE）
      child.stdin.on("error", () => {});
      child.on("error", (e) => { onLine(c, "启动 Python 失败：" + e.message, true); ok(-1); });
      child.on("exit", (code) => {
        // 配方退出了：马上算这个任务结束（不等），它开的子程序（要是没收好）在后台一起收掉
        ok(code == null ? -1 : code);
        killTree(child.pid, t0, Date.now()).then((n) => { if (n) log(`收掉了配方留在后台的 ${n} 个程序`); }).catch(() => {});
      });
    });
  }
  function onLine(c, l, err) {
    c.lastOut = Date.now();
    if (!l.startsWith("@@lg ")) {
      if (!l.trim()) return;
      const e = { t: Date.now(), msg: l, level: err && /error|Error|Traceback|exception/.test(l) ? "error" : err ? "warn" : "info" };
      c.logs.push(e); if (c.logs.length > 200) c.logs.shift();
      if (err) { e.level = e.level === "info" ? "warn" : e.level; }
      log(l, e.level);
      return;
    }
    let m; try { m = JSON.parse(l.slice(5)); } catch (e) { return; }
    switch (m.t) {
      case "log": { const e = { t: Date.now(), msg: m.msg, level: "info" }; c.logs.push(e); if (c.logs.length > 200) c.logs.shift(); log(m.msg); break; }   // 训练几十个小时的任务：只留最近 200 行，不越攒越多
      case "line": c.line = m.line; c.fn = m.fn; emit("line", { id: c.id, line: m.line, fn: m.fn }); break;
      case "metric": { const { t, ...rest } = m; c.metrics.push(rest); c.lastMetric = rest; emit("metric", { id: c.id, ...rest }); break; }
      case "progress": c.progress = m.p; if (m.note) c.note = m.note; emit("progress", { id: c.id, p: m.p, note: m.note }); break;
      case "image": emit("image", { id: c.id, path: m.path, caption: m.caption, job: c.job.name }); break;
      case "ckpt":
        c.lastCkpt = m.step;
        c.uploads = c.uploads.then(async () => {
          if (c.stopping && !opt.uploadWhileStopping) return;
          // 断网的时候存档会攒起来：只交最新的一个，旧的不交了
          const stale = () => (c.lastCkpt != null && m.step < c.lastCkpt) || !!c.result;
          const key = await whenOnline(c, "存档", () => put(c, m.path, "ckpt-" + m.step), stale);
          if (key === undefined) { if (opt.pruneCkpts !== false) fs.rm(m.path, { force: true }, () => {}); return; }
          if ((await whenOnline(c, "存档", () => api("/api/ckpt", { task: c.id, step: m.step, key }), stale)) === undefined) { if (opt.pruneCkpts !== false) fs.rm(m.path, { force: true }, () => {}); return; }
          c.ckpts++;
          emit("ckpt", { id: c.id, step: m.step });
          log(`存档：第 ${m.step} 步`, "ok");
          if (opt.pruneCkpts !== false) fs.rm(m.path, { force: true }, () => {});
        }).catch((e) => log("存档上传失败：" + e.message, "warn"));
        break;
      case "output":
        c.uploads = c.uploads.then(async () => { const key = await whenOnline(c, "上传结果文件", () => put(c, m.path, "out")); c.outputs.push({ name: m.name, key, size: fs.statSync(m.path).size }); }).catch((e) => log("结果上传失败：" + e.message, "warn"));
        break;
      case "review":
        c.uploads = c.uploads.then(async () => {
          const { t, ...r } = m;
          c.put = c.put || {};   // 同一张图（比如参考照片）只传一次
          for (const k of ["a", "b", "ref", "img", "audio"]) if (r[k] && fs.existsSync(r[k])) r[k] = c.put[r[k]] = c.put[r[k]] || await whenOnline(c, "上传审核图片", () => put(c, r[k], "rv"));
          c.reviews.push(r);
        }).catch((e) => log("审核图片上传失败：" + e.message, "warn"));
        break;
      case "result": { const { t, ...r } = m; c.result = r; break; }
      // 配方说「这台电脑现在算不了」（显存被别的程序占了、训练慢得不正常）：不算任务失败，交给别的电脑从存档接着算，这台歇一会儿
      case "unfit": c.unfit = String(m.why || "这台电脑现在算不了这个任务"); log(c.unfit, "error"); break;
      // 配方要换个方式开本地大模型（比如带上刚训练好的 LoRA 来考试）：{t:"llm", op:"start"|"stop"|"info", llm:{...}, lora: 本地路径}
      case "llm": {
        const { t, id, op, ...a } = m;
        const reply = (x) => { try { if (c.child && c.child.stdin && !c.child.stdin.destroyed) c.child.stdin.write(JSON.stringify({ id, ...x }) + "\n"); } catch (e) {} };
        Promise.resolve()
          .then(async () => {
            if (!opt.llm) throw new Error("这台电脑的客户端太旧，跑不了本地大模型");
            if (op === "stop") { opt.llm.stop(); return {}; }
            if (op === "info") return { version: opt.llm.version ? await opt.llm.version() : "", convert: opt.llm.convertDir ? opt.llm.convertDir() : "" };
            const spec = { ...((c.job.params || {}).llm || {}), ...(a.llm || {}) };
            if (a.lora) { const f = path.resolve(c.dir, String(a.lora)); if (!f.startsWith(path.resolve(c.dir) + path.sep) || !fs.existsSync(f)) throw new Error("LoRA 文件要在任务文件夹里"); spec.lora = f; }
            return { url: await opt.llm.ensure(spec, (x) => { c.note = x; c.lastOut = Date.now(); emit("progress", { id: c.id, p: c.progress, note: x }); }) };
          })
          .then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: e.message }));
        break;
      }
      // 配方让 AI 引擎画图：做完把结果写回配方的标准输入（一行 JSON）
      case "comfy": {
        const { t, id, op, ...a } = m;
        const reply = (x) => { try { if (c.child && c.child.stdin && !c.child.stdin.destroyed) c.child.stdin.write(JSON.stringify({ id, ...x }) + "\n"); } catch (e) {} };
        Promise.resolve()
          .then(() => { if (!opt.comfy) throw new Error("这台电脑还没装好 AI 引擎"); return opt.comfy.call(op, a, { dir: c.dir, onMsg: (x) => { c.lastOut = Date.now(); if (x && x.max) { c.note = `AI 引擎：第 ${x.value}/${x.max} 步`; emit("progress", { id: c.id, p: c.progress, note: c.note }); } } }); })
          .then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: e.message }));
        break;
      }
    }
  }

  // ---- 人工任务：录表情、审核 ----
  async function upload(jobId, taskId, file, prefix) { const r = await api("/api/put", { job: jobId, task: taskId, name: path.basename(file), prefix }); await xfer("PUT", r.url, file); return { key: r.key, size: fs.statSync(file).size, name: path.basename(file) }; }

  return {
    on: (k, f) => (ev.on(k, f), () => ev.off(k, f)),
    start, stop, api, upload, gate,
    pause(v) { paused = !!v; if (paused && cur) stopTask(true, "你点了暂停"); setState(paused ? "paused" : "idle"); lastLease = 0; },
    // 手动开始 / 停止 / 恢复自动。停止时正在算的交给别的电脑从存档接着算
    setManual(m) {
      manual = ["on", "off"].includes(m) ? m : "auto";
      lastLease = 0;
      if (manual === "on") hold.until = 0;   // 点「开始」：修好了，马上再试
      if (manual === "off") { if (cur) stopTask(true, "你点了停止"); setState("paused", "你点了停止"); }
      else setState("idle", manual === "on" ? "手动开始了" : "");
      setTimeout(tick, 0);
      return manual;
    },
    setPolicy(p) { policy = { ...policy, ...p }; lastHb = 0; return policy; },
    setCaps(c) { caps = c; lastHb = 0; },
    // 准备更新：不领新任务，手上的接着算完
    drain(v) { draining = !!v; lastLease = 0; },
    cmdDone: (id, ok, result) => api("/api/cmd/done", { id, ok: !!ok, result: result == null ? null : result }).catch(() => {}),
    lastTick: () => lastTick,
    setEnv: (e) => { extraEnv = { ...(e || {}) }; },
    touch() { if (cur) cur.lastOut = Date.now(); },   // 准备阶段（装 GPT-SoVITS、下大文件）有进度时也算有动静
    kill: (why) => stopTask(true, why || "被结束了"),
    get policy() { return policy; },
    status: () => ({ state, why, running: !!cur, paused, manual, policy, task: cur ? { id: cur.id, job: cur.job, recipe: cur.recipe && { id: cur.recipe.id, name: cur.recipe.name }, progress: cur.progress, line: cur.line, fn: cur.fn, note: cur.note, started: cur.started, ckpts: cur.ckpts } : null, logs: logs.slice(-200), gpu: gpuNow }),
    // 测试用：模拟突然断电（不告诉调度中心，进程直接没了）
    crash() { stopped = true; clearInterval(timer); timer = null; if (cur) { cur.stopping = true; try { cur.child && cur.child.kill("SIGKILL"); } catch (e) {} } },
    current: () => cur,
  };
}

// 第一次加入：用邀请链接换这台电脑的口令
async function join(invite, name, device, fetchImpl = fetch) {
  const inv = parseInvite(invite);
  const r = await fetchImpl(inv.server + "/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: inv.code, name, device }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "加入失败 " + r.status);
  return { server: inv.server, pubkey: inv.pubkey, token: j.token, device: j.device, member: j.member };
}

module.exports = { setNetLimit, xferAny, create, join, parseInvite, verifySig, xfer, probe, netWhy, isNet, resetConnections };
