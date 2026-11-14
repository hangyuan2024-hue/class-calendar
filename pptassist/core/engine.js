// 捞捞PPT助手 · 本机 AI 引擎：老师电脑上的 ComfyUI（开源，本机运行，要 NVIDIA 显卡）
//   - 认整合包（ComfyUI_windows_portable：python_embeded + ComfyUI/main.py），用它自带的 Python 启动，只听 127.0.0.1
//   - 装我们要的插件（固定版本，从 GitHub 下，国内走加速镜像）、下模型（hf-mirror.com，断点续传）
//   - 交工作流（core/workflows.js）、收进度（/ws）、取结果（/view）、能停
// 照片、录音只传给本机的 ComfyUI，不出这台电脑。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const W = require("./workflows");
const DL = require("./dl");

const PAGES = {
  comfy: "https://github.com/comfyanonymous/ComfyUI/releases",
  comfyCn: "https://www.comfy.org/download",
};
const HF = ["https://hf-mirror.com", "https://huggingface.co"];
const GH = ["https://ghfast.top/", "https://gh-proxy.com/", ""];
const PIP = ["https://pypi.tuna.tsinghua.edu.cn/simple", "https://mirrors.aliyun.com/pypi/simple", ""];

// 整合包的文件夹：ComfyUI_windows_portable（或者它里面的 ComfyUI 文件夹、自己装的带 venv 的 ComfyUI）
function inspect(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: "文件夹不在了" };
  const win = process.platform === "win32";
  const has = (...a) => fs.existsSync(path.join(...a));
  let root = dir, comfy = null;
  if (has(dir, "ComfyUI", "main.py")) comfy = path.join(dir, "ComfyUI");
  else if (has(dir, "main.py") && has(dir, "comfy")) { comfy = dir; root = path.dirname(dir); }
  else {
    try { for (const d of fs.readdirSync(dir)) if (has(dir, d, "ComfyUI", "main.py")) { root = path.join(dir, d); comfy = path.join(root, "ComfyUI"); break; } } catch (e) {}
  }
  if (!comfy) return { ok: false, error: "这个文件夹里没有 ComfyUI：请选 ComfyUI 整合包解压出来的那个文件夹（里面有 ComfyUI 和 python_embeded）" };
  const rel = win ? ["python_embeded\\python.exe", "python_embedded\\python.exe", "python\\python.exe", "venv\\Scripts\\python.exe", ".venv\\Scripts\\python.exe"] : ["python_embeded/bin/python3", "venv/bin/python", ".venv/bin/python"];
  const py = [...rel.map((r) => path.join(root, r)), ...rel.map((r) => path.join(comfy, r))].find((p) => fs.existsSync(p));
  if (!py) return { ok: false, error: "找到了 ComfyUI，但旁边没有它自带的 Python（python_embeded）：请用官方的 Windows 整合包" };
  return { ok: true, dir: root, comfy, python: py, models: path.join(comfy, "models"), nodes: path.join(comfy, "custom_nodes") };
}

// ---- 极简 WebSocket 客户端：只收 ComfyUI 的进度消息（文本帧），不发东西 ----
function wsListen(url, onJson) {
  const u = new URL(url);
  const key = crypto.randomBytes(16).toString("base64");
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key } });
  let sock = null, closed = false, opened;
  const ready = new Promise((ok) => { opened = ok; setTimeout(ok, 3000); });
  req.on("upgrade", (res, s) => {
    sock = s; opened();
    let buf = Buffer.alloc(0), parts = [];
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (masked) off += 4;
        if (buf.length < off + len) return;
        let body = buf.subarray(off, off + len);
        if (masked) { const m = buf.subarray(off - 4, off); body = Buffer.from(body.map((b, i) => b ^ m[i & 3])); }
        buf = buf.subarray(off + len);
        if (op === 8) { s.end(); return; }
        if (op === 9) { const pong = Buffer.concat([Buffer.from([0x8a, 0x80 | body.length]), Buffer.alloc(4), body]); try { s.write(pong); } catch (e) {} continue; }
        if (op === 1 || (op === 0 && parts.length)) {
          parts.push(body);
          if (fin) { const t = Buffer.concat(parts).toString("utf8"); parts = []; try { onJson(JSON.parse(t)); } catch (e) {} }
        } else if (op === 2) parts = [];
      }
    });
    s.on("error", () => {});
  });
  req.on("error", () => opened());
  req.end();
  return { ready, close() { if (closed) return; closed = true; try { sock ? sock.destroy() : req.destroy(); } catch (e) {} } };
}

function create(opt = {}) {
  const doFetch = opt.fetch || fetch;
  const doSpawn = opt.spawn || spawn;
  const hf = opt.hf || HF, gh = opt.gh || GH, pip = opt.pip || PIP;
  const mirror = opt.mirror || null;   // 国内存储的清单（core/mirror.js），有就先从国内存储下
  let proc = null, base = opt.url || null, sys = null, info = null, job = null, task = null;
  const log = [];
  const addLog = (l) => { for (const x of String(l).split(/\r?\n/)) if (x.trim()) { log.push(x); if (log.length > 120) log.shift(); } };
  const j = async (u, o) => { const r = await doFetch(u, o); if (!r.ok) throw new Error(`${u.replace(/\?.*/, "")} → ${r.status}`); return r.json(); };

  // ---------- 启动 / 连接 ----------
  async function ping(u) { try { return await j(u + "/system_stats", { signal: AbortSignal.timeout(3000) }); } catch (e) { return null; } }
  // 只认 NVIDIA 显卡（cuda）；用 CPU 跑的 ComfyUI 算 0G
  function vramOf(s) {
    const d = s && s.devices && s.devices.find((x) => /cuda/i.test(x.type || ""));
    return d ? { gb: Math.round((d.vram_total || 0) / 1073741824), name: String(d.name || "").replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*\w+$/, ""), gpu: true } : { gb: 0, name: "", gpu: false };
  }
  async function start(rt, o = {}) {
    if (base) { const s0 = await ping(base); if (s0) { sys = s0; return status(); } }
    if (proc) throw new Error("ComfyUI 正在启动");
    const port = o.port || 18188;
    const args = ["-s", path.join(rt.comfy, "main.py"), "--listen", "127.0.0.1", "--port", String(port), "--disable-auto-launch", "--preview-method", "none"];
    if (o.lowvram) args.push("--lowvram");
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", HF_ENDPOINT: hf[0] };
    proc = doSpawn(rt.python, args, { cwd: rt.comfy, env, windowsHide: true });
    proc.stdout && proc.stdout.on("data", (d) => addLog(d.toString("utf8")));
    proc.stderr && proc.stderr.on("data", (d) => addLog(d.toString("utf8")));
    let exited = null;
    proc.on("exit", (c) => { exited = c; proc = null; base = null; sys = null; info = null; });
    proc.on("error", (e) => { exited = e.message; proc = null; });
    const u = `http://127.0.0.1:${port}`;
    const t0 = Date.now();
    while (Date.now() - t0 < (o.timeout || 300000)) {
      if (exited !== null) throw new Error("ComfyUI 没启动起来（" + exited + "）：\n" + log.slice(-8).join("\n"));
      const s = await ping(u);
      if (s) { base = u; sys = s; info = null; return status(); }
      await new Promise((r) => setTimeout(r, 1500));
    }
    stop();
    throw new Error("等了 5 分钟 ComfyUI 还没启动好：\n" + log.slice(-8).join("\n"));
  }
  async function attach(u) {
    u = String(u || "").replace(/\/+$/, "");
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u)) throw new Error("只能连本机的 ComfyUI（http://127.0.0.1:端口）");
    const s = await ping(u); if (!s) throw new Error("连不上 " + u + "：ComfyUI 开着吗？");
    base = u; sys = s; info = null; return status();
  }
  function stop() {
    if (!proc) return false;
    try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }); else proc.kill("SIGTERM"); } catch (e) {}
    proc = null; base = null; sys = null; info = null;
    return true;
  }
  // 连着的 ComfyUI 还在不在、显卡是什么（设置里给了地址、或者别的程序开的）
  async function refresh() { if (!base) return status(); const s = await ping(base); if (s) sys = s; else if (!proc) { base = null; sys = null; info = null; } return status(); }
  const status = () => ({ running: !!base, url: base, own: !!proc, vram: vramOf(sys), version: sys && sys.system ? sys.system.comfyui_version || "" : "", job: job ? { kind: job.kind, last: job.last } : null, task: task ? { kind: task.kind, last: task.last } : null });
  async function objectInfo() { if (!info) info = await j(base + "/object_info"); return info; }

  // ---------- 检查：插件、节点、模型 ----------
  // files：已经确定下来的模型文件名（{ key: { name, size, url } }，存在老师的设置里）
  async function check(rt, files = {}) {
    const has = info || (base ? await objectInfo().catch(() => null) : null);
    const packs = W.NODE_PACKS.map((p) => ({ ...p, installed: fs.existsSync(path.join(rt.nodes, p.dir)), loaded: has ? p.check.every((c) => has[c]) : null }));
    const coreMissing = has ? W.CORE_NODES.filter((c) => !has[c]) : [];
    const models = {};
    for (const [k, m] of Object.entries(W.MODELS)) {
      const name = (files[k] && files[k].name) || m.name;
      const f = path.join(rt.models, m.dir, name);
      let size = 0; try { size = fs.statSync(f).size; } catch (e) {}
      const want = (files[k] && files[k].size) || m.size;
      models[k] = { name, dir: m.dir, size, want, ok: size > 0 && (!files[k] || !files[k].size || size === files[k].size), license: m.license };
    }
    const feat = {};
    for (const [f, keys] of Object.entries(W.NEEDS)) {
      const miss = keys.filter((k) => !models[k].ok);
      const packMiss = packs.filter((p) => p.for === f && !p.installed);
      feat[f] = { ready: !miss.length && !packMiss.length && !coreMissing.length, missing: miss, packs: packMiss.map((p) => p.dir), bytes: miss.reduce((s, k) => s + Math.max(0, models[k].want - models[k].size), 0) };
    }
    return { packs, coreMissing, models, feat, running: !!base };
  }

  // ---------- 确定模型文件名：同一个仓库里好几种量化，按显存挑 ----------
  async function resolve(key, vramGB) {
    const m = W.MODELS[key]; if (!m) throw new Error("没有这个模型：" + key);
    const tier = m.pick ? Object.keys(m.pick).map(Number).sort((a, b) => b - a).find((t) => (+vramGB || 0) >= t) || 0 : 0;
    // 国内存储里有就用国内的（Hugging Face 镜像当后备）
    const cn = mirror ? await mirror.model(key).catch(() => []) : [];
    if (cn.length) {
      const hit = m.pick ? m.pick[tier].map((w) => cn.find((x) => x.name.includes(w))).find(Boolean) : cn.find((x) => x.name === m.name);
      if (hit) {
        const p = m.pick ? hit.src && hit.src.split("/resolve/main/")[1] : m.path;
        return { name: hit.name, size: hit.size || 0, sha256: hit.sha256 || "", urls: [...(mirror.sources ? mirror.sources(hit) : [hit.url]), ...(p ? hf.map((h) => `${h}/${m.repo}/resolve/main/${p}`) : [])] };
      }
    }
    if (!m.pick) return { name: m.name, size: 0, urls: hf.map((h) => `${h}/${m.repo}/resolve/main/${m.path}`) };
    let err = null;
    for (const h of hf) {
      try {
        const list = await j(`${h}/api/models/${m.repo}/tree/main${m.folder ? "/" + m.folder : ""}`, { signal: AbortSignal.timeout(15000) });
        const files = list.filter((x) => x.type === "file" && x.path.endsWith(m.ext));
        for (const want of m.pick[tier]) {
          const hit = files.find((x) => path.posix.basename(x.path).includes(want));
          if (hit) return { name: path.posix.basename(hit.path), size: hit.size || (hit.lfs && hit.lfs.size) || 0, urls: hf.map((x) => `${x}/${m.repo}/resolve/main/${hit.path}`) };
        }
        err = new Error(`${m.repo} 里没找到合适的文件`);
      } catch (e) { err = e; }
    }
    // 列不出来就用默认的文件名
    if (m.name) return { name: m.name, size: 0, urls: hf.map((h) => `${h}/${m.repo}/resolve/main/${m.folder ? m.folder + "/" : ""}${m.name}`) };
    throw err;
  }

  // ---------- 下载（断点续传、换地址重试、校验，见 core/dl.js）----------
  const download = (urls, dest, onProg, signal, want) => DL.download(urls, dest, { fetch: doFetch, onProg, signal, log: addLog, want });

  // 下载一个功能要的模型；onMsg({ key, name, got, total, speed, i, n })
  async function fetchModels(rt, feature, files, vramGB, onMsg) {
    if (task) throw new Error("正在" + task.kind);
    const ac = new AbortController();
    task = { kind: "下载模型", ac, last: null };
    try {
      const st = await check(rt, files);
      const keys = W.NEEDS[feature].filter((k) => !st.models[k].ok);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const r = await resolve(k, vramGB);
        files[k] = r;
        const dest = path.join(rt.models, W.MODELS[k].dir, r.name);
        await download(r.urls, dest, (p) => { task.last = { key: k, name: r.name, i, n: keys.length, ...p }; onMsg && onMsg(task.last); }, ac.signal, { size: r.size, sha256: r.sha256 });
        files[k].size = fs.statSync(dest).size;
      }
      return files;
    } finally { task = null; }
  }

  // ---------- 装插件：GitHub 的 zip（固定版本）→ custom_nodes，再用整合包的 Python 装依赖 ----------
  function runPy(rt, args, cwd) {
    return new Promise((ok, bad) => {
      const p = doSpawn(rt.python, args, { cwd: cwd || rt.dir, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" }, windowsHide: true });
      p.stdout && p.stdout.on("data", (d) => addLog(d.toString("utf8")));
      p.stderr && p.stderr.on("data", (d) => addLog(d.toString("utf8")));
      p.on("error", (e) => bad(e));
      p.on("close", (c) => (c === 0 ? ok() : bad(new Error(`退出码 ${c}：` + log.slice(-4).join(" / ")))));
    });
  }
  const UNZIP = "import sys,zipfile,shutil,os\nz=zipfile.ZipFile(sys.argv[1]);top=z.namelist()[0].split('/')[0];tmp=sys.argv[2]+'.tmp'\nshutil.rmtree(tmp,ignore_errors=True);z.extractall(tmp)\nshutil.rmtree(sys.argv[2],ignore_errors=True);os.replace(os.path.join(tmp,top),sys.argv[2]);shutil.rmtree(tmp,ignore_errors=True)";
  async function installPacks(rt, feature, onMsg) {
    if (task) throw new Error("正在" + task.kind);
    task = { kind: "装插件", last: null };
    try {
      const packs = W.NODE_PACKS.filter((p) => p.for === feature);
      for (let i = 0; i < packs.length; i++) {
        const p = packs[i], dest = path.join(rt.nodes, p.dir);
        const mark = path.join(dest, ".laolao-commit");
        if (fs.existsSync(mark) && fs.readFileSync(mark, "utf8").trim() === p.commit) continue;
        const say = (msg) => { task.last = { pack: p.dir, i, n: packs.length, msg }; onMsg && onMsg(task.last); };
        say("下载 " + p.dir);
        const zip = path.join(rt.nodes, p.dir + "-" + p.commit.slice(0, 7) + ".zip");
        const cnZip = mirror ? await mirror.node(p.dir, p.commit).catch(() => null) : null;
        await download([...(cnZip ? (mirror.sources ? mirror.sources(cnZip) : [cnZip.url]) : []), ...gh.map((g) => `${g}https://github.com/${p.repo}/archive/${p.commit}.zip`)], zip, null, null, cnZip ? { size: cnZip.size, sha256: cnZip.sha256 } : {});
        say("解压 " + p.dir);
        await runPy(rt, ["-c", UNZIP, zip, dest]);
        fs.rmSync(zip, { force: true });
        if (fs.existsSync(path.join(dest, "requirements.txt"))) {
          say("装 " + p.dir + " 需要的 Python 包");
          let err = null;
          for (const idx of pip) {
            try { await runPy(rt, ["-s", "-m", "pip", "install", "-r", path.join(dest, "requirements.txt"), ...(idx ? ["-i", idx] : [])]); err = null; break; } catch (e) { err = e; }
          }
          if (err) throw new Error("装 " + p.dir + " 的依赖没成功：" + err.message);
        }
        fs.writeFileSync(mark, p.commit);
      }
      info = null;
      return true;
    } finally { task = null; }
  }

  // ---------- 跑工作流 ----------
  async function upload(file, as) {
    const fd = new FormData();
    fd.append("image", new Blob([fs.readFileSync(file)]), as || path.basename(file));
    fd.append("overwrite", "true");
    const r = await j(base + "/upload/image", { method: "POST", body: fd });
    return r.subfolder ? r.subfolder + "/" + r.name : r.name;
  }
  // graph：节点图；outDir：结果存到哪；onMsg({ stage, value, max, node, queue })
  async function run(kind, graph, outDir, onMsg) {
    if (!base) throw new Error("AI 引擎（ComfyUI）还没启动");
    if (job) throw new Error("上一件还没做完：" + job.kind);
    const has = await objectInfo();
    const miss = W.classesOf(graph).filter((c) => !has[c]);
    if (miss.length) throw new Error("ComfyUI 里缺这些节点：" + miss.join("、") + "（点「装 AI 引擎需要的插件」，或者更新 ComfyUI）");
    const client = crypto.randomUUID();
    job = { kind, last: null, id: null, killed: false };
    const say = (m) => { job.last = m; try { onMsg && onMsg(m); } catch (e) {} };
    const ws = wsListen(base.replace(/^http/, "ws") + "/ws?clientId=" + client, (m) => {
      if (!job || !m || !m.data || (m.data.prompt_id && job.id && m.data.prompt_id !== job.id)) return;
      if (m.type === "progress") say({ stage: "run", value: m.data.value, max: m.data.max, node: graph[m.data.node] ? graph[m.data.node].class_type : m.data.node });
      else if (m.type === "executing" && m.data.node) say({ stage: "run", node: graph[m.data.node] ? graph[m.data.node].class_type : m.data.node });
    });
    try {
      await ws.ready;
      const r = await doFetch(base + "/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: client }) });
      const q = await r.json().catch(() => ({}));
      if (!r.ok || !q.prompt_id) throw new Error("ComfyUI 不接这个任务：" + JSON.stringify(q.node_errors || q.error || q).slice(0, 600));
      job.id = q.prompt_id;
      say({ stage: "queued" });
      for (;;) {
        if (job.killed) throw new Error("已经停了");
        const h = await j(base + "/history/" + job.id).catch(() => ({}));
        const it = h[job.id];
        if (it && it.status && (it.status.completed || it.status.status_str === "error")) {
          if (it.status.status_str === "error") {
            const ex = (it.status.messages || []).find((x) => x[0] === "execution_error");
            const e = ex ? ex[1] : {};
            const oom = /out of memory|OutOfMemory|CUDA error: out/i.test(e.exception_message || "");
            throw new Error(oom ? "显卡内存不够：关掉别的占显卡的软件再试，或者在设置里选「省显存」" : `AI 引擎出错（${e.node_type || ""}）：${String(e.exception_message || "").trim().slice(0, 400)}`);
          }
          if (job.killed) throw new Error("已经停了");
          fs.mkdirSync(outDir, { recursive: true });
          const files = [];
          for (const out of Object.values(it.outputs || {})) {
            for (const f of [...(out.images || []), ...(out.gifs || []), ...(out.videos || [])]) {
              if (f.type !== "output") continue;
              const u = `${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=output`;
              const rr = await doFetch(u);
              if (!rr.ok) throw new Error("取结果失败：" + rr.status);
              const dest = path.join(outDir, path.basename(f.filename));
              fs.writeFileSync(dest, Buffer.from(await rr.arrayBuffer()));
              files.push(dest);
            }
          }
          if (!files.length) throw new Error("AI 引擎做完了，但没有结果文件");
          return files;
        }
        await new Promise((ok) => setTimeout(ok, opt.poll || 1500));
      }
    } finally { ws.close(); job = null; }
  }
  async function cancel() {
    let any = false;
    if (task && task.ac) { task.ac.abort(); any = true; }
    if (job) {
      job.killed = true; any = true;
      if (base) {
        try { await doFetch(base + "/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [job.id] }) }); } catch (e) {}
        try { await doFetch(base + "/interrupt", { method: "POST" }); } catch (e) {}
      }
    }
    return any;
  }
  return { start, attach, stop, status, refresh, check, resolve, download, fetchModels, installPacks, upload, run, cancel, objectInfo, log };
}

module.exports = { create, inspect, PAGES, wsListen };
