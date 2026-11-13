// 捞捞算力 · GPT-SoVITS 整合包（训练老师的声音用）：和捞捞PPT助手装的是同一个（官方 Windows 整合包，50 系显卡用另一版）
//   配方开头写「# needs: gsv」：第一次自动从你的国内存储下载、解压（几个 G），之后直接用。
//   训练要整块显卡：开始前先关掉 ComfyUI 和本地大模型。
"use strict";
const fs = require("fs");
const path = require("path");

function inspect(dir) {
  if (!dir || !fs.existsSync(path.join(dir, "api_v2.py"))) return null;
  const py = [path.join(dir, "runtime", "python.exe"), path.join(dir, "runtime", "bin", "python"), path.join(dir, ".venv", "Scripts", "python.exe")].find((p) => fs.existsSync(p));
  if (!py) return null;
  const ff = [path.join(dir, "ffmpeg.exe"), path.join(dir, "runtime", "ffmpeg.exe")].find((p) => fs.existsSync(p)) || "ffmpeg";
  return { dir, python: py, ffmpeg: ff };
}
// 解压出来的文件夹里找 api_v2.py 所在的那一层
function find(root) {
  if (!root || !fs.existsSync(root)) return null;
  const q = [[root, 0]];
  while (q.length) {
    const [d, n] = q.shift();
    const r = inspect(d);
    if (r) return r;
    if (n >= 2) continue;
    try { for (const x of fs.readdirSync(d, { withFileTypes: true })) if (x.isDirectory()) q.push([path.join(d, x.name), n + 1]); } catch (e) {}
  }
  return null;
}

function create(o) {
  const INSTALL = o.installer || require(path.join(__dirname, "ppt", "installer.js"));
  const MIRROR = o.mirrorMod || require(path.join(__dirname, "ppt", "mirror.js"));
  const mirror = o.mirror || MIRROR.create();
  let busy = null;
  const parent = () => path.join(o.base(), "ai");
  async function ensure(say = () => {}) {
    if (o.beforeStart) await o.beforeStart();
    const st = o.get() || {};
    let r = st.dir && inspect(st.dir);
    if (r) return r;
    r = find(path.join(parent(), "LaolaoAI-GPT-SoVITS"));
    if (r) { o.set({ dir: r.dir }); return r; }
    if (busy) return busy;
    busy = (async () => {
      if (!/^[\x20-\x7e]+$/.test(parent()) || /\s/.test(parent())) throw new Error("数据文件夹的路径里有中文或空格，GPT-SoVITS 会出错：在任务向导第 1 步换到 D 盘");
      say("第一次训练声音：下载 GPT-SoVITS 整合包（几个 G，从国内存储，断了会接着下）");
      let last = 0;
      const x = await INSTALL.install("gsv", parent(), { mirror, gpu: o.gpuName ? o.gpuName() : "", onMsg: (m) => {
        if (Date.now() - last < 3000) return; last = Date.now();
        if (m.got && m.total) say(`下载 GPT-SoVITS：${Math.floor((m.got / m.total) * 100)}%`);
        else if (m.stage === "extract") say(`解压 GPT-SoVITS：${Math.round((m.p || 0) * 100)}%`);
      } });
      const f = find(x.dir) || find(path.join(parent(), "LaolaoAI-GPT-SoVITS"));
      if (!f) throw new Error("GPT-SoVITS 解压好了，但找不到 api_v2.py");
      o.set({ dir: f.dir, ver: x.ver || "" });
      say("GPT-SoVITS 装好了");
      return f;
    })();
    try { return await busy; } finally { busy = null; }
  }
  return { ensure, inspect, find };
}

module.exports = { create, inspect, find };
