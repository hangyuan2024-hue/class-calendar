// 自动更新：不打断干活，也不因为等更新就不干活。
//   1. 启动后 20 秒、之后每 20 分钟看一眼 download/grid-version.json（国内走官网，海外 / 失败走 GitHub）；控制中心也能遥控「立刻更新」
//   2. 有新版：后台下载安装包（断了接着下），核对大小和 sha256，下好了记一个 .ok
//   3. 什么时候装（装一次大约 20 秒，装完自己打开、接着刚才的状态）：
//        · 手上没有任务、而且没人在用（窗口藏着，或者 3 分钟没动鼠标键盘），没在录表情 → 马上装
//        · 下好超过 6 小时一直没等到：手上没有任务时提前 1 分钟提醒，然后装（有人在用也装）
//        · 手上有任务：接着算，不停、不领新任务这种事不做；算完了再看上面两条
//        · 下次开机（或者退出软件时）发现下好了还没装 → 先装
//   4. 静默安装（/S），装完自己重新打开（--force-run）。训练环境和数据在另一个文件夹，不受影响。
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { xfer } = require("../worker/agent");

const SOURCES = [
  "https://www.laolaokechengbiao.cn/download/grid-version.json",
  "https://raw.githubusercontent.com/hangyuan2024-hue/class-calendar/main/download/grid-version.json",
];
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function create(o) {
  const dir = () => path.join(o.dir(), "update");
  let st = { state: "idle", current: o.version, latest: null, notes: "", progress: 0, error: "", checked: 0 };
  let timer = null, busy = false, applying = false;
  const set = (p) => { st = { ...st, ...p }; o.onEvent && o.onEvent({ ...st }); };
  const fetchJson = async (u) => { const r = await (o.fetch || fetch)(u + "?t=" + Date.now(), { cache: "no-store", signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(r.status); return r.json(); };

  async function check() {
    if (busy || applying) return st;
    busy = true;
    try {
      let info = null, err = null;
      for (const u of o.sources || SOURCES) { try { info = await fetchJson(u); if (info && info.version) break; } catch (e) { err = e; } }
      set({ checked: Date.now() });
      if (!info || !info.version) { set({ state: st.state === "ready" ? "ready" : "idle", error: "查不到新版本：" + (err ? err.message : "") }); return st; }
      if (!newer(info.version, o.version)) { set({ state: "idle", latest: info.version, error: "" }); return st; }
      const file = path.join(dir(), `LaolaoGrid-Setup-${info.version}.exe`);
      if (st.state === "ready" && st.file === file && fs.existsSync(file)) return st;
      if (fs.existsSync(file + ".ok") && fs.existsSync(file)) { set({ state: "ready", latest: info.version, notes: info.notes || "", file, progress: 1, error: "", readyAt: st.readyAt || Date.now() }); return st; }
      fs.mkdirSync(dir(), { recursive: true });
      // 旧的安装包删掉
      for (const f of fs.readdirSync(dir())) if (!f.startsWith(`LaolaoGrid-Setup-${info.version}.exe`)) fs.rmSync(path.join(dir(), f), { force: true });
      set({ state: "downloading", latest: info.version, notes: info.notes || "", progress: 0, error: "" });
      let ok = false;
      for (const u of [info.cn, info.url].filter(Boolean)) {
        try { await xfer("GET", u, file, { onProgress: (a, b) => { if (b) set({ progress: a / b }); } }); ok = true; break; }
        catch (e) { set({ error: "这个地址下不动，换一个：" + e.message }); }
      }
      if (!ok) { set({ state: "idle", error: "新版本下载失败，过一会儿再试" }); return st; }
      const buf = fs.readFileSync(file);
      if ((info.size && buf.length !== info.size) || (info.sha256 && crypto.createHash("sha256").update(buf).digest("hex") !== info.sha256)) {
        fs.rmSync(file, { force: true });
        set({ state: "idle", error: "下载的安装包不完整，过一会儿重新下" });
        return st;
      }
      try { fs.writeFileSync(file + ".ok", info.version); } catch (e) {}
      set({ state: "ready", file, progress: 1, error: "", readyAt: Date.now(), noticeAt: 0 });
      return st;
    } finally { busy = false; }
  }

  // 现在能不能装（见文件开头）
  async function maybeApply(force) {
    if (st.state !== "ready" || applying) return false;
    const a = o.agent && o.agent();
    if (!force) {
      if (a && a.current()) { if (st.waiting !== "等手上的任务算完就更新（接着算，不耽误）") set({ waiting: "等手上的任务算完就更新（接着算，不耽误）" }); return false; }
      if (o.recording && o.recording()) return false;
      const idle = o.idleSecs ? await o.idleSecs() : 1e9;
      const quiet = (o.windowHidden && o.windowHidden()) || idle >= 180;
      const overdue = st.readyAt && Date.now() - st.readyAt > (o.overdueH || 6) * 3600e3;
      if (!quiet && !overdue) { if (st.waiting !== "等你不用电脑时自动更新（大约 20 秒）") set({ waiting: "等你不用电脑时自动更新（大约 20 秒）" }); return false; }
      if (!quiet) {
        if (!st.noticeAt) { set({ noticeAt: Date.now(), waiting: "1 分钟后自动重启更新（大约 20 秒）" }); o.notify && o.notify("捞捞算力 1 分钟后更新", `新版 ${st.latest} 已下载好，1 分钟后自动重启更新，大约 20 秒`); return false; }
        if (Date.now() - st.noticeAt < 60e3) return false;
      }
    }
    if (a) { a.drain(true); if (a.current()) { if (!force) { a.drain(false); return false; } await a.stop(); } }   // 只在装的那一下不领新任务；遥控「立刻更新」就把手上的交给别人接着算
    applying = true;
    set({ state: "installing" });
    try { await o.install(st.file); return true; }
    catch (e) { applying = false; if (a) a.drain(false); set({ state: "ready", error: "安装失败：" + e.message }); return false; }
  }
  // 上次下好还没装的（开机 / 退出时用）
  function pending() {
    try {
      for (const f of fs.readdirSync(dir())) {
        const m = /^LaolaoGrid-Setup-(\d+\.\d+\.\d+)\.exe$/.exec(f);
        if (m && newer(m[1], o.version) && fs.existsSync(path.join(dir(), f + ".ok"))) return { version: m[1], file: path.join(dir(), f) };
      }
    } catch (e) {}
    return null;
  }

  function start() {
    if (timer) return;
    setTimeout(() => check().catch(() => {}), o.firstDelayMs != null ? o.firstDelayMs : 20e3);
    timer = setInterval(async () => {
      if (Date.now() - st.checked > (o.everyMs || 20 * 60e3)) await check().catch(() => {});
      await maybeApply(false).catch(() => {});
    }, o.tickMs || 30e3);
  }
  function stop() { clearInterval(timer); timer = null; }
  return { check, maybeApply, start, stop, pending, status: () => ({ ...st }), now: async () => { if (st.state !== "ready") await check(); return maybeApply(true); } };
}

module.exports = { create, newer, SOURCES };
