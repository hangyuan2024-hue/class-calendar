// 捞捞 · 安装包中转：GitHub 的打包机器在美国，往广州的存储传 100MB 以上的安装包经常 3 分钟传不完（UserNetworkTooSlow / 超时），
// 结果新版本一直只能从 GitHub 下。这台调度中心在香港，连 GitHub、连广州都快：由它来搬。
//   · 每 10 分钟看一眼 GitHub 上的版本文件（download/desktop-version.json 等）
//   · 国内地址指向下载门口、但存储里还没有这个文件（或者大小不对）→ 从 GitHub 下载 → 核对 sha256 → 传到存储
//   · 搬好之前，下载门口先把人转去 GitHub（不让人看到 404）；搬好以后自动走国内存储
// 要一把「只能往这几个文件夹写」的密钥（DLW_COS_KEY_ID / DLW_COS_SECRET，见 dl-relay.sh）；没配就只看不搬。
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const Store = require("./store");

const APPS = ["desktop", "code", "ppt", "grid"];
// 打包流程传的时候用的名字（.github/workflows/*.yaml 里 cn-upload.sh 的第二个参数），版本文件里国内地址是空的时候按这个补
const KEY_OF = { desktop: (v) => `desktop/LaolaoKechengbiao-Setup-${v}.exe`, code: (v) => `code/LaolaoCode-Setup-${v}.exe`, ppt: (v) => `ppt/LaolaoPPT-Setup-${v}.exe`, grid: (v) => `grid/LaolaoGrid-Setup-${v}.exe` };

function create(o) {
  const env = o.env || process.env;
  const E = (k) => env["DL_" + k] || env["GRID_" + k] || "";
  const cos = { endpoint: E("COS_ENDPOINT"), region: E("COS_REGION"), bucket: E("COS_BUCKET") };
  const readKey = { keyId: E("COS_KEY_ID"), secret: E("COS_SECRET") }, writeKey = { keyId: env.DLW_COS_KEY_ID || "", secret: env.DLW_COS_SECRET || "" };
  const canWrite = !!(cos.endpoint && cos.bucket && writeKey.keyId && writeKey.secret);
  const raw = (env.DL_REPO_RAW || "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main").replace(/\/+$/, "");
  const base = (env.DL_BASE || "https://dl.laolaokechengbiao.cn/dl").replace(/\/+$/, "") + "/";
  const dir = path.join(o.dataDir, "dl", "relay"); fs.mkdirSync(dir, { recursive: true });
  const doFetch = o.fetch || fetch;
  const log = o.log || (() => {});
  const presign = o.presign || ((method, key, ttl, w) => Store.presign({ ...cos, ...(w ? writeKey : readKey), method, key, ttl }));
  const put = o.put || putFile;
  // key → { app, version, url（GitHub）, size, sha256, state: ok / missing / copying / failed, why }
  const known = new Map();
  let running = null, lastRun = 0;

  async function manifest(app) {
    try { const r = await doFetch(`${raw}/download/${app}-version.json?t=${Date.now()}`, { signal: AbortSignal.timeout(20000), cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  async function cosSize(key) {
    try { const r = await doFetch(presign("HEAD", key, 300, false), { method: "HEAD", signal: AbortSignal.timeout(15000) }); if (r.status === 404 || r.status === 403) return -1; return r.ok ? +(r.headers.get("content-length") || 0) : null; } catch (e) { return null; }
  }
  // 从 GitHub 下到本地，边下边算 sha256
  async function download(url, file, want) {
    const r = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(60 * 60e3) });
    if (!r.ok || !r.body) throw new Error("从 GitHub 下载失败：" + r.status);
    const h = crypto.createHash("sha256"), out = fs.createWriteStream(file);
    let n = 0;
    for await (const chunk of r.body) { h.update(chunk); n += chunk.length; if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok)); }
    await new Promise((ok, bad) => out.end((e) => (e ? bad(e) : ok())));
    const sha = h.digest("hex");
    if (want.size && n !== want.size) throw new Error(`下载的大小不对：${n}，应该是 ${want.size}`);
    if (want.sha256 && sha !== String(want.sha256).toLowerCase()) throw new Error("下载的文件 sha256 对不上（可能下坏了），不传");
    return n;
  }
  // 整个文件一次 PUT 上去（预签名的临时地址；最大 5GB，安装包够用）
  function putFile(url, file, size) {
    return new Promise((ok, bad) => {
      const u = new URL(url), mod = u.protocol === "https:" ? https : http;
      const req = mod.request(u, { method: "PUT", headers: { "content-length": size, "content-type": "application/octet-stream" }, timeout: 30 * 60e3 }, (res) => {
        let b = ""; res.on("data", (c) => { if (b.length < 2000) b += c; }); res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300 ? ok() : bad(new Error(`传到存储失败：${res.statusCode} ${(/<Code>([^<]+)/.exec(b) || [])[1] || ""}`))));
      });
      req.on("timeout", () => req.destroy(new Error("传到存储超时")));
      req.on("error", bad);
      fs.createReadStream(file).on("error", bad).pipe(req);
    });
  }
  async function copy(key, it) {
    it.state = "copying"; it.why = ""; it.at = Date.now();
    const tmp = path.join(dir, key.replace(/[^\w.-]/g, "_") + ".part");
    try {
      log(`安装包中转：${key} 存储里还没有，从 GitHub 搬过来（${Math.round((it.size || 0) / 1048576)}MB）`);
      const n = await download(it.url, tmp, it);
      await put(presign("PUT", key, 3 * 3600, true), tmp, n);
      it.state = "ok"; it.done = Date.now();
      log(`安装包中转：${key} 搬好了，国内下载走存储（用了 ${Math.round((it.done - it.at) / 1000)} 秒）`);
    } catch (e) { it.state = "failed"; it.why = e.message; log(`安装包中转：${key} 没搬成：${e.message}（10 分钟后再试）`); }
    finally { fs.rm(tmp, { force: true }, () => {}); }
  }

  async function run() {
    if (running) return running;
    running = (async () => {
      lastRun = Date.now();
      if (!cos.endpoint || !cos.bucket || !readKey.keyId) return status();   // 没配存储：什么都不做
      for (const app of APPS) {
        const m = await manifest(app);
        if (!m || !m.version || !/^https?:\/\//.test(m.url || "")) continue;
        const key = m.cn && m.cn.startsWith(base) ? decodeURIComponent(m.cn.slice(base.length)) : KEY_OF[app](m.version);
        const it = known.get(key) || { app, version: m.version, url: m.url, size: +m.size || 0, sha256: m.sha256 || "", state: "?", inManifest: !!(m.cn && m.cn.startsWith(base)) };
        Object.assign(it, { url: m.url, size: +m.size || it.size, sha256: m.sha256 || it.sha256, inManifest: !!(m.cn && m.cn.startsWith(base)) });
        known.set(key, it);
        if (it.state === "copying") continue;
        const have = await cosSize(key);
        if (have != null && have > 0 && (!it.size || have === it.size)) { it.state = "ok"; continue; }
        if (have == null) { it.state = "?"; it.why = "问不到存储"; continue; }
        it.state = "missing";
        if (canWrite) await copy(key, it); else it.why = "还没配中转用的写入密钥（DLW_COS_*），搬不了";
      }
      return status();
    })().finally(() => { running = null; });
    return running;
  }
  // 下载门口问：这个文件存储里没有，先转去哪（GitHub 的原地址）；顺便催一下中转
  function fallbackOf(key) {
    const it = known.get(key);
    if (it && it.state !== "ok") { if (!running && Date.now() - lastRun > 60e3) run().catch(() => {}); return it.url; }
    if (!it && !running && Date.now() - lastRun > 60e3) run().catch(() => {});
    return null;
  }
  const status = () => ({ canWrite, lastRun, files: [...known.entries()].map(([key, v]) => ({ key, app: v.app, version: v.version, state: v.state, why: v.why || "", inManifest: v.inManifest, size: v.size })) });

  const timer = o.noTimer ? null : setInterval(() => run().catch(() => {}), o.everyMs || 10 * 60e3);
  if (timer && timer.unref) timer.unref();
  if (!o.noTimer) setTimeout(() => run().catch(() => {}), 30000).unref();
  return { run, status, fallbackOf, close() { clearInterval(timer); }, KEY_OF };
}

module.exports = { create, KEY_OF, APPS };
