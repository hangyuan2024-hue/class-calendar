// 捞捞算力 · 客户端后台：加入训练网、体检、装环境、跑通测试、挂机算、录表情、人工审核、看总体进度。
// 界面通过 lg.call(方法, ...参数) 调这里 H 里的方法；后台的事件用 send(频道, 数据) 推给界面。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Agent = require("../worker/agent");
const probe = require("../worker/probe");
const Env = require("./env");
const Updater = require("./updater");
const AI = require("./ai");

const RECIPES = path.join(__dirname, "..", "recipes").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");  // 打包后 Python 读不了 asar 里的文件

function createService(o) {
  const dir = o.user;
  fs.mkdirSync(dir, { recursive: true });
  const CFG = path.join(dir, "grid.json");
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) {}
  const save = () => fs.writeFileSync(CFG, JSON.stringify(cfg, null, 1));
  const send = (ch, d) => { try { o.send(ch, d); } catch (e) {} };
  // 训练环境（Python + PyTorch，约 6G）和工作文件（模型、存档、数据）放哪：默认软件自己的文件夹（一般在 C 盘），可以换到别的盘
  const base = () => cfg.dataDir || dir;
  const work = () => path.join(base(), "work");
  const mkEnv = () => Env.create({ dir: path.join(base(), "env"), python: o.python || cfg.python, onEvent: (e) => send("env", e) });
  let env = mkEnv();
  let agent = null, lastProbe = cfg.probe || null, sources = {};
  // AI 引擎（ComfyUI + 画 Q版的模型），装在数据文件夹的 ai 里
  const ai = (o.aiFactory || AI.create)({ get: () => cfg.ai, set: (v) => { cfg.ai = v; save(); }, onEvent: (e) => send("ai", e),
    vram: () => (lastProbe && lastProbe.caps && lastProbe.caps.vram) || 0, gpuName: () => (lastProbe && lastProbe.caps && lastProbe.caps.gpu) || "", ...(o.aiOpt || {}) });
  const capsNow = () => ({ ...((lastProbe && lastProbe.caps) || {}), comfy: !!(cfg.ai && cfg.ai.ready) });
  const gallery = [];

  function startAgent() {
    if (agent || !cfg.token) return;
    agent = Agent.create({
      server: cfg.server, token: cfg.token, pubkey: cfg.pubkey, workDir: work(), python: () => env.python(),
      caps: lastProbe ? capsNow() : null, comfy: ai, policy: cfg.policy || { mode: "idle", idleMin: 5 },
      idleSecs: o.idleSecs, ensure: (pkgs) => env.ensure(pkgs), version: o.version, gpuInfo: async () => (await probe.gpus())[0] || null, gpuApps: (ours) => probe.gpuApps(undefined, ours),
      ...(o.agentOpt || {}),
    });
    agent.on("any", ({ k, v }) => {
      if (k === "source") sources[v.id] = v;
      if (k === "image") {
        try { const b = fs.readFileSync(v.path); if (b.length < 3e6) v = { ...v, url: `data:image/${/png$/i.test(v.path) ? "png" : "jpeg"};base64,` + b.toString("base64") }; } catch (e) {}
        gallery.unshift(v); gallery.length = Math.min(gallery.length, 40);
      }
      if (k === "kicked") { send("kicked", v); }
      send("agent", { k, v });
    });
    if (cfg.paused && !cfg.manual) cfg.manual = "off";   // 老版本的「暂停」= 停止
    if (cfg.manual) agent.setManual(cfg.manual);
    agent.start();
  }
  const smallGpu = () => !!(lastProbe && lastProbe.caps && lastProbe.caps.vram < 7.5);
  const aiInfo = () => ({ ready: !!(cfg.ai && cfg.ai.ready), dir: (cfg.ai && cfg.ai.dir) || "", skipped: !!cfg.aiSkipped, smallGpu: smallGpu(), ram: (lastProbe && lastProbe.caps && lastProbe.caps.ram) || 0 });
  const api = (p, b) => { if (!agent) throw new Error("还没加入训练网"); return agent.api(p, b); };

  const H = {
    // ---- 加入 ----
    async status() {
      return {
        joined: !!cfg.token, server: cfg.server || "", dataDir: base(), me: cfg.member || null, deviceId: cfg.device || null, recorded: cfg.recorded || 0, deviceName: cfg.deviceName || "", version: o.version,
        agent: agent ? agent.status() : null, probe: lastProbe, policy: cfg.policy || (agent && agent.policy) || null, paused: cfg.manual === "off", manual: cfg.manual || "auto",
        python: cfg.python || "", env: cfg.envOk || null, testResult: cfg.testResult || null, consent: cfg.consent || null, autostart: !!cfg.autostart,
        ai: aiInfo(),
        steps: { probe: !!(lastProbe && lastProbe.ok), env: !!(cfg.envOk && cfg.envOk.ok), test: !!(cfg.testResult && cfg.testResult.ok), ai: !!(cfg.ai && cfg.ai.ready) || !!cfg.aiSkipped || smallGpu(), record: !!(cfg.recorded || cfg.recordSkipped), policy: !!cfg.policySet },
      };
    },
    async join(invite, name, deviceName) {
      const host = deviceName || os.hostname();
      const pr = lastProbe || await probe.full({ dir });
      const j = await Agent.join(invite, name, { name: host, info: pr.caps }, o.fetch);
      cfg = { ...cfg, server: j.server, pubkey: j.pubkey, token: j.token, member: j.member, device: j.device, deviceName: host, joinedAt: Date.now() };
      save();
      startAgent();
      return H.status();
    },
    async leave() { if (agent) await agent.stop(); agent = null; for (const k of ["server", "pubkey", "token", "member"]) delete cfg[k]; save(); return H.status(); },
    async consent(v) { cfg.consent = v ? { at: Date.now(), text: "同意" } : null; save(); return true; },

    // ---- ① 体检 ----
    async probe() {
      lastProbe = await probe.full({ dir: work(), server: cfg.server, smi: o.smi });
      cfg.probe = lastProbe; save();
      if (agent) agent.setCaps(capsNow());
      return lastProbe;
    },
    // 换个地方放（比如 D 盘）：只能用英文路径（PyTorch 和不少包在中文、空格路径下会出错）
    async pickDataDir() {
      const d = o.pickDir ? await o.pickDir("选一个放训练环境和数据的文件夹（建议 D 盘，要 80G 左右）") : null;
      if (!d) return null;
      let to = path.basename(d).toLowerCase() === "laolaogrid" ? d : path.join(d, "LaolaoGrid");
      if (!/^[\x20-\x7e]+$/.test(to) || /\s/.test(to)) throw new Error("路径里不能有中文和空格：选 D 盘根目录就行（会自动建 LaolaoGrid 文件夹）");
      fs.mkdirSync(to, { recursive: true });
      fs.accessSync(to, fs.constants.W_OK);
      if (agent) { await agent.stop(); agent = null; }
      cfg.dataDir = to; delete cfg.envOk; delete cfg.testResult; save();
      env = mkEnv();
      startAgent();
      return H.probe();
    },
    // ---- ② 装环境 ----
    envCheck: async () => { const r = await env.check(); cfg.envOk = r; save(); return r; },
    async envInstall() {
      if (!/^[\x20-\x7e]+$/.test(base()) || /\s/.test(base())) throw new Error("现在的位置（" + base() + "）里有中文或空格，装 PyTorch 会出错：先在第 1 步点「换个地方」，选 D 盘");
      const r = await env.install(); cfg.envOk = r; save(); return r; },
    envCancel: async () => env.cancel(),
    async usePython(p) { cfg.python = p || ""; save(); return H.envCheck(); },
    // ---- ③ 跑通测试（本机自带的测试配方，不用签名） ----
    async test() {
      const file = path.join(RECIPES, "probe_gpu.py");
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "lg-test-"));
      fs.writeFileSync(path.join(d, "t.json"), JSON.stringify({ kind: "run", input: {}, job: { params: {} }, work: d }));
      sources.test = { id: "test", name: "测试：这台电脑能不能算", source: fs.readFileSync(file, "utf8") };
      send("test", { k: "source", v: sources.test });
      const res = await new Promise((ok) => {
        const c = spawn(env.python(), ["-u", file], { cwd: d, windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(__dirname, "..", "py").replace(/app\.asar([\\/])/, "app.asar.unpacked$1"), PYTHONIOENCODING: "utf-8", LG_TASK: path.join(d, "t.json"), LG_RECIPE: file } });
        let result = null, buf = "";
        const line = (l) => {
          if (l.startsWith("@@lg ")) { try { const m = JSON.parse(l.slice(5)); if (m.t === "result") result = m; send("test", { k: m.t, v: m }); } catch (e) {} }
          else if (l.trim()) send("test", { k: "log", v: { msg: l } });
        };
        const on = (s) => s.on("data", (x) => { buf += x.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); } });
        on(c.stdout); on(c.stderr);
        c.on("error", (e) => { send("test", { k: "log", v: { msg: "启动 Python 失败：" + e.message } }); ok({ ok: false, why: "没找到 Python：先做第 2 步" }); });
        c.on("exit", () => ok(result || { ok: false, why: "测试没跑完" }));
      });
      fs.rmSync(d, { recursive: true, force: true });
      cfg.testResult = { ...res, t: undefined, at: Date.now() }; save();
      return cfg.testResult;
    },
    // ---- ④ 装 AI 引擎（画 Q版用；显卡 8G 以上才要装）----
    aiCheck: async () => { const r = await ai.check(); if (agent) agent.setCaps(capsNow()); return { ...r, ...aiInfo() }; },
    async aiInstall() {
      if (!/^[\x20-\x7e]+$/.test(base()) || /\s/.test(base())) throw new Error("现在的位置（" + base() + "）里有中文或空格，ComfyUI 放在这种地方会出错：先在第 1 步点「换个地方」，选 D 盘");
      const r = await ai.install(path.join(base(), "ai"));
      delete cfg.aiSkipped; save();
      if (agent) agent.setCaps(capsNow());
      return { ...r, ...aiInfo() };
    },
    async aiUseDir() {
      const d = o.pickDir ? await o.pickDir("选已经装好的 ComfyUI 整合包文件夹（比如捞捞PPT助手装的 LaolaoAI-ComfyUI 里面那个）") : null;
      if (!d) return null;
      const r = await ai.useDir(d);
      if (agent) agent.setCaps(capsNow());
      return { ...r, ...aiInfo() };
    },
    aiCancel: async () => ai.cancel(),
    async skipAi(v = true) { cfg.aiSkipped = !!v; save(); return H.status(); },
    // ---- ⑤ 挂机 ----
    async setPolicy(p) { cfg.policy = { ...(cfg.policy || {}), ...p }; cfg.policySet = true; save(); if (agent) agent.setPolicy(cfg.policy); if (o.setAutostart && p.autostart != null) { cfg.autostart = !!p.autostart; o.setAutostart(cfg.autostart); save(); } return cfg.policy; },
    // 录表情是自愿的：不录也不影响帮忙算
    async skipRecord(v = true) { cfg.recordSkipped = !!v; save(); return H.status(); },
    async pause(v) { return (await H.setManual(v ? "off" : "auto")) === "off"; },
    // 手动开始（on）/ 停止（off）/ 按挂机设置自动（auto）
    async setManual(m) { cfg.manual = ["on", "off"].includes(m) ? m : "auto"; delete cfg.paused; save(); if (agent) agent.setManual(cfg.manual); o.onManual && o.onManual(cfg.manual); return cfg.manual; },
    // ---- 看 ----
    overview: () => api("/api/overview"),
    me: () => api("/api/me"),
    board: () => api("/api/board"),
    source: async (id) => sources[id] || null,
    gallery: async () => gallery.slice(0, 40),
    // 刚生成的图（只给本机工作文件夹里的，转成 data: 给界面显示）
    async thumb(f) {
      const r = path.resolve(String(f || ""));
      if (!r.startsWith(path.resolve(work()) + path.sep) || !/\.(png|jpe?g|webp)$/i.test(r)) return null;
      const b = await fs.promises.readFile(r).catch(() => null);
      if (!b || b.length > 8e6) return null;
      return `data:image/${/png$/i.test(r) ? "png" : /webp$/i.test(r) ? "webp" : "jpeg"};base64,` + b.toString("base64");
    },
    agentStatus: async () => (agent ? agent.status() : null),
    // ---- 人工审核 ----
    reviewNext: () => api("/api/review/next"),
    vote: (id, choice) => api("/api/review/vote", { review: id, choice }),
    // ---- ④ 录表情：一段一段领；每句的录音 + 表情参数（不存视频）先存本机，交的时候一起传 ----
    recordNext: (job) => api("/api/human/next", { job }),
    async recordSave(task, idx, audio, params) {
      const d = path.join(work(), "record", String(task));
      fs.mkdirSync(d, { recursive: true });
      const a = path.join(d, `s${String(idx).padStart(3, "0")}.webm`), p = path.join(d, `s${String(idx).padStart(3, "0")}.json`);
      fs.writeFileSync(a, Buffer.from(audio));
      fs.writeFileSync(p, JSON.stringify(params));
      return { audio: a, params: p, size: audio.length };
    },
    async recordSubmit(task, jobId, secs) {
      const d = path.join(work(), "record", String(task));
      const files = fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
      if (!files.length) throw new Error("还没录");
      const outputs = [];
      for (const f of files) { outputs.push(await agent.upload(jobId, task, path.join(d, f), "rec")); send("record", { k: "upload", v: { done: outputs.length, total: files.length } }); }
      const r = await api("/api/human/done", { task, outputs, result: { secs, sentences: files.length / 2 } });
      fs.rmSync(d, { recursive: true, force: true });
      cfg.recorded = (cfg.recorded || 0) + 1; save();
      return r;
    },
    // ---- 控制中心（管理员）----
    adminUrl: async () => (cfg.member && cfg.member.role === "admin" ? `${cfg.server}/admin/#t=${encodeURIComponent(cfg.token)}` : null),
    openAdmin: async () => { const u = await H.adminUrl(); if (u && o.openAdmin) o.openAdmin(u); return !!u; },
    openWork: async () => { fs.mkdirSync(work(), { recursive: true }); o.openPath && o.openPath(work()); return true; },
  };
  // 自动更新（只在装好的软件里开；开发和测试时 o.install 没给就不开）
  let recording = false;
  const updater = Updater.create({ dir: base, version: o.version, agent: () => agent, idleSecs: o.idleSecs, windowHidden: o.windowHidden, recording: () => recording,
    install: o.install || (async () => { throw new Error("这个版本不能自动更新"); }), onEvent: (e) => send("update", e), ...(o.updaterOpt || {}) });
  if (o.install && o.autoUpdate !== false) updater.start();
  H.updateStatus = async () => updater.status();
  H.updateCheck = async () => updater.check();
  H.updateNow = async () => updater.now();
  H.recording = async (v) => { recording = !!v; return recording; };
  if (cfg.token) startAgent();
  return { H, shutdown: async () => { updater.stop(); if (agent) await agent.stop(); try { ai.stop(); } catch (e) {} }, agent: () => agent, updater, ai };
}

module.exports = { createService };
