// 捞捞编程 · 本地模型「问捞捞」：安装包里自带 llama.cpp（llama-server）和 Qwen2.5-Coder 1.5B，完全离线。
// 安装包里没带模型时（开发版），第一次用会从国内镜像下载。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { spawn } = require("child_process");
const { downloadFile } = require("./net");

const MODEL = {
  id: "qwen2.5-coder-1.5b-instruct",
  name: "通义千问 Qwen2.5-Coder 1.5B",
  file: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
  urls: [
    "https://www.modelscope.cn/models/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/master/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    "https://hf-mirror.com/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
  ],
  minBytes: 500 * 1024 * 1024,
};
const PORT = 18096;   // 捞捞课程表电脑版用 18086，两个一起开也不打架
const BASE = `http://127.0.0.1:${PORT}`;

function modelOk(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MODEL.minBytes) return false;
    const fd = fs.openSync(file, "r"); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
    return b.toString("ascii") === "GGUF";
  } catch (e) { return false; }
}
// 模型在哪：安装包自带的优先，其次是下载到用户目录的
function findModel(dirs) {
  for (const d of dirs) { if (!d) continue; const f = path.join(d, MODEL.file); if (modelOk(f)) return f; }
  return null;
}
async function downloadModel(dir, onProgress, signal = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, MODEL.file);
  if (modelOk(dest)) return dest;
  let lastErr;
  for (const url of MODEL.urls) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new Error("已取消");
      try {
        await downloadFile(url, dest, onProgress, signal);
        if (modelOk(dest)) return dest;
        fs.rmSync(dest, { force: true }); throw new Error("下载的文件不对");
      } catch (e) { lastErr = e; if (signal.aborted) throw e; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
  }
  throw lastErr || new Error("下载失败");
}

function getJSON(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(s || "null") }); } catch (e) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve({ status: 0, body: null }));
  });
}

async function startServer(exe, modelFile, { log, timeoutMs = 120000, port = PORT } = {}) {
  const h0 = await getJSON(`http://127.0.0.1:${port}/health`, 800);
  if (h0.status === 200) return null;                       // 已经在跑了（上次没关掉）：直接用
  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const args = ["-m", modelFile, "--host", "127.0.0.1", "--port", String(port), "-c", "8192", "-t", String(threads), "--alias", MODEL.id, "--no-webui"];
  let errText = "", exited = false;
  const onOut = (d) => { const s = String(d); errText = (errText + s).slice(-2000); log && log(s); };
  const launch = (a) => { const c = spawn(exe, a, { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); exited = false; c.stdout.on("data", onOut); c.stderr.on("data", onOut); c.on("exit", () => { exited = true; }); c.on("error", (e) => { errText += e.message; exited = true; }); return c; };
  let child = launch(args);
  await new Promise((r) => setTimeout(r, 1200));
  if (exited && /no-webui|unknown argument|invalid argument/i.test(errText)) child = launch(args.filter((a) => a !== "--no-webui"));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited) throw new Error("本地模型启动失败：" + errText.split("\n").filter(Boolean).slice(-3).join(" / "));
    const h = await getJSON(`http://127.0.0.1:${port}/health`, 1500);
    if (h.status === 200) return child;
    await new Promise((r) => setTimeout(r, 600));
  }
  try { child.kill(); } catch (e) {}
  throw new Error("本地模型启动太慢，电脑可能内存不够");
}

// 流式聊天：onToken(到目前为止的全文)；返回的 Promise 带 abort()
function chat(messages, onToken, { temperature = 0.4, maxTokens = 900, port = PORT } = {}) {
  let req = null, stopped = false;
  const p = new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL.id, messages, stream: true, temperature, max_tokens: maxTokens, repeat_penalty: 1.08 });
    req = http.request(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("本地模型返回 " + res.statusCode)); }
      let buf = "", full = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n"); buf = lines.pop();
        for (let line of lines) {
          line = line.trim(); if (!line.startsWith("data:")) continue;
          const d = line.slice(5).trim(); if (d === "[DONE]") continue;
          try { const piece = ((JSON.parse(d).choices || [])[0] || {}).delta || {}; if (piece.content) { full += piece.content; onToken && onToken(full); } } catch (e) {}
        }
      });
      res.on("end", () => resolve(full));
      res.on("close", () => resolve(full));
      res.on("error", (e) => (stopped ? resolve(full) : reject(e)));
    });
    req.on("error", (e) => (stopped ? resolve("") : reject(new Error("连不上本地模型：" + e.message))));
    req.end(body);
  });
  p.abort = () => { stopped = true; try { req && req.destroy(); } catch (e) {} };
  return p;
}

module.exports = { MODEL, PORT, BASE, modelOk, findModel, downloadModel, startServer, chat, getJSON };
