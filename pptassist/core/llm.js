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

  const files = () => {
    const out = {};
    for (const k of ["main", "mmproj"]) {
      let f = null; try { f = fs.readdirSync(dir).filter((n) => MODEL[k].test(n)).map((n) => path.join(dir, n)).find((p) => isGguf(p, opt.minBytes != null ? opt.minBytes : MODEL[k].minBytes)); } catch (e) {}
      out[k] = f || null;
    }
    return out;
  };
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
    fs.mkdirSync(dir, { recursive: true });
    const have = files(), todo = (await plan()).filter((x) => !have[x.k]);
    for (let i = 0; i < todo.length; i++) {
      const x = todo[i];
      await DL.download(x.urls, path.join(dir, x.name), { fetch: doFetch, signal, log: addLog, want: { size: x.size, sha256: x.sha256 }, onProg: (p) => onProg && onProg({ ...p, name: x.name, i, n: todo.length }) });
    }
    return files();
  }

  async function start() {
    if (state.status === "ready" && (await getJSON(`http://127.0.0.1:${port}/health`, 1500)).status === 200) return state;
    if (starting) return starting;
    starting = (async () => {
      const f = files();
      if (!f.main || !f.mmproj) { set("need-model", "AI 助手的模型还没下载（约 3G）"); throw new Error("先下载 AI 助手的模型（约 3G）"); }
      if (!exe || !fs.existsSync(exe)) { set("missing", "这个版本没带本地模型程序（llama-server），重新下载安装包试试"); throw new Error("这个版本没带本地模型程序（llama-server）"); }
      const h0 = await getJSON(`http://127.0.0.1:${port}/health`, 800);
      if (h0.status === 200) { set("ready", MODEL.name); return state; }
      set("starting", "正在启动 AI 助手（第一次要一会儿）");
      const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
      const args = ["-m", f.main, "--mmproj", f.mmproj, "--host", "127.0.0.1", "--port", String(port), "-c", String(opt.ctx || 16384), "-t", String(threads), "-ngl", "99", "--jinja", "--alias", MODEL.id, "--no-webui"];
      let err = "", exited = false;
      const launch = (a) => launchWith(exe, a);
      const launchWith = (bin, a) => { const c = spawn(bin, a, { cwd: path.dirname(bin), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); exited = false; c.stdout.on("data", (d) => { addLog(d); err = (err + d).slice(-3000); }); c.stderr.on("data", (d) => { addLog(d); err = (err + d).slice(-3000); }); c.on("exit", () => { exited = true; if (child === c) { child = null; if (state.status === "ready") set("off", "AI 助手停了"); } }); c.on("error", (e) => { err += e.message; exited = true; }); return c; };
      child = launch(args);
      await new Promise((r) => setTimeout(r, 1200));
      if (exited && /no-webui|unknown argument|invalid argument/i.test(err)) child = launch(args.filter((a) => a !== "--no-webui"));
      const t0 = Date.now();
      while (Date.now() - t0 < (opt.timeoutMs || 180000)) {
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
  function chat(messages, { tools, onDelta, temperature = 0.3, maxTokens = 1500 } = {}) {
    let req = null, stopped = false;
    const p = new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: MODEL.id, messages, stream: true, temperature, max_tokens: maxTokens, ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}) });
      req = http.request(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
        if (res.statusCode !== 200) { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => reject(new Error("AI 助手出错（" + res.statusCode + "）：" + s.slice(0, 300)))); return; }
        let buf = "", content = ""; const calls = [];
        res.setEncoding("utf8");
        const line = (l) => {
          l = l.trim(); if (!l.startsWith("data:")) return;
          const d = l.slice(5).trim(); if (d === "[DONE]") return;
          let j; try { j = JSON.parse(d); } catch (e) { return; }
          const delta = ((j.choices || [])[0] || {}).delta || {};
          if (delta.content) { content += delta.content; onDelta && onDelta(delta.content); }
          for (const tc of delta.tool_calls || []) {
            const k = tc.index != null ? tc.index : calls.length;
            calls[k] = calls[k] || { id: tc.id || "call_" + k, type: "function", function: { name: "", arguments: "" } };
            if (tc.id) calls[k].id = tc.id;
            if (tc.function && tc.function.name) calls[k].function.name += tc.function.name;
            if (tc.function && tc.function.arguments) calls[k].function.arguments += tc.function.arguments;
          }
        };
        res.on("data", (chunk) => { buf += chunk; const ls = buf.split("\n"); buf = ls.pop(); ls.forEach(line); });
        const end = () => { if (buf) line(buf); buf = ""; resolve(finish(content, calls.filter(Boolean))); };
        res.on("end", end); res.on("close", end);
        res.on("error", (e) => (stopped ? end() : reject(e)));
      });
      req.on("error", (e) => (stopped ? resolve(finish("", [])) : reject(new Error("连不上 AI 助手：" + e.message))));
      req.end(body);
    });
    p.abort = () => { stopped = true; try { req && req.destroy(); } catch (e) {} };
    return p;
  }
  return { start, stop, chat, download, plan, files, ready, state: () => state, log, port };
}

// 模型没走「工具调用」接口、把调用写在正文里（<tool_call>{…}</tool_call>）：也认出来
function finish(content, calls) {
  if (calls.length || !/<tool_call>/.test(content)) return { content: content.trim(), tool_calls: calls };
  const out = [];
  const text = content.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, j) => {
    try { const o = JSON.parse(j); out.push({ id: "call_t" + out.length, type: "function", function: { name: o.name, arguments: JSON.stringify(o.arguments || o.parameters || {}) } }); } catch (e) {}
    return "";
  });
  return { content: text.trim(), tool_calls: out };
}

module.exports = { create, MODEL, PORT, finish, getJSON };
