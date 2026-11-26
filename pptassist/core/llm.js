// 捞捞PPT助手 · 本地大模型：llama.cpp（llama-server，跟着安装包走）+ 通义千问 Qwen3-VL-4B（Apache-2.0，能看图，约 3G）
//   全部在老师电脑上跑：有显卡（NVIDIA / AMD / Intel，Vulkan）用显卡，没有就用 CPU（慢一点也能用）。
//   模型从国内存储下载（清单见 core/mirror.js），没有再走 hf-mirror.com / 魔搭。
//   chat()：OpenAI 兼容的 /v1/chat/completions，流式；带工具（function calling），也认 Qwen 写在正文里的 <tool_call>。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { spawn } = require("child_process");
const DL = require("./dl");
const CHAT = require("./chat");

const MODEL = {
  id: "qwen3-vl-4b",
  name: "通义千问 Qwen3-VL-4B（能看图）",
  repo: "Qwen/Qwen3-VL-4B-Instruct-GGUF",
  // 文件名到时候按仓库列表挑（不同时间发布的命名可能不一样）
  main: { mirrorKey: "llmMain", test: (n) => /\.gguf$/i.test(n) && !/mmproj/i.test(n), prefer: ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q8_0"], minBytes: 1.5e9, size: 2.5e9 },
  mmproj: { mirrorKey: "llmMmproj", test: (n) => /mmproj/i.test(n) && /\.gguf$/i.test(n), prefer: ["F16", "Q8_0", "BF16"], minBytes: 2e8, size: 0.8e9 },
  license: "Apache-2.0",
};
const PORT = 18097;   // 捞捞编程用 18096，捞捞课程表电脑版用 18086
const HF = ["https://hf-mirror.com", "https://huggingface.co"];
const MS = "https://www.modelscope.cn/models";

function getJSON(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(s || "null") }); } catch (e) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve({ status: 0, body: null }));
  });
}
const isGguf = (f, min) => { try { if (fs.statSync(f).size < min) return false; const fd = fs.openSync(f, "r"), b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString("ascii") === "GGUF"; } catch (e) { return false; } };

function create(opt = {}) {
  const dir = opt.dir;                      // 模型放在哪（用户目录/llm）
  const exe = opt.exe;                      // llama-server 在哪
  const port = opt.port || PORT;
  const doFetch = opt.fetch || fetch;
  const hf = opt.hf || HF;
  let child = null, state = { status: "off", msg: "" }, starting = null;
  const log = [];
  const addLog = (s) => { for (const l of String(s).split(/\r?\n/)) if (l.trim()) { log.push(l); if (log.length > 80) log.shift(); } };
  const set = (status, msg = "") => { state = { status, msg }; opt.onState && opt.onState(state); };

  // 共用的模型仓库（core/modelstore.js）：先看仓库，再看自己的 llm 文件夹；新下的下进仓库
  const store = opt.store || null;
  const dirs = () => [store ? (() => { try { return store.dir(); } catch (e) { return null; } })() : null, dir].filter(Boolean);
  const files = () => {
    const out = {};
    for (const k of ["main", "mmproj"]) {
      let f = null;
      for (const d of dirs()) { try { f = fs.readdirSync(d).filter((n) => MODEL[k].test(n)).map((n) => path.join(d, n)).find((p) => isGguf(p, opt.minBytes != null ? opt.minBytes : MODEL[k].minBytes)); } catch (e) {} if (f) break; }
      out[k] = f || null;
    }
    return out;
  };
  // 以前下在自己 llm 文件夹里的：收进仓库（仓库里已经有一样的就删掉这份）
  let swept = false;
  const sweep = () => { if (swept || !store) return; swept = true; try { store.sweep([dir]); } catch (e) {} };
  const ready = () => { const f = files(); return !!(f.main && f.mmproj); };

  // 要下载的文件：国内存储清单 → Hugging Face 镜像的列表（挑量化）→ 默认名字
  async function plan() {
    const out = [];
    let tree = null;
    for (const h of hf) { try { const r = await doFetch(`${h}/api/models/${MODEL.repo}/tree/main`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { tree = (await r.json()).filter((x) => x.type === "file"); break; } } catch (e) {} }
    for (const k of ["main", "mmproj"]) {
      const m = MODEL[k];
      const cn = opt.mirror ? (await opt.mirror.model(m.mirrorKey).catch(() => []))[0] : null;
      let name = cn && cn.name, size = cn ? cn.size : 0, sha256 = cn ? cn.sha256 : "";
      if (!name && tree) {
        const cands = tree.filter((x) => m.test(x.path));
        const hit = m.prefer.map((w) => cands.find((x) => x.path.includes(w))).find(Boolean) || cands[0];
        if (hit) { name = hit.path; size = (hit.lfs && hit.lfs.size) || hit.size || 0; }
      }
      if (!name) name = k === "main" ? "Qwen3VL-4B-Instruct-Q4_K_M.gguf" : "mmproj-Qwen3VL-4B-Instruct-F16.gguf";
      out.push({ k, name, size, sha256, urls: [cn && cn.url, ...hf.map((h) => `${h}/${MODEL.repo}/resolve/main/${name}`), `${MS}/${MODEL.repo}/resolve/master/${name}`].filter(Boolean) });
    }
    return out;
  }
  async function download(onProg, signal) {
    sweep();
    const to = store ? store.dir() : dir;
    fs.mkdirSync(to, { recursive: true });
    const have = files(), todo = (await plan()).filter((x) => !have[x.k]);
    for (let i = 0; i < todo.length; i++) {
      const x = todo[i];
      await DL.download(x.urls, path.join(to, x.name), { fetch: doFetch, signal, log: addLog, want: { size: x.size, sha256: x.sha256 }, onProg: (p) => onProg && onProg({ ...p, name: x.name, i, n: todo.length }) });
    }
    return files();
  }

  async function start() {
    if (state.status === "ready" && (await getJSON(`http://127.0.0.1:${port}/health`, 1500)).status === 200) return state;
    if (starting) return starting;
    starting = (async () => {
      sweep();
      const f = files();
      if (store) { try { if (f.main) store.used(path.basename(f.main)); if (f.mmproj) store.used(path.basename(f.mmproj)); } catch (e) {} }
      if (!f.main || !f.mmproj) { set("need-model", "AI 助手的模型还没下载（约 3G）"); throw new Error("先下载 AI 助手的模型（约 3G）"); }
      if (!exe || !fs.existsSync(exe)) { set("missing", "这个版本没带本地模型程序（llama-server），重新下载安装包试试"); throw new Error("这个版本没带本地模型程序（llama-server）"); }
      const h0 = await getJSON(`http://127.0.0.1:${port}/health`, 800);
      if (h0.status === 200) { set("ready", MODEL.name); return state; }
      set("starting", "正在启动 AI 助手（第一次要一会儿）");
      const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
      let args = ["-m", f.main, "--mmproj", f.mmproj, "--host", "127.0.0.1", "--port", String(port), "-c", String(opt.ctx || 16384), "-t", String(threads), "-ngl", "99", "--jinja", "--alias", MODEL.id, "--no-webui"];
      // 捞捞自己训练的答题 LoRA（捞捞算力每天训练、考试通过才发布）：有就带上
      const lora = opt.lora ? opt.lora() : null;
      if (lora && fs.existsSync(lora)) args.push("--lora", lora);
      let err = "", exited = false;
      const launch = (a) => launchWith(exe, a);
      const launchWith = (bin, a) => { const c = spawn(bin, a, { cwd: path.dirname(bin), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); exited = false; c.stdout.on("data", (d) => { addLog(d); err = (err + d).slice(-3000); }); c.stderr.on("data", (d) => { addLog(d); err = (err + d).slice(-3000); }); c.on("exit", () => { exited = true; if (child === c) { child = null; if (state.status === "ready") set("off", "AI 助手停了"); } }); c.on("error", (e) => { err += e.message; exited = true; }); return c; };
      child = launch(args);
      await new Promise((r) => setTimeout(r, 1200));
      if (exited && /no-webui|unknown argument|invalid argument/i.test(err)) child = launch(args.filter((a) => a !== "--no-webui"));
      const t0 = Date.now();
      while (Date.now() - t0 < (opt.timeoutMs || 180000)) {
        if (exited && args.includes("--lora") && !err.includes("NOLORA")) {
          // 带上 LoRA 起不来：先不带，退回上一版（下次再试新的）
          err += "NOLORA"; const i = args.indexOf("--lora"); args = args.filter((x, k) => k !== i && k !== i + 1);
          try { opt.onLoraFail && opt.onLoraFail(); } catch (e) {}
          child = launch(args); await new Promise((r) => setTimeout(r, 1200)); continue;
        }
        if (exited) {
          // 显卡用不了（驱动太旧、没有 Vulkan）：换 CPU 版、不用显卡再试一次
          if (!err.includes("RETRIED")) {
            err += "RETRIED"; const a2 = args.filter((x, i) => x !== "-ngl" && args[i - 1] !== "-ngl");
            const cpu = opt.exeCpu && fs.existsSync(opt.exeCpu) ? opt.exeCpu : exe;
            child = launchWith(cpu, a2); await new Promise((r) => setTimeout(r, 1200)); continue;
          }
          set("error", "AI 助手启动失败"); throw new Error("AI 助手启动失败：" + err.split("\n").filter(Boolean).slice(-3).join(" / "));
        }
        if ((await getJSON(`http://127.0.0.1:${port}/health`, 1500)).status === 200) { set("ready", MODEL.name); return state; }
        await new Promise((r) => setTimeout(r, 700));
      }
      stop(); set("error", "启动太慢"); throw new Error("AI 助手启动太慢：电脑内存可能不够（要 6G 以上空闲内存）");
    })();
    try { return await starting; } finally { starting = null; }
  }
  function stop() { if (child) { try { child.kill(); } catch (e) {} child = null; } if (state.status !== "need-model") set("off", ""); }

  // 流式对话：onDelta(这一小段文字)；返回 { content, tool_calls }；p.abort() 停下
  const chat = (messages, opt = {}) => CHAT.chatAt(`http://127.0.0.1:${port}`, messages, { model: MODEL.id, ...opt });
  return { start, stop, chat, download, plan, files, ready, state: () => state, log, port };
}

const finish = CHAT.finish;

module.exports = { create, MODEL, PORT, finish, getJSON };
