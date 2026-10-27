// 自动检查更新 + 一键更新（捞捞课程表电脑版、捞捞编程共用这一份：coder/core/updater.js 是同一个文件的副本）
// 打开软件 20 秒后、之后每 6 小时问一次官网的版本文件（GitHub Actions 打包后自动写）
// 有新版本 → 界面上出提示「立即更新」→ 在软件里下载安装包 → 静默安装后自动重新打开
//
// 6.9.8 国内下载加速：
//   下载线路 = 国内对象存储（配了才有，版本文件里的 cn）+ GitHub 加速镜像（download/mirrors.json，可以随时换）+ GitHub 官方 + 海外中转
//   先每条线路试下 256 KB 测速，挑最快的下；下到一半断了换下一条线路「接着下」（Range 续传），不用从头来
//   下完整个文件对 sha256：镜像就算被人改过也装不上
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE = "https://www.laolaokechengbiao.cn/";
const RAW = "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/";
// 镜像清单拿不到时用的默认值（清单在网站 download/mirrors.json，镜像挂了改那个文件就行，不用发新版）
const DEFAULT_MIRRORS = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];

// "3.4.12" 和 "3.4.9" 比大小：a 比 b 新返回正数
function cmp(a, b) {
  const pa = String(a || "0").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0), pb = String(b || "0").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
const isGh = (u) => /^https:\/\/github\.com\//.test(u || "");
// 一个安装包的所有下载线路：[{ url, name, pinned }]；pinned = 就是这个版本的文件（能对 sha256）
function sources(info, mirrors, extra) {
  const out = [];
  if (info.cn) out.push({ url: info.cn, name: "国内", pinned: true });
  if (isGh(info.url)) for (const m of mirrors || []) if (/^https:\/\//.test(m)) out.push({ url: m.replace(/\/?$/, "/") + info.url, name: "加速镜像 " + m.replace(/^https:\/\/|\/$/g, ""), pinned: true });
  if (info.url) out.push({ url: info.url, name: "GitHub", pinned: true });
  for (const e of extra || []) out.push(e);
  const seen = new Set();
  return out.filter((s) => (seen.has(s.url) ? false : seen.add(s.url)));
}

// opt：{ product: "desktop" | "code", versionFile, fileName, installArgs, latestUrl, alt }
function create({ app, fetch, tmpDir, send, alt, spawn, log, opt }) {
  opt = Object.assign({ product: "desktop", versionFile: "desktop-version.json", fileName: "LaolaoKechengbiao-Setup", installArgs: ["/S", "--updated", "--force-run"],
    latestUrl: "https://github.com/hangyuan2024-hue/class-calendar/releases/latest/download/LaolaoKechengbiao-Setup.exe" }, opt || {});
  const VERSION_URLS = [SITE + "download/" + opt.versionFile, RAW + "download/" + opt.versionFile];
  const st = { state: "idle", latest: null, progress: 0, error: "", file: "", checkedAt: 0, via: "", speed: 0 };
  const push = () => { try { send({ ...st, current: app.getVersion() }); } catch (e) {} };
  let dl = null, mirrors = null;

  async function getJson(u, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 10000);
    try {
      const r = await fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store", signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function loadMirrors() {
    if (mirrors) return mirrors;
    for (const u of [SITE + "download/mirrors.json", RAW + "download/mirrors.json"]) {
      try { const j = await getJson(u, 6000); if (j && Array.isArray(j.gh)) return (mirrors = j.gh.filter((x) => /^https:\/\//.test(x)).slice(0, 6)); } catch (e) {}
    }
    return (mirrors = DEFAULT_MIRRORS);
  }
  async function check(manual) {
    if (st.state === "downloading" || st.state === "ready") { push(); return st; }
    let info = null, last = null;
    for (const u of VERSION_URLS) { try { info = await getJson(u); if (info && info.version) break; } catch (e) { last = e; } }
    st.checkedAt = Date.now();
    if (!info || !info.version) { st.error = manual ? "检查更新失败：" + ((last && last.message) || "连不上官网") : ""; st.state = manual ? "error" : st.state; push(); return st; }
    st.latest = info; st.error = "";
    st.state = cmp(info.version, app.getVersion()) > 0 ? "available" : "latest";
    push();
    return st;
  }
  async function allSources() {
    const extra = [];
    if (alt && opt.product === "desktop") extra.push({ url: String(alt).replace(/\/+$/, "") + "/dl/windows", name: "海外中转", pinned: false });
    if (opt.latestUrl) extra.push({ url: opt.latestUrl, name: "GitHub 最新", pinned: false });
    return sources(st.latest || {}, await loadMirrors(), extra);
  }
  // 测速：同时从每条线路下前 256 KB，按速度排；6 秒没下完的排到后面
  async function rank(list) {
    const probe = async (s) => {
      const ctl = new AbortController(), t0 = Date.now(), timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const r = await fetch(s.url, { headers: { Range: "bytes=0-262143" }, cache: "no-store", signal: ctl.signal });
        if (!(r.status === 206 || r.status === 200) || !r.body) throw new Error("HTTP " + r.status);
        let got = 0; const rd = r.body.getReader();
        while (got < 262144) { const { done, value } = await rd.read(); if (done) break; got += value.length; }
        try { ctl.abort(); } catch (e) {}
        return { s, ok: got > 0, speed: got / Math.max(1, Date.now() - t0), range: r.status === 206 };
      } catch (e) { return { s, ok: false, speed: 0 }; } finally { clearTimeout(timer); }
    };
    const res = await Promise.all(list.filter((s) => s.pinned).map(probe));
    const good = res.filter((x) => x.ok).sort((a, b) => b.speed - a.speed);
    log && log("update probe", res.map((x) => x.s.name + ":" + Math.round(x.speed) + "KB/s").join(" "));
    const ordered = good.map((x) => Object.assign({}, x.s, { speed: x.speed }));
    for (const s of list) if (!ordered.some((x) => x.url === s.url)) ordered.push(s);
    return ordered;
  }
  // 从 offset 接着下到 part 文件；20 秒没有新数据就算这条线路卡住了
  async function fetchFrom(s, part, offset, want) {
    const ctl = new AbortController(), onAbort = () => ctl.abort();
    dl.ctl.signal.addEventListener("abort", onAbort);
    let idle = null; const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 20000); };
    kick();
    try {
      const r = await fetch(s.url, { cache: "no-store", signal: ctl.signal, headers: offset ? { Range: "bytes=" + offset + "-" } : {} });
      if (!(r.ok || r.status === 206) || !r.body) throw new Error("HTTP " + r.status);
      let got = offset;
      if (offset && r.status !== 206) got = 0;   // 这条线路不支持续传：从头来
      const total = r.status === 206 ? (+String(r.headers.get("content-range") || "").split("/")[1] || want) : (+r.headers.get("content-length") || want);
      const out = fs.createWriteStream(part, { flags: got ? "a" : "w" });
      let lastPush = 0, t0 = Date.now(), b0 = got;
      try {
        const rd = r.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          kick();
          const b = Buffer.from(value); got += b.length;
          if (!out.write(b)) await new Promise((ok) => out.once("drain", ok));
          if (Date.now() - lastPush > 400) { st.progress = total ? Math.min(0.99, got / total) : 0; st.speed = Math.round((got - b0) / Math.max(1, Date.now() - t0)); lastPush = Date.now(); push(); }
        }
      } finally { await new Promise((ok) => out.end(ok)); }
      return got;
    } finally { clearTimeout(idle); dl.ctl.signal.removeEventListener("abort", onAbort); }
  }
  const sha256File = (f) => new Promise((ok, no) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no); });
  async function download() {
    if (st.state === "downloading") return st;
    if (!st.latest) await check(true);
    if (!st.latest || st.state === "latest") return st;
    st.state = "downloading"; st.progress = 0; st.error = ""; st.via = "正在测速…"; st.speed = 0; push();
    dl = { ctl: new AbortController() };
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, opt.fileName + "-" + String(st.latest.version).replace(/[^\w.]/g, "") + ".exe"), part = file + ".part";
    const want = +st.latest.size || 0, sha = String(st.latest.sha256 || "").toLowerCase().replace(/[^0-9a-f]/g, "");   // 7.6.5 以前的版本文件里 sha256 前面多了个「\」，去掉
    // 之前下完了就不用再下
    try { if (want && fs.statSync(file).size === want && (!sha || (await sha256File(file)) === sha)) { st.file = file; st.state = "ready"; st.progress = 1; push(); return st; } } catch (e) {}
    let err = null, offset = 0;
    try { offset = fs.statSync(part).size; if (want && offset >= want) { fs.unlinkSync(part); offset = 0; } } catch (e) { offset = 0; }
    const list = await rank(await allSources());
    for (const s of list) {
      if (dl.ctl.signal.aborted) break;
      for (let tries = 0; tries < 3; tries++) {   // 同一条线路断了先在原地接着下两次
        try {
          st.via = s.name; push();
          const got = await fetchFrom(s, part, s.pinned ? offset : 0, want);
          offset = got;
          if (want && got < want) throw new Error("没下完（" + Math.round(got / 1048576) + " / " + Math.round(want / 1048576) + " MB）");
          if (got < 1024 * 1024) throw new Error("下载的文件不完整");
          if (s.pinned && want && got !== want) throw new Error("文件大小不对");
          if (s.pinned && sha && (await sha256File(part)) !== sha) { fs.unlinkSync(part); offset = 0; throw Object.assign(new Error("文件校验没通过"), { bad: true }); }
          try { fs.unlinkSync(file); } catch (e) {}
          fs.renameSync(part, file);
          st.file = file; st.state = "ready"; st.progress = 1; push();
          return st;
        } catch (e) {
          err = e;
          if (dl.ctl.signal.aborted || e.bad) break;
          log && log("update download failed", s.name, e.message);
          if (!s.pinned) { try { fs.unlinkSync(part); } catch (x) {} offset = 0; break; }
          try { offset = fs.statSync(part).size; } catch (x) { offset = 0; }
          if (tries === 0 && !offset) break;   // 一点都没下下来：直接换线路
        }
      }
    }
    st.state = "available"; st.via = ""; st.error = dl.ctl.signal.aborted ? "" : "下载失败：" + ((err && err.message) || "网络不好") + "，可以去官网手动下载"; push();
    return st;
  }
  function cancel() { if (dl && dl.ctl) dl.ctl.abort(); }
  // 静默安装（电脑版 NSIS：/S --updated --force-run；捞捞编程 Inno Setup：/VERYSILENT /RELAUNCH），装完自动重新打开
  function install(quit) {
    if (st.state !== "ready" || !st.file || !fs.existsSync(st.file)) throw new Error("安装包还没下载好");
    const p = spawn(st.file, opt.installArgs, { detached: true, stdio: "ignore" });
    p.unref();
    setTimeout(quit, 300);
    return true;
  }
  return { check, download, cancel, install, state: () => ({ ...st, current: app.getVersion() }), page: SITE + (opt.product === "code" ? "code/" : "download/") };
}

module.exports = { create, cmp, sources, DEFAULT_MIRRORS };
