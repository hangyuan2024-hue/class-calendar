// 捞捞编程 · 下载（断点续传、自动跟随跳转）。和捞捞课程表电脑版的 core/ai.js 是同一套写法
"use strict";
const fs = require("fs");
const http = require("http");
const https = require("https");

function request(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "LaolaoCode-Desktop", ...headers }, timeout: 30000 }, (res) => {
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

async function fetchText(url, timeoutMs = 15000) {
  const res = await Promise.race([request(url, {}), new Promise((_, rej) => setTimeout(() => rej(new Error("连接超时")), timeoutMs))]);
  if (res.statusCode !== 200) { res.resume(); throw new Error("服务器返回 " + res.statusCode); }
  let s = ""; res.setEncoding("utf8");
  for await (const c of res) { s += c; if (s.length > 4e6) break; }
  return s;
}

// 下载到 dest；onProgress(已下载字节, 总字节)；signal.aborted = true 可以中途停下
async function downloadFile(url, dest, onProgress, signal = {}) {
  const part = dest + ".part";
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await request(url, have ? { Range: `bytes=${have}-` } : {});
  if (res.statusCode === 416) { res.resume(); fs.rmSync(part, { force: true }); return downloadFile(url, dest, onProgress, signal); }
  if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); throw new Error(`服务器返回 ${res.statusCode}`); }
  if (res.statusCode === 200 && have) have = 0;   // 服务器不支持续传：从头下
  const total = have + Number(res.headers["content-length"] || 0);
  const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
  let got = have, last = 0;
  await new Promise((resolve, reject) => {
    const check = setInterval(() => { if (signal.aborted) res.destroy(new Error("已取消")); }, 300);
    res.on("data", (c) => { got += c.length; const now = Date.now(); if (now - last > 250) { last = now; onProgress && onProgress(got, total); } });
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

module.exports = { request, fetchText, downloadFile };
