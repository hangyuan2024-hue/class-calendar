// 自动更新：不打断干活。
//   1. 每 2 小时（和启动后 1 分钟）看一眼官网的 download/grid-version.json（国内走官网的国内加速，海外 / 失败走 GitHub）
//   2. 有新版：后台下载安装包（国内存储优先，断了接着下），核对大小和 sha256
//   3. 等「合适的时候」再装：不领新任务，手上的任务算完（最多等 maxWaitMin 分钟，超时就把任务交给别的电脑接着算——有存档，不丢）；
//      而且没人在用这个软件（窗口藏着，或者 3 分钟没动鼠标键盘），也没在录表情
//   4. 静默安装（/S），装完自己重新打开（--force-run），接着挂机。训练环境和数据在另一个文件夹，不受影响。
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
      set({ state: "ready", file, progress: 1, error: "" });
      return st;
    } finally { busy = false; }
  }

  // 现在能不能装：没人在用、没在录表情；手上的活先放下（drain），算完或者超时交出去
  let drainSince = 0;
  async function maybeApply(force) {
    if (st.state !== "ready" || applying) return false;
    if (!force) {
      if (o.recording && o.recording()) return false;
      const idle = o.idleSecs ? await o.idleSecs() : 1e9;
      if (!(o.windowHidden && o.windowHidden()) && idle < 180) return false;
    }
    const a = o.agent && o.agent();
    if (a) {
      if (!drainSince) { drainSince = Date.now(); a.drain(true); set({ state: "ready", waiting: "等手上的任务算完…" }); }
      if (a.current()) {
        if (!force && Date.now() - drainSince < (o.maxWaitMin || 30) * 60e3) return false;
        await a.stop();  // 超时：交给别的电脑从存档接着算
      }
    }
    applying = true;
    set({ state: "installing" });
    try { await o.install(st.file); return true; }
    catch (e) { applying = false; drainSince = 0; if (a) a.drain(false); set({ state: "ready", error: "安装失败：" + e.message }); return false; }
  }

  function start() {
    if (timer) return;
    setTimeout(() => check().catch(() => {}), o.firstDelayMs != null ? o.firstDelayMs : 60e3);
    timer = setInterval(async () => {
      if (Date.now() - st.checked > (o.everyMs || 2 * 3600e3)) await check().catch(() => {});
      await maybeApply(false).catch(() => {});
    }, o.tickMs || 30e3);
  }
  function stop() { clearInterval(timer); timer = null; }
  return { check, maybeApply, start, stop, status: () => ({ ...st }), now: () => maybeApply(true) };
}

module.exports = { create, newer, SOURCES };
