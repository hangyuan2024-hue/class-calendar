// 下载大文件：断点续传（先写 .part，下完再改名）、换地址重试、报速度；可以校验大小和 sha256。
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// urls：按顺序试（国内存储在前）；onProg({ got, total, speed, done })；want：{ size, sha256 }
async function download(urls, dest, { fetch: doFetch = fetch, onProg, signal, log, want = {} } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (want.size && fs.existsSync(dest) && fs.statSync(dest).size === want.size) return dest;   // 已经下好了
  const part = dest + ".part";
  let lastErr = null;
  for (const u of urls.filter(Boolean)) {
    // GitHub 上超过 2G 的切成了几块：{ parts: [地址1, 地址2…] }，每块单独下（能续传），下完按顺序接起来
    if (typeof u === "object") {
      if (!u.parts || !u.parts.length) continue;
      try { await downloadParts(u.parts, dest, { fetch: doFetch, onProg, signal, log, total: want.size }); } catch (e) { lastErr = e; if (signal && signal.aborted) throw e; log && log("从 GitHub 分块下载出错：" + e.message); continue; }
    }
    else for (let attempt = 0; attempt < 3; attempt++) {
      if (signal && signal.aborted) throw new Error("已经停了");
      let have = 0; try { have = fs.statSync(part).size; } catch (e) {}
      if (want.size && have > want.size) { fs.rmSync(part, { force: true }); have = 0; }
      try {
        if (want.size && have === want.size) { fs.renameSync(part, dest); break; }
        const r = await doFetch(u, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: "follow" });
        if (r.status === 416) { fs.renameSync(part, dest); break; }
        if (!r.ok) throw new Error(`${r.status}`);
        if (have && r.status !== 206) have = 0;   // 不支持续传：从头下
        const total = have + (+r.headers.get("content-length") || 0);
        const out = fs.createWriteStream(part, { flags: have ? "a" : "w" });
        let got = have, t = Date.now(), tGot = got, speed = 0;
        try {
          for await (const chunk of r.body) {
            if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok));
            got += chunk.length;
            const now = Date.now();
            if (now - t > 1000) { speed = ((got - tGot) * 1000) / (now - t); t = now; tGot = got; onProg && onProg({ got, total: want.size || total, speed }); }
          }
        } finally { await new Promise((ok) => out.end(ok)); }
        if ((want.size && got < want.size) || (total && got < total)) throw new Error("没下完");
        fs.renameSync(part, dest);
        onProg && onProg({ got, total: want.size || total || got, speed, done: true });
        break;
      } catch (e) {
        lastErr = e;
        if (signal && signal.aborted) throw new Error("已经停了");
        log && log(`下载出错（${u.replace(/^https?:\/\/([^/]+).*/, "$1")}）：${e.message}`);
        await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
      }
    }
    if (fs.existsSync(dest)) {
      if (want.size && fs.statSync(dest).size !== want.size) { fs.rmSync(dest, { force: true }); lastErr = new Error("大小不对"); continue; }
      if (want.sha256) {
        onProg && onProg({ checking: true });
        const h = await sha256(dest, signal);
        if (h !== want.sha256.toLowerCase()) { fs.rmSync(dest, { force: true }); lastErr = new Error("文件校验没通过（下载时出错了）"); continue; }
      }
      return dest;
    }
  }
  throw new Error("下载失败：" + (lastErr ? lastErr.message : "") + "（网络不好可以过一会儿再点，已经下的部分不会丢）");
}

async function downloadParts(parts, dest, { fetch: doFetch, onProg, signal, log, total = 0 }) {
  const dir = dest + ".parts";
  fs.mkdirSync(dir, { recursive: true });
  let before = 0;
  for (let i = 0; i < parts.length; i++) {
    const pf = path.join(dir, String(i + 1).padStart(3, "0"));
    await download([parts[i]], pf, { fetch: doFetch, signal, log, onProg: (m) => onProg && !m.done && onProg({ got: before + (m.got || 0), total, speed: m.speed }) });
    before += fs.statSync(pf).size;
  }
  const tmp = dest + ".part";
  fs.rmSync(tmp, { force: true });
  for (let i = 0; i < parts.length; i++) {
    const pf = path.join(dir, String(i + 1).padStart(3, "0"));
    await new Promise((ok, bad) => { const w = fs.createWriteStream(tmp, { flags: "a" }); fs.createReadStream(pf).on("error", bad).pipe(w).on("finish", ok).on("error", bad); });
  }
  fs.renameSync(tmp, dest);
  fs.rmSync(dir, { recursive: true, force: true });
  onProg && onProg({ got: before, total: total || before, done: true });
  return dest;
}

function sha256(file, signal) {
  return new Promise((ok, bad) => {
    const h = crypto.createHash("sha256"), s = fs.createReadStream(file, { highWaterMark: 4 << 20 });
    if (signal) signal.addEventListener("abort", () => { s.destroy(); bad(new Error("已经停了")); }, { once: true });
    s.on("data", (d) => h.update(d)); s.on("error", bad); s.on("end", () => ok(h.digest("hex")));
  });
}

// 这个文件夹所在的盘还剩多少字节
function freeBytes(dir) {
  try { let d = dir; while (!fs.existsSync(d)) d = path.dirname(d); const s = fs.statfsSync(d); return s.bavail * s.bsize; } catch (e) { return Infinity; }
}

module.exports = { download, sha256, freeBytes };
