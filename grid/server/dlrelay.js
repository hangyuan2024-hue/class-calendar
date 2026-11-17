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
  const presign = o.presign || ((method, key, ttl, w, ep) => Store.presign({ ...cos, ...(ep ? { endpoint: ep } : {}), ...(w ? writeKey : readKey), method, key, ttl }));
  const put = o.put || putFile;
  // 香港 → 广州走公网，晚上跨境经常只剩十几 KB/s（148MB 要传两个多小时）。腾讯云存储桶开了「全球加速」时，
  // 走 cos.accelerate.myqcloud.com：在香港就进腾讯内网，再到广州，快很多（加速流量另收一点钱，约 0.5 元/GB）。
  // 先试加速；桶没开会马上报 BucketAccelerateNotEnabled，就退回普通地址（1 小时内不再试）。DL_ACCEL=0 关掉。
  const accelEp = /^https?:\/\//.test(env.DL_ACCEL || "") ? env.DL_ACCEL : env.DL_ACCEL !== "0" && /myqcloud\.com/.test(cos.endpoint) ? "https://cos.accelerate.myqcloud.com" : "";
  let accelOffUntil = 0;
  const minKBps = +env.DL_MIN_KBPS || 100, slowSecs = +env.DL_SLOW_SECS || 120;   // 传了 2 分钟平均还不到这个速度：停下，说清楚原因（不然一个文件能卡几个小时）
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
  // 进度：每过 10% 记一行日志（journalctl 和控制中心「动态」里能看到），status() 里随时有百分比和速度
  const fmtSpeed = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + "MB/s" : Math.round(b / 1024) + "KB/s");
  function tick(it, n, total) {
    it.got = n; const now = Date.now();
    if (!it.t0) { it.t0 = now; it.ts = now; it.nPrev = 0; }
    // 每 2 秒按这 2 秒传了多少算一次速度（刚开始那一下不算：会把缓冲区一下子塞满，看着特别快）
    if (now - it.ts >= 2000) { it.speed = Math.round(((n - it.nPrev) / (now - it.ts)) * 1000); it.ts = now; it.nPrev = n; }
    const pct = total ? Math.floor((n / total) * 100) : 0, step = Math.floor(pct / 10);
    if (total && step > (it.step || 0)) { it.step = step; log(`安装包中转：${it.key} ${it.phase}${it.via && it.phase !== "从 GitHub 下载" ? "（" + it.via + "）" : ""} ${pct}%（${Math.round(n / 1048576)}/${Math.round(total / 1048576)}MB${it.speed ? "，" + fmtSpeed(it.speed) : ""}）`); }
  }
  async function download(url, file, want, it) {
    const r = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(60 * 60e3) });
    if (!r.ok || !r.body) throw new Error("从 GitHub 下载失败：" + r.status);
    const h = crypto.createHash("sha256"), out = fs.createWriteStream(file);
    let n = 0;
    for await (const chunk of r.body) { h.update(chunk); n += chunk.length; if (it) tick(it, n, want.size); if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok)); }
    await new Promise((ok, bad) => out.end((e) => (e ? bad(e) : ok())));
    const sha = h.digest("hex");
    if (want.size && n !== want.size) throw new Error(`下载的大小不对：${n}，应该是 ${want.size}`);
    if (want.sha256 && sha !== String(want.sha256).toLowerCase()) throw new Error("下载的文件 sha256 对不上（可能下坏了），不传");
    return n;
  }
  // 整个文件一次 PUT 上去（预签名的临时地址；最大 5GB，安装包够用）
  function putFile(url, file, size, it) {
    return new Promise((ok, bad) => {
      const u = new URL(url), mod = u.protocol === "https:" ? https : http;
      let n = 0;
      const req = mod.request(u, { method: "PUT", headers: { "content-length": size, "content-type": "application/octet-stream" }, timeout: 30 * 60e3 }, (res) => {
        let b = ""; res.on("data", (c) => { if (b.length < 2000) b += c; }); res.on("end", () => { clearInterval(watch); const code = (/<Code>([^<]+)/.exec(b) || [])[1] || ""; if (res.statusCode >= 200 && res.statusCode < 300) ok(); else { const e = new Error(`传到存储失败：${res.statusCode} ${code}`); e.code = code; bad(e); } });
      });
      const t0 = Date.now();
      const watch = setInterval(() => {
        const sec = (Date.now() - t0) / 1000, kbps = n / 1024 / sec;
        if (sec >= slowSecs && kbps < minKBps) { const e = new Error(`香港往广州存储传得太慢（平均 ${kbps.toFixed(0)}KB/s），停了。到腾讯云 存储桶 → 域名与传输管理 → 全球加速 打开，下一轮自动走加速`); e.code = "TooSlow"; req.destroy(e); }
      }, 10000);
      req.on("close", () => clearInterval(watch));
      req.on("timeout", () => req.destroy(new Error("传到存储超时")));
      req.on("error", bad);
      const rs = fs.createReadStream(file);
      if (it) rs.on("data", (c) => { n += c.length; tick(it, n, size); });
      rs.on("error", bad).pipe(req);
    });
  }
  async function copy(key, it) {
    Object.assign(it, { key, state: "copying", why: "", at: Date.now(), phase: "从 GitHub 下载", got: 0, step: 0, t0: 0, ts: 0, nPrev: 0, speed: 0 });
    const tmp = path.join(dir, key.replace(/[^\w.-]/g, "_") + ".part");
    try {
      log(`安装包中转：${key} 存储里还没有，从 GitHub 搬过来（${Math.round((it.size || 0) / 1048576)}MB）`);
      const n = await download(it.url, tmp, it, it);
      Object.assign(it, { phase: "传到国内存储", got: 0, step: 0, t0: 0, ts: 0, nPrev: 0, speed: 0 });
      const useAccel = accelEp && Date.now() > accelOffUntil;
      try {
        it.via = useAccel ? "全球加速" : "普通线路";
        await put(presign("PUT", key, 6 * 3600, true, useAccel ? accelEp : ""), tmp, n, it);
      } catch (e) {
        if (!useAccel) throw e;
        // 加速线路出任何问题（没开、签名不认、连不上…）都退回普通线路再试一次；没开的话 1 小时内不再试加速
        const off = /AccelerateNotEnabled|InvalidAccelerate/i.test((e.code || "") + e.message);
        if (off) accelOffUntil = Date.now() + 3600e3;
        log(`安装包中转：全球加速没走通（${off ? "存储桶没开全球加速" : e.message}），这次走普通线路（香港到广州晚上可能很慢）`);
        Object.assign(it, { got: 0, step: 0, t0: 0, ts: 0, nPrev: 0, speed: 0, via: "普通线路" });
        await put(presign("PUT", key, 6 * 3600, true), tmp, n, it);
      }
      it.state = "ok"; it.done = Date.now();
      log(`安装包中转：${key} 搬好了，国内下载走存储（用了 ${Math.round((it.done - it.at) / 1000)} 秒）`);
    } catch (e) { it.state = "failed"; it.why = e.message; log(`安装包中转：${key} 没搬成：${e.message}（10 分钟后再试）`); }
    finally { fs.rm(tmp, { force: true }, () => {}); }
  }

  // 只读 GitHub 上的版本文件（4 个小 JSON，一两秒），记下每个安装包在 GitHub 的地址；不碰存储
  let scanning = null, lastScan = 0;
  function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      const found = [];
      for (const app of APPS) {
        const m = await manifest(app);
        if (!m || !m.version || !/^https?:\/\//.test(m.url || "")) continue;
        const key = m.cn && m.cn.startsWith(base) ? decodeURIComponent(m.cn.slice(base.length)) : KEY_OF[app](m.version);
        const it = known.get(key) || { app, version: m.version, url: m.url, size: +m.size || 0, sha256: m.sha256 || "", state: "?", inManifest: !!(m.cn && m.cn.startsWith(base)) };
        Object.assign(it, { url: m.url, size: +m.size || it.size, sha256: m.sha256 || it.sha256, inManifest: !!(m.cn && m.cn.startsWith(base)) });
        known.set(key, it); found.push([key, it]);
      }
      lastScan = Date.now();
      return found;
    })().finally(() => { scanning = null; });
    return scanning;
  }
  async function run() {
    if (running) return running;
    running = (async () => {
      lastRun = Date.now();
      if (!cos.endpoint || !cos.bucket || !readKey.keyId) return status();   // 没配存储：什么都不做
      const todo = [];
      for (const [key, it] of await scan()) {
        if (it.state === "copying") continue;
        const have = await cosSize(key);
        if (have != null && have > 0 && (!it.size || have === it.size)) { it.state = "ok"; continue; }
        if (have == null) { it.state = "?"; it.why = "问不到存储"; continue; }
        it.state = "missing";
        if (canWrite) { it.why = "排队中"; todo.push([key, it]); } else it.why = "还没配中转用的写入密钥（DLW_COS_*），搬不了";
      }
      // 小的先搬（捞捞编程 1.5GB 放最后，别让它挡住别的）
      todo.sort((a, b) => (a[1].size || 0) - (b[1].size || 0));
      for (const [key, it] of todo) await copy(key, it);
      return status();
    })().finally(() => { running = null; });
    return running;
  }
  // 下载门口问：这个文件存储里没有，先转去哪（GitHub 的原地址）；顺便催一下中转。
  // 调度中心刚重启、还没读过版本文件时：当场读一次（最多等 10 秒），不让人看到 404
  async function fallbackOf(key) {
    if (!known.has(key) && Date.now() - lastScan > 30e3) await Promise.race([scan().catch(() => {}), new Promise((ok) => setTimeout(ok, 10e3).unref())]);
    const it = known.get(key);
    if (!running && Date.now() - lastRun > 60e3) run().catch(() => {});   // 顺便催一下中转（只是读版本文件、问存储，很快）
    return it && it.state !== "ok" ? it.url : null;
  }
  const status = () => ({ canWrite, lastRun, running: !!running, files: [...known.entries()].map(([key, v]) => ({ key, app: v.app, version: v.version, state: v.state, why: v.why || "", inManifest: v.inManifest, size: v.size,
    ...(v.state === "copying" ? { via: v.via || "", phase: v.phase, got: v.got || 0, pct: v.size ? Math.floor(((v.got || 0) / v.size) * 100) : 0, speed: v.speed || 0 } : {}) })) });
  // 不等搬完就返回（dl-relay.sh 用它开个头，然后每几秒问一次进度）
  function kick() { run().catch(() => {}); return status(); }

  const timer = o.noTimer ? null : setInterval(() => run().catch(() => {}), o.everyMs || 10 * 60e3);
  if (timer && timer.unref) timer.unref();
  if (!o.noTimer) setTimeout(() => run().catch(() => {}), 30000).unref();
  return { run, kick, status, fallbackOf, close() { clearInterval(timer); }, KEY_OF };
}

module.exports = { create, KEY_OF, APPS };
