// 3.4：电脑版自动检查更新 + 一键更新
// 打开软件 20 秒后、之后每 6 小时问一次官网 download/desktop-version.json（GitHub Actions 打包后自动写）
// 有新版本 → 界面顶上出提示条「立即更新」→ 在软件里下载安装包（显示进度，校验大小和 sha256）→ 静默安装后自动重新打开
// 下载线路：先 GitHub Releases，断了换海外中转（Cloudflare）；都不行就打开官网下载页
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE = "https://www.laolaokechengbiao.cn/";
const VERSION_URLS = [SITE + "download/desktop-version.json", "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/download/desktop-version.json"];
const LATEST_EXE = "https://github.com/hangyuan2024-hue/class-calendar/releases/latest/download/LaolaoKechengbiao-Setup.exe";

// "3.4.12" 和 "3.4.9" 比大小：a 比 b 新返回正数
function cmp(a, b) {
  const pa = String(a || "0").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0), pb = String(b || "0").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

function create({ app, fetch, tmpDir, send, alt, spawn, log }) {
  const st = { state: "idle", latest: null, progress: 0, error: "", file: "", checkedAt: 0 };
  const push = () => { try { send({ ...st, current: app.getVersion() }); } catch (e) {} };
  let dl = null;

  async function getJson(u) {
    const r = await fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
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
  function urls() {
    const i = st.latest || {}, out = [];
    if (i.url) out.push(i.url);
    if (alt) out.push(String(alt).replace(/\/+$/, "") + "/dl/windows");
    out.push(LATEST_EXE);
    return [...new Set(out)];
  }
  async function fetchTo(u, file, want) {
    const r = await fetch(u, { cache: "no-store", signal: dl.ctl.signal });
    if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
    const total = +r.headers.get("content-length") || want || 0;
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash("sha256");
    let got = 0, lastPush = 0;
    try {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        const b = Buffer.from(value); got += b.length; hash.update(b);
        if (!out.write(b)) await new Promise((ok) => out.once("drain", ok));
        if (total && Date.now() - lastPush > 400) { st.progress = Math.min(0.99, got / total); lastPush = Date.now(); push(); }
      }
    } finally { await new Promise((ok) => out.end(ok)); }
    if (got < 1024 * 1024) throw new Error("下载的文件不完整");
    return { size: got, sha256: hash.digest("hex") };
  }
  async function download() {
    if (st.state === "downloading") return st;
    if (!st.latest) await check(true);
    if (!st.latest || st.state === "latest") return st;
    st.state = "downloading"; st.progress = 0; st.error = ""; push();
    dl = { ctl: new AbortController() };
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "LaolaoKechengbiao-Setup-" + String(st.latest.version).replace(/[^\w.]/g, "") + ".exe");
    const want = +st.latest.size || 0, sha = String(st.latest.sha256 || "").toLowerCase();
    // 之前下完了就不用再下
    try { if (want && fs.statSync(file).size === want && (!sha || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") === sha)) { st.file = file; st.state = "ready"; st.progress = 1; push(); return st; } } catch (e) {}
    let err = null;
    for (const u of urls()) {
      try {
        const r = await fetchTo(u, file, want);
        const isPinned = u === st.latest.url;   // 只有指定版本的地址能对 sha256（latest / 中转可能已经是更新的版本）
        if (isPinned && want && r.size !== want) throw new Error("文件大小不对");
        if (isPinned && sha && r.sha256 !== sha) throw new Error("文件校验没通过");
        st.file = file; st.state = "ready"; st.progress = 1; push();
        return st;
      } catch (e) {
        err = e; try { fs.unlinkSync(file); } catch (x) {}
        if (dl.ctl.signal.aborted) break;
        log && log("update download failed", u, e.message);
      }
    }
    st.state = "available"; st.error = dl.ctl.signal.aborted ? "" : "下载失败：" + ((err && err.message) || "网络不好") + "，可以去官网手动下载"; push();
    return st;
  }
  function cancel() { if (dl && dl.ctl) dl.ctl.abort(); }
  // 静默安装：NSIS 安装包 /S 不弹界面，--updated --force-run 装完自动重新打开
  function install(quit) {
    if (st.state !== "ready" || !st.file || !fs.existsSync(st.file)) throw new Error("安装包还没下载好");
    const p = spawn(st.file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" });
    p.unref();
    setTimeout(quit, 300);
    return true;
  }
  return { check, download, cancel, install, state: () => ({ ...st, current: app.getVersion() }), page: SITE + "download/" };
}

module.exports = { create, cmp };
