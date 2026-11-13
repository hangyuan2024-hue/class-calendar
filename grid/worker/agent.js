// 捞捞算力 · 客户端核心：报平安、按设置挂机、领活、跑配方（Python）、实时把代码行 / 日志 / 曲线 / 图片报给界面、
// 存档上传、做完交结果；电脑要用了、被管理员暂停了、任务转给别人了，就停下。客户端（Electron）和命令行版都用它。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");
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
function xfer(method, url, file, o = {}) {
  if (method !== "GET") return xfer1(method, url, file, o);
  const k = path.resolve(file);
  if (inflight.has(k)) return inflight.get(k);
  const p = xfer1(method, url, file, o).finally(() => inflight.delete(k));
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
      if (signal) signal.addEventListener("abort", () => req.destroy(new Error("停了")));
      let sent = 0;
      const rs = fs.createReadStream(file);
      rs.on("data", (c) => { sent += c.length; onProgress && onProgress(sent, size); });
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
      res.on("data", (c) => { got += c.length; onProgress && onProgress(got, total); });
      res.pipe(ws);
      // 改名失败（同一个文件另一处刚好也下完、已经改过名了）：文件在就算成功，不让整个程序崩掉
      ws.on("finish", () => { try { fs.renameSync(tmp, file); ok({ size: got }); } catch (e) { if (fs.existsSync(file)) ok({ size: fs.statSync(file).size }); else bad(e); } });
      ws.on("error", bad);
    });
    req.on("error", bad);
    if (signal) signal.addEventListener("abort", () => req.destroy(new Error("停了")));
  });
}

function create(opt) {
  const ev = new EventEmitter();
  const server = opt.server.replace(/\/+$/, "");
  const work = opt.workDir;
  fs.mkdirSync(path.join(work, "recipes"), { recursive: true });
  fs.mkdirSync(path.join(work, "tasks"), { recursive: true });
  const python = () => (typeof opt.python === "function" ? opt.python() : opt.python) || (process.platform === "win32" ? "python" : "python3");
  let policy = { mode: "always", idleMin: 5, from: "22:00", to: "08:00", maxTemp: 83, yieldGames: true, ...(opt.policy || {}) };
  let caps = opt.caps || null;
  let state = "starting";       // starting / waiting（按设置还不能算）/ idle（能算，没活）/ busy / paused（自己点了暂停）/ offline
  let why = "";
  let cur = null;               // 正在跑的任务
  let stopped = false, paused = false, draining = false;
  // 手动开关：auto 按挂机设置；on 手动开始（不管空闲 / 定时，一直算到点「停止」，但还是让着游戏、怕过热）；off 停止
  let manual = opt.manual || "auto";
  let lastHb = 0, lastLease = 0;
  const logs = [];
  let gpuNow = null;
  const emit = (k, v) => { try { ev.emit(k, v); ev.emit("any", { k, v }); } catch (e) {} };
  const setState = (s, w = "") => { if (s !== state || w !== why) { state = s; why = w; emit("state", { state, why }); } };
  const log = (msg, level = "info") => { const l = { t: Date.now(), msg: String(msg), level }; logs.push(l); if (logs.length > 500) logs.shift(); emit("log", l); };

  async function api(p, body, { method, timeout = 20000 } = {}) {
    const r = await (opt.fetch || fetch)(server + p, { method: method || (body ? "POST" : "GET"), headers: { authorization: "Bearer " + opt.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "调度中心出错 " + r.status); e.status = r.status; throw e; }
    return j;
  }

  // ---- 什么时候能算 ----
  const minutes = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  function inWindow(d = new Date()) {
    const a = minutes(policy.from), b = minutes(policy.to), x = d.getHours() * 60 + d.getMinutes();
    return a <= b ? x >= a && x < b : x >= a || x < b;
  }
  async function gate() {
    if (paused) return { ok: false, why: "你点了暂停" };
    if (draining) return { ok: false, why: "有新版本：手上的算完就自动更新" };
    if (manual === "off") return { ok: false, why: "你点了停止" };
    if (manual !== "on" && policy.mode === "off") return { ok: false, why: "想算的时候点「开始」" };
    if (manual !== "on" && policy.mode === "schedule" && !inWindow()) return { ok: false, why: `只在 ${policy.from}～${policy.to} 算` };
    if (manual !== "on" && policy.mode === "idle") {
      const idle = opt.idleSecs ? await opt.idleSecs() : 1e9;
      if (idle < (policy.idleMin || 5) * 60) return { ok: false, why: `你在用电脑，空闲 ${policy.idleMin} 分钟后开始`, active: true };
    }
    if (gpuNow && gpuNow.temp != null && gpuNow.temp >= (policy.maxTemp || 83)) return { ok: false, why: `显卡 ${gpuNow.temp}℃，凉一凉再算` };
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
        await api("/api/hb", { state: cur ? "busy" : g.ok ? "idle" : "waiting", info: { ...(caps || {}), gpuNow, version: opt.version || "" }, policy, live: cur ? liveOf() : null });
        if (state === "offline") setState(cur ? "busy" : "idle");
      }
      if (cur) {
        if (!g.ok && (paused || manual === "off" || g.active || /℃/.test(g.why))) { log("停下：" + g.why, "warn"); await stopTask(true, g.why); }
      } else if (!g.ok) setState(paused || manual === "off" ? "paused" : "waiting", g.why);
      else if (Date.now() - lastLease > (opt.leaseEveryMs || 10000)) {
        lastLease = Date.now();
        const r = await api("/api/lease", { caps: caps || {} });
        if (r.task) runTask(r.task).catch((e) => log("任务出错：" + e.message, "error"));
        else setState("idle", "现在没有要算的");
      }
    } catch (e) {
      if (e.status === 401) { setState("offline", e.message); emit("kicked", e.message); }
      else setState("offline", "连不上调度中心：" + e.message);
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
    let renewTimer = null;
    try {
      const rc = await fetchRecipe(L.recipe);
      emit("source", { id: c.id, name: L.recipe.name, source: rc.source });
      // 配方开头写「# requires: diffusers==0.35.1 transformers」：先把要的包装好（装过的 pip 会跳过）
      const req = (/^#\s*requires:\s*(.+)$/m.exec(rc.source) || [])[1];
      if (req && opt.ensure && !ensured.has(req.trim())) { c.note = "装配方要的包…"; log("装配方要的包：" + req); await opt.ensure(req.trim().split(/\s+/)); ensured.add(req.trim()); }
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
        c.note = "准备本地大模型…";
        llmUrl = await opt.llm.ensure((L.job.params || {}).llm || {}, (m) => { c.note = m; log(m); emit("progress", { id: c.id, p: c.progress, note: m }); });
      }
      const t = { kind: L.task.kind, task: L.task, input: L.task.input, job: L.job, work: dir, resume: null, parts: [], llm: llmUrl };
      if (L.resume) { const f = path.join(dir, "resume-" + path.basename(L.resume.key)); c.note = "下载存档…"; await xfer("GET", L.resume.url, f); t.resume = f; t.resumeInfo = { step: L.resume.step, round: L.resume.round }; }
      for (const [i, u] of (L.task.input.partUrls || []).entries()) { const f = path.join(dir, `part-${i}.npz`); await xfer("GET", u, f); t.parts.push(f); }
      delete t.input.partUrls;
      // 前面步骤的结果文件、接着训练的起点：下载到本机
      t.files = {}; t.deps = L.deps || {};
      for (const [k, u] of Object.entries(L.fileUrls || {})) { const f = path.join(dir, "in-" + k.replace(/[^\w.\-]/g, "_")); c.note = "下载 " + k + "…"; await xfer("GET", u, f); t.files[k] = f; }
      // 训练要用的人工审核结果（params.dataset）
      if (L.job.params && L.job.params.dataset) { c.note = "取审核数据…"; const d = await api("/api/dataset", { task: c.id }); t.dataset = path.join(dir, "dataset.json"); fs.writeFileSync(t.dataset, JSON.stringify(d.items || [])); log(`审核数据：${(d.items || []).length} 条`); }
      fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(t));
      renewTimer = setInterval(() => renew(c).catch(() => {}), opt.renewMs || 20000);
      const code = await spawnPy(c, rc.file, path.join(dir, "task.json"));
      clearInterval(renewTimer);
      await c.uploads;
      if (c.stopping) return;
      if (code !== 0 || !c.result) throw new Error((c.logs.filter((l) => l.level === "error").slice(-6).map((l) => l.msg).join("\n")) || `配方退出码 ${code}`);
      // 结果里的文件：上传，换成存储地址
      const result = {};
      for (const [k, v] of Object.entries(c.result)) {
        if (!(v && v.$file)) { result[k] = v; continue; }
        result[k] = await put(c, v.$file, k);
        // 发布给老师端要用：大小和 sha256
        result[k + "_size"] = fs.statSync(v.$file).size;
        result[k + "_sha256"] = await new Promise((ok, bad) => { const h = crypto.createHash("sha256"); fs.createReadStream(v.$file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });
      }
      const secs = (Date.now() - c.started) / 1000;
      const r = await api("/api/done", { task: c.id, result, outputs: c.outputs, reviews: c.reviews, secs, metrics: c.metrics.splice(0) });
      log(r.ok ? `做完了「${L.job.name}」，用了 ${Math.round(secs)} 秒` : r.why, r.ok ? "ok" : "warn");
      emit("done", { id: c.id, ok: r.ok, secs, result });
    } catch (e) {
      clearInterval(renewTimer);
      if (!c.stopping) { log("出错：" + e.message, "error"); await api("/api/fail", { task: c.id, error: e.message + "\n" + c.logs.slice(-20).map((l) => l.msg).join("\n") }).catch(() => {}); emit("done", { id: c.id, ok: false, error: e.message }); }
    } finally {
      if (cur === c) cur = null;
      if (!opt.keepTaskDirs) fs.rm(dir, { recursive: true, force: true }, () => {});
      lastLease = 0;
      setState(paused || manual === "off" ? "paused" : "idle");
    }
  }
  async function put(c, file, name) {
    const r = await api("/api/put", { job: c.job.id, task: c.id, name: path.basename(file), prefix: name });
    await xfer("PUT", r.url, file);
    return r.key;
  }
  async function renew(c) {
    const ms = c.metrics.splice(0);
    const r = await api("/api/renew", { task: c.id, progress: c.progress, metrics: ms, live: liveOf() });
    if (r.cancel && !c.stopping) { log("停下：" + r.why, "warn"); await stopTask(false, r.why); }
  }
  // 停下当前任务；release=true 告诉调度中心「我要用电脑了，交给别人」
  async function stopTask(release, reason) {
    const c = cur;
    if (!c || c.stopping) return;
    c.stopping = true;
    if (c.child) { try { c.child.kill(); } catch (e) {} }
    if (opt.comfy) { try { await opt.comfy.abort(); if (release) opt.comfy.stop(); } catch (e) {} }   // 你要用电脑了：AI 引擎也关掉，让出显存
    if (opt.llm && release) { try { opt.llm.stop(); } catch (e) {} }
    await c.uploads.catch(() => {});
    if (release) await api("/api/fail", { task: c.id, release: true, error: reason }).catch(() => {});
    emit("done", { id: c.id, ok: false, stopped: true, why: reason });
  }

  function spawnPy(c, file, taskFile) {
    return new Promise((ok) => {
      const env = { ...process.env, ...(opt.env || {}), PYTHONPATH: PY_DIR + path.delimiter + (process.env.PYTHONPATH || ""), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", LG_TASK: taskFile, LG_RECIPE: file };
      const child = c.child = spawn(python(), ["-u", file], { cwd: c.dir, env, windowsHide: true });
      const lines = (s, err) => {
        let buf = "";
        s.on("data", (d) => {
          buf += d.toString("utf8");
          let i;
          while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); onLine(c, l, err); }
        });
      };
      lines(child.stdout, false); lines(child.stderr, true);
      child.on("error", (e) => { onLine(c, "启动 Python 失败：" + e.message, true); ok(-1); });
      child.on("exit", (code) => ok(code == null ? -1 : code));
    });
  }
  function onLine(c, l, err) {
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
      case "log": { const e = { t: Date.now(), msg: m.msg, level: "info" }; c.logs.push(e); log(m.msg); break; }
      case "line": c.line = m.line; c.fn = m.fn; emit("line", { id: c.id, line: m.line, fn: m.fn }); break;
      case "metric": { const { t, ...rest } = m; c.metrics.push(rest); c.lastMetric = rest; emit("metric", { id: c.id, ...rest }); break; }
      case "progress": c.progress = m.p; if (m.note) c.note = m.note; emit("progress", { id: c.id, p: m.p, note: m.note }); break;
      case "image": emit("image", { id: c.id, path: m.path, caption: m.caption, job: c.job.name }); break;
      case "ckpt":
        c.uploads = c.uploads.then(async () => {
          if (c.stopping && !opt.uploadWhileStopping) return;
          const key = await put(c, m.path, "ckpt-" + m.step);
          await api("/api/ckpt", { task: c.id, step: m.step, key });
          c.ckpts++;
          emit("ckpt", { id: c.id, step: m.step });
          log(`存档：第 ${m.step} 步`, "ok");
          if (opt.pruneCkpts !== false) fs.rm(m.path, { force: true }, () => {});
        }).catch((e) => log("存档上传失败：" + e.message, "warn"));
        break;
      case "output":
        c.uploads = c.uploads.then(async () => { const key = await put(c, m.path, "out"); c.outputs.push({ name: m.name, key, size: fs.statSync(m.path).size }); }).catch((e) => log("结果上传失败：" + e.message, "warn"));
        break;
      case "review":
        c.uploads = c.uploads.then(async () => {
          const { t, ...r } = m;
          c.put = c.put || {};   // 同一张图（比如参考照片）只传一次
          for (const k of ["a", "b", "ref", "img", "audio"]) if (r[k] && fs.existsSync(r[k])) r[k] = c.put[r[k]] = c.put[r[k]] || await put(c, r[k], "rv");
          c.reviews.push(r);
        }).catch((e) => log("审核图片上传失败：" + e.message, "warn"));
        break;
      case "result": { const { t, ...r } = m; c.result = r; break; }
      // 配方让 AI 引擎画图：做完把结果写回配方的标准输入（一行 JSON）
      case "comfy": {
        const { t, id, op, ...a } = m;
        const reply = (x) => { try { if (c.child && c.child.stdin && !c.child.stdin.destroyed) c.child.stdin.write(JSON.stringify({ id, ...x }) + "\n"); } catch (e) {} };
        Promise.resolve()
          .then(() => { if (!opt.comfy) throw new Error("这台电脑还没装好 AI 引擎"); return opt.comfy.call(op, a, { dir: c.dir, onMsg: (x) => { if (x && x.max) { c.note = `AI 引擎：第 ${x.value}/${x.max} 步`; emit("progress", { id: c.id, p: c.progress, note: c.note }); } } }); })
          .then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: e.message }));
        break;
      }
    }
  }

  // ---- 人工任务：录表情、审核 ----
  async function upload(jobId, taskId, file, prefix) { const r = await api("/api/put", { job: jobId, task: taskId, name: path.basename(file), prefix }); await xfer("PUT", r.url, file); return { key: r.key, size: fs.statSync(file).size, name: path.basename(file) }; }

  return {
    on: (k, f) => (ev.on(k, f), () => ev.off(k, f)),
    start, stop, api, upload,
    pause(v) { paused = !!v; if (paused && cur) stopTask(true, "你点了暂停"); setState(paused ? "paused" : "idle"); lastLease = 0; },
    // 手动开始 / 停止 / 恢复自动。停止时正在算的交给别的电脑从存档接着算
    setManual(m) {
      manual = ["on", "off"].includes(m) ? m : "auto";
      lastLease = 0;
      if (manual === "off") { if (cur) stopTask(true, "你点了停止"); setState("paused", "你点了停止"); }
      else setState("idle", manual === "on" ? "手动开始了" : "");
      setTimeout(tick, 0);
      return manual;
    },
    setPolicy(p) { policy = { ...policy, ...p }; lastHb = 0; return policy; },
    setCaps(c) { caps = c; lastHb = 0; },
    // 准备更新：不领新任务，手上的接着算完
    drain(v) { draining = !!v; lastLease = 0; },
    get policy() { return policy; },
    status: () => ({ state, why, paused, manual, policy, task: cur ? { id: cur.id, job: cur.job, recipe: cur.recipe && { id: cur.recipe.id, name: cur.recipe.name }, progress: cur.progress, line: cur.line, fn: cur.fn, note: cur.note, started: cur.started, ckpts: cur.ckpts } : null, logs: logs.slice(-200), gpu: gpuNow }),
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

module.exports = { create, join, parseInvite, verifySig, xfer, probe };
