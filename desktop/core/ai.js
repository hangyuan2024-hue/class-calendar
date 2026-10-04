// 捞捞课程表 电脑版 · 本地 AI：第一次用时下载模型（可断点续传），之后在本机启动 llama-server，完全离线
// 这个文件只用 Node 自带的模块，方便在没有 Electron 的环境里单独测试
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

const MODEL = {
  id: "qwen2.5-1.5b-instruct",                     // 网页里显示的模型名
  name: "通义千问 Qwen2.5 1.5B",
  file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  // 先用国内的魔搭社区，不行再用 Hugging Face 国内镜像
  urls: [
    "https://www.modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  ],
  minBytes: 500 * 1024 * 1024,                      // 小于这个肯定是下载坏了
};
const PORT = 18086;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- 下载（断点续传，自动跟随跳转） ----------
function request(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "LaolaoKechengbiao-Desktop", ...headers }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error("跳转次数太多"));
        return resolve(request(new URL(res.headers.location, url).href, headers, redirects + 1));
      }
      resolve(res);
    });
    req.on("timeout", () => req.destroy(new Error("连接超时")));
    req.on("error", reject);
  });
}

// 下载到 dest；onProgress(已下载字节, 总字节)。signal.aborted = true 可以中途停下
async function downloadFile(url, dest, onProgress, signal = {}) {
  const part = dest + ".part";
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await request(url, have ? { Range: `bytes=${have}-` } : {});
  if (res.statusCode === 416) { res.resume(); have = 0; fs.rmSync(part, { force: true }); return downloadFile(url, dest, onProgress, signal); }
  if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); throw new Error(`服务器返回 ${res.statusCode}`); }
  if (res.statusCode === 200 && have) { have = 0; }                       // 服务器不支持续传：从头下
  const total = have + Number(res.headers["content-length"] || 0);
  const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
  let got = have, last = 0;
  await new Promise((resolve, reject) => {
    const check = setInterval(() => { if (signal.aborted) { res.destroy(new Error("已取消")); } }, 300);
    res.on("data", (c) => {
      got += c.length;
      const now = Date.now();
      if (now - last > 250) { last = now; onProgress && onProgress(got, total); }
    });
    res.on("error", (e) => { clearInterval(check); out.destroy(); reject(e); });
    out.on("error", (e) => { clearInterval(check); reject(e); });
    out.on("finish", () => { clearInterval(check); resolve(); });
    res.pipe(out);
  });
  onProgress && onProgress(got, total);
  if (total && got < total) throw new Error("下载中断了，再试一次会接着下");
  fs.renameSync(part, dest);
  return dest;
}

// 模型文件是不是完整的（大小够、文件头是 GGUF）
function modelOk(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MODEL.minBytes) return false;
    const fd = fs.openSync(file, "r"); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
    return b.toString("ascii") === "GGUF";
  } catch (e) { return false; }
}

// 依次试几个下载地址
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
        fs.rmSync(dest, { force: true }); fs.rmSync(dest + ".part", { force: true });
        throw new Error("下载的文件不对");
      } catch (e) {
        lastErr = e;
        if (signal.aborted) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("下载失败");
}

// ---------- 本地 AI 服务 ----------
function getJSON(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(s || "null") }); } catch (e) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve({ status: 0, body: null }));
  });
}

// 启动 llama-server，等它把模型加载好。exe：llama-server 的路径
async function startServer(exe, modelFile, { log, timeoutMs = 120000 } = {}) {
  const cpus = Math.max(2, Math.min(8, require("os").cpus().length - 1));
  const args = ["-m", modelFile, "--host", "127.0.0.1", "--port", String(PORT), "-c", "8192", "-t", String(cpus),
    "--alias", MODEL.id, "--no-webui"];
  let child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let errText = "";
  const onOut = (d) => { const s = String(d); errText = (errText + s).slice(-2000); log && log(s); };
  child.stdout.on("data", onOut); child.stderr.on("data", onOut);
  let exited = false; child.on("exit", () => { exited = true; });
  // 旧版本 llama-server 不认识 --no-webui：去掉再启动一次
  await new Promise((r) => setTimeout(r, 1200));
  if (exited && /no-webui|unknown argument|invalid argument/i.test(errText)) {
    child = spawn(exe, args.filter((a) => a !== "--no-webui"), { cwd: path.dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    exited = false; child.stdout.on("data", onOut); child.stderr.on("data", onOut); child.on("exit", () => { exited = true; });
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited) throw new Error("AI 程序启动失败：" + errText.split("\n").filter(Boolean).slice(-3).join(" / "));
    const h = await getJSON(BASE + "/health", 1500);
    if (h.status === 200) return child;
    await new Promise((r) => setTimeout(r, 600));
  }
  try { child.kill(); } catch (e) {}
  throw new Error("AI 程序启动太慢，电脑可能内存不够");
}

// 和本地模型聊天（流式）：onToken(到目前为止的全文)；返回完整回答。abort() 可以中途停
function chat(messages, onToken, { temperature = 0.6, maxTokens = 1024 } = {}) {
  let req = null, stopped = false;
  const p = new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL.id, messages, stream: true, temperature, max_tokens: maxTokens });
    req = http.request(BASE + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("AI 返回 " + res.statusCode)); }
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
    req.on("error", (e) => (stopped ? resolve("") : reject(new Error("连不上 AI：" + e.message))));
    req.end(body);
  });
  p.abort = () => { stopped = true; try { req && req.destroy(); } catch (e) {} };
  return p;
}

module.exports = { MODEL, PORT, BASE, downloadFile, downloadModel, modelOk, startServer, getJSON, chat };
