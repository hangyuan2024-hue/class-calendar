// 捞捞算力 · AI 引擎（ComfyUI + 画 Q版的模型）：和捞捞PPT助手用的是同一套（app/ppt/ 里的文件打包时从 pptassist/core 拷过来）
//   装：ComfyUI 官方整合包、Qwen-Image-Edit 这几个模型都从你的国内存储下（没有才走 hf-mirror.com）
//   用：配方开头写「# needs: comfy」，跑的时候配方通过 lg.comfy(...) 让这里的 ComfyUI 画图：
//       info   → 模型文件名、显存
//       upload → 本机图片交给 ComfyUI
//       lora   → 训练出来的插件放进 ComfyUI/models/loras/laolao/
//       run    → 交一张节点图，等它画完，结果存到任务文件夹
//   不用的时候关掉（让出显存和内存）：任务停了、或者 10 分钟没用
"use strict";
const fs = require("fs");
const path = require("path");

const PPT = (() => { for (const d of [path.join(__dirname, "ppt"), path.join(__dirname, "..", "..", "pptassist", "core")]) if (fs.existsSync(path.join(d, "engine.js"))) return d; return path.join(__dirname, "ppt"); })();
const load = (n) => require(path.join(PPT, n));

const FEATURE = "portrait";
const PORT = 18288;   // 和捞捞PPT助手（18188）错开，同一台电脑两个都装也不打架

function create(o) {
  const ENGINE = o.engine || load("engine"), WF = o.workflows || load("workflows"), MIRROR = o.mirrorMod || load("mirror"), INSTALL = o.installer || load("installer");
  const mirror = o.mirror || MIRROR.create(o.mirrorOpt || {});
  const eng = o.eng || ENGINE.create({ mirror, ...(o.engineOpt || {}) });
  const st = () => o.get() || {};
  const set = (p) => o.set({ ...st(), ...p });
  const say = (m) => { try { o.onEvent && o.onEvent(m); } catch (e) {} };
  let ac = null, idle = null, n = 0;

  function rt() { const d = st().dir; if (!d) return null; const r = ENGINE.inspect(d); return r.ok ? r : null; }
  const vram = () => +st().vram || +o.vram() || 8;

  async function check() {
    const r = rt();
    if (!r) return { installed: false, ready: false, dir: st().dir || "", running: eng.status().running };
    const c = await eng.check(r, st().files || {});
    const f = c.feat[FEATURE];
    const ready = !f.missing.length && !c.coreMissing.length;
    if (!!st().ready !== ready) set({ ready });
    return { installed: true, ready, dir: r.dir, missing: f.missing.map((k) => (st().files || {})[k] ? st().files[k].name : WF.MODELS[k].name), bytes: f.bytes || 0, coreMissing: c.coreMissing, running: eng.status().running };
  }
  // 一键装：整合包（没有才装）→ 模型 → 启动一次核对 ComfyUI 版本够新 → 关掉
  async function install(parent) {
    if (ac) throw new Error("正在装");
    ac = new AbortController();
    try {
      let r = rt();
      if (!r) {
        say({ stage: "pkg", msg: "下载 ComfyUI 整合包（约 2G，从国内存储）" });
        const need = WF.NEEDS[FEATURE].reduce((s, k) => s + WF.MODELS[k].size, 0);
        const x = await INSTALL.install("comfyui", parent, { mirror, gpu: o.gpuName ? o.gpuName() : "", signal: ac.signal, extraSpace: need, onMsg: (m) => say({ ...m, part: "pkg" }) });
        set({ dir: x.dir, ver: x.ver || "" });
        r = rt();
        if (!r) throw new Error("ComfyUI 解压好了，但认不出来");
        say({ stage: "pkg", msg: "ComfyUI 装好了", done: true });
      }
      const files = { ...(st().files || {}) };
      say({ stage: "models", msg: "下载画 Q版的模型（约 31G）：断了再点会接着下" });
      await eng.fetchModels(r, FEATURE, files, vram(), (m) => say({ ...m, stage: "download", part: "models" }));
      set({ files, vram: vram() });
      say({ stage: "models", msg: "模型下好了", done: true });
      say({ stage: "start", msg: "启动 ComfyUI 核对一下（第一次要 1～3 分钟）" });
      await eng.start(r, { port: PORT, lowvram: vram() <= 8 });
      const c = await check();
      eng.stop();
      if (c.coreMissing && c.coreMissing.length) throw new Error("ComfyUI 版本太旧（缺 " + c.coreMissing[0] + "）：删掉 " + r.dir + " 再点一键安装");
      say({ stage: "start", msg: "AI 引擎能用了", done: true });
      return c;
    } finally { ac = null; }
  }
  // 已经装过 ComfyUI 整合包（比如捞捞PPT助手装的）：直接用那个文件夹
  async function useDir(d) {
    const r = ENGINE.inspect(d);
    if (!r.ok) throw new Error(r.error);
    if (/[^\x00-\x7f]/.test(r.dir) || /\s/.test(r.dir)) throw new Error("ComfyUI 的路径里有中文或空格，会出错：换一个");
    set({ dir: r.dir });
    return check();
  }
  function cancel() { if (ac) ac.abort(); eng.cancel().catch(() => {}); }

  // ---- 给配方用 ----
  function bump() { clearTimeout(idle); idle = setTimeout(() => { if (!eng.status().job) eng.stop(); }, o.idleMs || 10 * 60e3); idle.unref && idle.unref(); }
  // 配方画的图交上去以后就没用了：ComfyUI 的 output/laolao-grid、input 里我们传的 lg-* 定时清掉，不占硬盘
  function tidy(r, inputs) {
    try { fs.rmSync(path.join(r.comfy, "output", "laolao-grid"), { recursive: true, force: true }); } catch (e) {}
    if (inputs) { try { const d = path.join(r.comfy, "input"); for (const f of fs.readdirSync(d)) if (/^lg-/.test(f)) fs.rmSync(path.join(d, f), { force: true }); } catch (e) {} }
  }
  async function up() {
    const r = rt();
    if (!r || !st().ready) throw new Error("这台电脑还没装好 AI 引擎（任务向导第 4 步）");
    if (!eng.status().running) await eng.start(r, { port: PORT, lowvram: vram() <= 8 });
    bump();
    return r;
  }
  // 一个任务开始前：开好 ComfyUI，顺便清掉上一个任务留下的图
  async function ensure() { tidy(await up(), true); return eng.status(); }
  const inside = (dir, f) => { const p = path.resolve(dir, String(f || "")); if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error("只能用任务文件夹里的文件"); if (!fs.existsSync(p)) throw new Error("没有这个文件：" + path.basename(p)); return p; };
  async function call(op, a, ctx) {
    await up();
    bump();
    if (op === "info") {
      const files = st().files || {};
      return { models: Object.fromEntries(WF.NEEDS[FEATURE].map((k) => [k, (files[k] && files[k].name) || WF.MODELS[k].name])), vram: (eng.status().vram || {}).gb || vram(), version: eng.status().version };
    }
    if (op === "upload") return { name: await eng.upload(inside(ctx.dir, a.path), "lg-" + String(a.as || path.basename(a.path)).replace(/^lg-/, "").replace(/[^\w.\-]/g, "_")) };
    if (op === "lora") {
      const f = inside(ctx.dir, a.path), name = String(a.name || path.basename(f)).replace(/[^\w.\-]/g, "_");
      const d = path.join(rt().models, "loras", "laolao");
      fs.mkdirSync(d, { recursive: true });
      const dest = path.join(d, name);
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(f).size) fs.copyFileSync(f, dest);
      return { name: "laolao/" + name };
    }
    if (op === "run") {
      if (!a.graph || typeof a.graph !== "object") throw new Error("没有节点图");
      const out = path.join(ctx.dir, "comfy-" + ++n);
      const files = await eng.run(a.kind || "生成", a.graph, out, (m) => ctx.onMsg && ctx.onMsg(m));
      tidy(rt(), false);
      bump();
      return { files };
    }
    throw new Error("没有这个操作：" + op);
  }
  return { check, install, useDir, cancel, ensure, call, stop: () => { clearTimeout(idle); return eng.stop(); }, abort: () => eng.cancel().catch(() => {}), status: () => eng.status(), PORT };
}

module.exports = { create, PORT, FEATURE };
