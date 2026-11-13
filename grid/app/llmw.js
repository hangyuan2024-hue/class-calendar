// 捞捞算力 · 本地大模型（llama.cpp 的 llama-server，跟着安装包走；Vulkan 版，NVIDIA / AMD / Intel 显卡都能用）
//   配方开头写「# needs: llm」，任务参数里写用哪个模型：
//     "llm": { "name": "Qwen3-8B-Q4_K_M.gguf", "size": 5027783488, "urls": ["https://www.modelscope.cn/...", "https://hf-mirror.com/..."], "ctx": 16384, "slots": 2 }
//   第一次先下载（断点续传，换地址重试；魔搭在前：国内快，也不花你存储的流量费），然后在本机 127.0.0.1 开 llama-server，
//   配方拿到地址（task.json 的 llm），用 OpenAI 兼容的 /v1/chat/completions 提问。
//   和 AI 引擎（ComfyUI）抢显存：开大模型前先关 ComfyUI，开 ComfyUI 前先关大模型（service.js 里接好）。
//   不用的时候关掉（10 分钟没用、任务停了、你要用电脑了）。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 18298;

function ping(port) {
  return new Promise((ok) => {
    const r = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 2000 }, (res) => { res.resume(); ok(res.statusCode === 200); });
    r.on("timeout", () => r.destroy()); r.on("error", () => ok(false));
  });
}

function create(o) {
  const exe = o.exe;   // llama-server(.exe) 的路径；没有就跑不了
  const DL = o.dl || require(path.join(__dirname, "ppt", "dl.js"));
  const doSpawn = o.spawn || spawn;
  const port = o.port || PORT;
  let child = null, cur = null, idle = null, starting = null;
  const ok = () => !!(exe && fs.existsSync(exe));
  const dir = () => { const d = path.join(o.base(), "llm"); fs.mkdirSync(d, { recursive: true }); return d; };
  const safe = (n) => String(n || "").replace(/[^\w.\-]/g, "_");

  async function fetchModel(spec, say) {
    const name = safe(spec.name);
    if (!name || !/\.gguf$/i.test(name)) throw new Error("任务没说用哪个模型（llm.name）");
    const f = path.join(dir(), name);
    if (fs.existsSync(f) && (!spec.size || fs.statSync(f).size === spec.size)) return f;
    const urls = (spec.urls || []).filter((u) => /^https?:\/\//.test(u));
    if (!urls.length) throw new Error("任务没给模型的下载地址");
    let last = 0;
    say(`下载本地大模型 ${name}（第一次，约 ${spec.size ? (spec.size / 1e9).toFixed(1) + "G" : "几个 G"}；断了会接着下）`);
    await DL.download(urls, f, { want: { size: spec.size || 0, sha256: spec.sha256 || "" }, onProg: (p) => {
      if (!p.got || Date.now() - last < 3000) return; last = Date.now();
      const pct = p.total ? Math.floor((p.got / p.total) * 100) : 0;
      say(`下载本地大模型：${pct}%${p.speed ? `，${(p.speed / 1e6).toFixed(1)}M/秒` : ""}`);
    } });
    return f;
  }

  function bump() { clearTimeout(idle); idle = setTimeout(stop, o.idleMs || 10 * 60e3); idle.unref && idle.unref(); }

  // 笔记本常有两块显卡（Intel 集显 + NVIDIA 独显）：Vulkan 两块都看得见，只用独显（显存最大的那块）
  let devPick;
  function listDevices() {
    if (devPick !== undefined) return Promise.resolve(devPick);
    return new Promise((done) => {
      let out = "", p;
      const fin = () => {
        const devs = [...out.matchAll(/^\s*(Vulkan\d+)\s*:\s*(.+?)\s*\((\d+)\s*MiB/gm)].map((m) => ({ id: m[1], name: m[2], mib: +m[3] }));
        const best = devs.filter((d) => /nvidia|geforce|rtx|radeon rx|arc a/i.test(d.name)).sort((a, b) => b.mib - a.mib)[0] || devs.sort((a, b) => b.mib - a.mib)[0];
        devPick = devs.length > 1 && best ? best.id : null;
        done(devPick);
      };
      try { p = doSpawn(exe, ["--list-devices"], { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { devPick = null; return done(null); }
      const add = (d) => { out += d.toString("utf8"); };
      p.stdout && p.stdout.on("data", add); p.stderr && p.stderr.on("data", add);
      const t = setTimeout(() => { try { p.kill(); } catch (e) {} }, 20000);
      p.on("error", () => { clearTimeout(t); devPick = null; done(null); });
      p.on("exit", () => { clearTimeout(t); fin(); });
    });
  }

  function launch(file, spec, lite, dev) {
    const ctx = Math.max(2048, +spec.ctx || 16384), slots = Math.max(1, +spec.slots || 2);
    const args = ["-m", file, "--host", "127.0.0.1", "--port", String(port), "-ngl", "999", "-c", String(lite ? Math.min(ctx, 8192) : ctx), "-np", String(lite ? 1 : slots), "--jinja"];
    if (!lite) args.push("-ctk", "q8_0", "-ctv", "q8_0");   // 省一半显存（8G 显卡上下文才放得下）；不支持就退回去
    if (dev && !lite) args.push("--device", dev);
    const p = doSpawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (d) => { tail = (tail + d.toString("utf8")).slice(-2000); };
    p.stdout && p.stdout.on("data", keep); p.stderr && p.stderr.on("data", keep);
    p.tail = () => tail;
    return p;
  }

  // 开好（需要的话先下载），返回地址
  async function ensure(spec, say = () => {}) {
    if (!ok()) throw new Error("这台电脑的客户端里没有 llama.cpp（更新到新版客户端）");
    if (starting) await starting.catch(() => {});
    const key = safe(spec.name) + "|" + (spec.ctx || "") + "|" + (spec.slots || "");
    if (child && cur === key && (await ping(port))) { bump(); return `http://127.0.0.1:${port}`; }
    starting = (async () => {
      const file = await fetchModel(spec, say);
      stop();
      if (o.beforeStart) await o.beforeStart();   // 关掉 ComfyUI，让出显存
      const dev = await listDevices();
      if (dev) say(`用独立显卡（${dev}）`);
      for (const lite of [false, true]) {
        say(lite ? "换一种省事的方式再启动一次…" : "启动本地大模型（把模型放进显卡，大约半分钟）");
        child = launch(file, spec, lite, dev);
        const c = child;
        let dead = false;
        c.on("exit", () => { dead = true; if (child === c) child = null; });
        for (let i = 0; i < 240 && !dead; i++) { if (await ping(port)) { cur = key; bump(); return; } await new Promise((r) => setTimeout(r, 500)); }
        const why = c.tail ? c.tail().split(/\r?\n/).filter(Boolean).slice(-3).join(" / ") : "";
        try { c.kill(); } catch (e) {}
        child = null;
        if (lite) throw new Error("本地大模型没启动起来：" + why.slice(0, 300));
      }
    })();
    try { await starting; } finally { starting = null; }
    return `http://127.0.0.1:${port}`;
  }
  function stop() { clearTimeout(idle); if (child) { try { child.kill(); } catch (e) {} child = null; } cur = null; }
  return { ensure, stop, ok, running: () => !!child, PORT: port };
}

module.exports = { create, PORT };
