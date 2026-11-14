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
const LLMW = require("./llmw");
const GSVW = require("./gsvw");
const Power = require("./power");
const Logs = require("./logs");
const Disk = require("./disk");
const Region = require("./region");

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
  // 下载源按地区排：国内先腾讯云，国外先自己的 GitHub（region 在下面建，这里用到时已经有了）
  const regionNow = () => { try { return region.current(); } catch (e) { return "cn"; } };
  const mkEnv = () => Env.create({ dir: path.join(base(), "env"), python: o.python || cfg.python, onEvent: (e) => send("env", e), region: regionNow });
  let env = mkEnv();
  let agent = null, lastProbe = cfg.probe || null, sources = {};
  // AI 引擎（ComfyUI + 画 Q版的模型），装在数据文件夹的 ai 里
  const ai = (o.aiFactory || AI.create)({ get: () => cfg.ai, set: (v) => { cfg.ai = v; save(); }, onEvent: (e) => send("ai", e),
    vram: () => (lastProbe && lastProbe.caps && lastProbe.caps.vram) || 0, gpuName: () => (lastProbe && lastProbe.caps && lastProbe.caps.gpu) || "", mirrorOpt: { region: regionNow }, ...(o.aiOpt || {}) });
  // 本地大模型（llama.cpp 跟着安装包走）；和 ComfyUI 抢显存：开一个先关另一个
  const llmMirror = (() => { try { return require(path.join(__dirname, "ppt", "mirror.js")).create({ region: regionNow }); } catch (e) { return null; } })();
  const llm = (o.llmFactory || LLMW.create)({ exe: o.llamaExe, base: () => base(), mirror: llmMirror, region: regionNow, beforeStart: async () => { try { ai.stop(); } catch (e) {} }, ...(o.llmOpt || {}) });
  const comfy = { ...ai, ensure: async () => { llm.stop(); return ai.ensure(); } };
  // GPT-SoVITS（训练声音）：第一次用的时候自动装；训练前关掉 ComfyUI 和本地大模型
  const gsv = (o.gsvFactory || GSVW.create)({ base: () => base(), get: () => cfg.gsv, set: (v) => { cfg.gsv = { ...(cfg.gsv || {}), ...v }; save(); },
    gpuName: () => (lastProbe && lastProbe.caps && lastProbe.caps.gpu) || "", mirrorOpt: { region: regionNow }, beforeStart: async () => { try { ai.stop(); } catch (e) {} try { llm.stop(); } catch (e) {} }, ...(o.gsvOpt || {}) });
  // 显存上限（设置里可以留一点给自己用）：领活的时候只说这么多
  const capsNow = () => { const c = { ...((lastProbe && lastProbe.caps) || {}), comfy: !!(cfg.ai && cfg.ai.ready), llm: llm.ok(), gsv: process.platform === "win32" || !!(cfg.gsv && cfg.gsv.dir) }; if (cfg.set && cfg.set.vramCap && c.vram) c.vram = Math.min(c.vram, cfg.set.vramCap); return c; };
  // ---- 设置（默认值）、日志、防休眠、硬盘、地区 ----
  const SET0 = { autostart: true, keepAwake: true, lid: false, pauseOnBattery: true, notify: true, netLimit: 0, vramCap: 0, maxPower: 0, region: "auto", pro: false, keepTaskDays: 2, stallMin: 45, multiGpu: true };
  const set = () => ({ ...SET0, ...(cfg.set || {}) });
  const logs = Logs.create({ dir: base, onLine: (l) => send("log", l) });
  const L = (m, lv, src) => logs.add(m, lv, src);
  const power = (o.powerFactory || Power.create)({ powerSaveBlocker: o.powerSaveBlocker, log: (m) => L(m, "info", "防休眠"), ...(o.powerOpt || {}) });
  const region = (o.regionFactory || Region.create)({ get: () => cfg.region, set: (v) => { cfg.region = v; save(); }, pref: () => set().region, log: (m) => L(m, "info", "下载源"), ...(o.regionOpt || {}) });
  const notify = (title, body, kind = "") => { if (!set().notify || !o.notify) return; if (kind && set()["no_" + kind]) return; try { o.notify(title, body); } catch (e) {} L(`${title}：${body}`, "info", "通知"); };
  Agent.setNetLimit(set().netLimit);
  if (cfg.autostart === undefined && cfg.set === undefined && o.setAutostart) { cfg.autostart = true; try { o.setAutostart(true); } catch (e) {} save(); }   // 第一次用：默认开机自启（藏在托盘里，接着上次的状态）
  const gallery = [];

  function startAgent() {
    if (agent || !cfg.token) return;
    agent = Agent.create({
      server: cfg.server, token: cfg.token, pubkey: cfg.pubkey, workDir: work(), python: () => env.python(),
      caps: lastProbe ? capsNow() : null, comfy, llm, gsv, policy: { mode: "off", idleMin: 5, ...(cfg.policy || {}), pauseOnBattery: set().pauseOnBattery, maxPower: set().maxPower },   // 默认：自己点「开始」才算
      idleSecs: o.idleSecs, onBattery: o.onBattery, stallMin: set().stallMin, region: regionNow, ensure: (pkgs) => env.ensure(pkgs), version: o.version, gpuInfo: async () => (await probe.gpus())[0] || null, gpuApps: (ours) => probe.gpuApps(undefined, ours),
      env: lanes.length ? { CUDA_VISIBLE_DEVICES: "0" } : {},
      extraInfo: () => ({ lanes: lanes.length, region: region.current(), awake: power.status().awake, autostart: !!cfg.autostart, pro: !!set().pro, lid: !!set().lid, set: set() }),
      ...(o.agentOpt || {}),
    });
    agent.on("any", ({ k, v }) => {
      if (k === "log") L(v.msg, v.level, "算力");
      if (k === "state") { L(`状态：${STATE_NAMES[v.state] || v.state}${v.why ? "（" + v.why + "）" : ""}`, "info", "算力"); onState(v); }
      if (k === "task") { taskStart[v.id] = Date.now(); }
      if (k === "done") onDone(v);
      if (k === "command") onCommand(v).catch((e) => L("远程命令出错：" + e.message, "error", "遥控"));
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
    startLanes().catch((e) => L("多显卡没开起来：" + e.message, "warn", "多显卡"));
  }
  // ---------- 一台电脑好几块 NVIDIA 显卡：每多一块开一个「工位」，各领各的任务 ----------
  //   第 2 块起只做纯 Python 的任务（训练、评测、数据处理）：AI 引擎、本地大模型、GPT-SoVITS 一台电脑只开一个，留在第 1 块上
  let lanes = [];
  async function startLanes() {
    if (!set().multiGpu || !agent || lanes.length) return;
    const gs = o.gpuList ? await o.gpuList() : await probe.gpus();
    if (gs.length < 2) return;
    cfg.lanes = cfg.lanes || {};
    for (let i = 1; i < gs.length; i++) {
      const g = gs[i];
      let ln = cfg.lanes[i];
      if (!ln || !ln.token) {
        const r = await agent.api("/api/lane", { gpu: i, name: cfg.deviceName, info: { gpu: g.name, vram: g.vram } });
        ln = cfg.lanes[i] = { token: r.token, device: r.device, name: r.name }; save();
      }
      const a = Agent.create({ server: cfg.server, token: ln.token, pubkey: cfg.pubkey, workDir: path.join(work(), "gpu" + i), python: () => env.python(),
        caps: { ...capsNow(), gpu: g.name, vram: cfg.set && cfg.set.vramCap ? Math.min(g.vram, cfg.set.vramCap) : g.vram, comfy: false, llm: false, gsv: false, lane: i },
        policy: { mode: "off", idleMin: 5, ...(cfg.policy || {}), pauseOnBattery: set().pauseOnBattery, maxPower: set().maxPower },
        idleSecs: o.idleSecs, onBattery: o.onBattery, stallMin: set().stallMin, region: regionNow, ensure: (pkgs) => env.ensure(pkgs), version: o.version,
        env: { CUDA_VISIBLE_DEVICES: String(i) }, gpuInfo: async () => (o.gpuList ? await o.gpuList() : await probe.gpus())[i] || null, gpuApps: async () => [],
        extraInfo: () => ({ lane: i, main: cfg.device, region: region.current() }), ...(o.agentOpt || {}) });
      a.on("any", ({ k, v }) => { if (k === "log") L(v.msg, v.level, "第 " + (i + 1) + " 块显卡"); if (k === "state" && agent) onState(agent.status()); if (k === "done") onDone(v); if (k === "command") onCommand(v, a).catch(() => {}); });
      a.setManual(cfg.manual || "auto");
      a.start();
      lanes.push(a);
      L(`第 ${i + 1} 块显卡（${g.name}，${g.vram}G）也开始帮忙：控制中心里叫「${ln.name}」`, "info", "多显卡");
    }
    if (agent) agent.setEnv && agent.setEnv({ CUDA_VISIBLE_DEVICES: "0" });
  }
  async function stopLanes() { const ls = lanes; lanes = []; for (const a of ls) { try { await a.stop(); } catch (e) {} } }
  // 要算的时候不让电脑睡：正在算、或者能算在等任务（「开始」了 / 在定时的时间里）；停了、在等你不用电脑、拔了电就照常睡
  const STATE_NAMES = { starting: "启动", waiting: "等着", idle: "在等任务", busy: "在算", paused: "停了", offline: "连不上调度中心" };
  const taskStart = {};
  function onState(v) {
    const on = (x) => x.state === "busy" || x.state === "idle" || (x.state === "offline" && cfg.manual === "on");
    const want = set().keepAwake && (on(v) || lanes.some((a) => on(a.status())));
    power.keepAwake(want, v.state === "busy" ? "正在算" : "在等任务");
    if (v.state === "waiting" && /拔了电源/.test(v.why || "")) notify("拔了电源，先停一下", "插上电就接着算（正在算的交给别的电脑从存档接着算）", "battery");
    if (v.state === "waiting" && /℃/.test(v.why || "")) notify("显卡太热，歇一会儿", v.why, "temp");
  }
  function onDone(v) {
    const secs = taskStart[v.id] ? (Date.now() - taskStart[v.id]) / 1000 : 0; delete taskStart[v.id];
    if (v.ok && secs > 600) notify("算完一个大任务", `用了 ${Math.round(secs / 60)} 分钟`, "done");
    if (!v.ok && !v.stopped) notify("任务出错了", String(v.error || v.why || "").slice(0, 120) + "（详情看「我的电脑」的日志）", "error");
  }
  const smallGpu = () => !!(lastProbe && lastProbe.caps && lastProbe.caps.vram < 7.5);
  const aiInfo = () => ({ ready: !!(cfg.ai && cfg.ai.ready), dir: (cfg.ai && cfg.ai.dir) || "", skipped: !!cfg.aiSkipped, smallGpu: smallGpu(), ram: (lastProbe && lastProbe.caps && lastProbe.caps.ram) || 0 });
  const api = (p, b) => { if (!agent) throw new Error("还没加入训练网"); return agent.api(p, b); };

  const H = {
    // ---- 加入 ----
    async status() {
      return {
        joined: !!cfg.token, server: cfg.server || "", dataDir: base(), me: cfg.member || null, deviceId: cfg.device || null, recorded: cfg.recorded || 0, deviceName: cfg.deviceName || "", version: o.version,
        agent: agent ? agent.status() : null, lanes: lanes.map((a) => { const x = a.status(); return { state: x.state, why: x.why, task: x.task && { job: x.task.job, progress: x.task.progress }, gpu: x.gpu }; }), probe: lastProbe, policy: cfg.policy || (agent && agent.policy) || null, paused: cfg.manual === "off", manual: cfg.manual || "auto",
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
    async setManual(m) { cfg.manual = ["on", "off"].includes(m) ? m : "auto"; delete cfg.paused; save(); if (agent) agent.setManual(cfg.manual); for (const a of lanes) a.setManual(cfg.manual); o.onManual && o.onManual(cfg.manual); return cfg.manual; },
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
    install: o.install || (async () => { throw new Error("这个版本不能自动更新"); }), onEvent: (e) => { send("update", e); if (e.state === "ready" && !e.waiting) L(`新版 ${e.latest} 下载好了`, "info", "更新"); },
    notify: (t, b) => notify(t, b, "update"), ...(o.updaterOpt || {}) });
  if (o.install && o.autoUpdate !== false) updater.start();
  H.updateStatus = async () => updater.status();
  H.updateCheck = async () => updater.check();
  H.updateNow = async () => updater.now();
  H.recording = async (v) => { recording = !!v; return recording; };

  // ---------- 设置 ----------
  H.settings = async () => ({ ...set(), autostart: !!cfg.autostart, region: set().region, regionInfo: region.info(), power: power.status(), onBattery: o.onBattery ? await o.onBattery() : false, version: o.version });
  H.setSettings = async (p = {}) => {
    const cur = set(), next = { ...cur };
    for (const k of Object.keys(SET0)) if (p[k] !== undefined) next[k] = typeof SET0[k] === "number" ? Math.max(0, +p[k] || 0) : typeof SET0[k] === "boolean" ? !!p[k] : String(p[k]);
    for (const k of Object.keys(p)) if (/^no_\w+$/.test(k)) next[k] = !!p[k];
    if (!["auto", "cn", "global"].includes(next.region)) next.region = "auto";
    if (p.autostart !== undefined && o.setAutostart) { cfg.autostart = !!p.autostart; try { o.setAutostart(cfg.autostart); } catch (e) {} }
    if (next.lid !== cur.lid) { const r = await power.lidKeepRunning(next.lid, cfg.lidSaved); if (!r.ok) { next.lid = cur.lid; L(r.why, "warn", "防休眠"); } else cfg.lidSaved = r.saved; }
    cfg.set = next; save();
    Agent.setNetLimit(next.netLimit);
    if (next.region !== cur.region) region.detect(true).catch(() => {});
    if (agent) { agent.setPolicy({ pauseOnBattery: next.pauseOnBattery, maxPower: next.maxPower }); agent.setCaps(capsNow()); }
    if (!next.keepAwake) power.keepAwake(false); else if (agent) onState(agent.status());
    if (next.multiGpu !== cur.multiGpu) { if (next.multiGpu) startLanes().catch(() => {}); else await stopLanes(); }
    L("改了设置：" + Object.keys(p).join("、"), "info", "设置");
    return H.settings();
  };
  H.redetectRegion = async () => { await region.detect(true); return region.info(); };

  // ---------- 日志 ----------
  H.logDays = async () => logs.days();
  H.logRead = async (q) => logs.read(q || {});
  H.logRecent = async (n) => logs.recent(n || 300);
  H.logExport = async () => { const f = logs.bundle(3, diagText()); o.reveal ? o.reveal(f) : o.openPath && o.openPath(path.dirname(f)); return f; };
  H.logOpenDir = async () => { fs.mkdirSync(logs.dir(), { recursive: true }); o.openPath && o.openPath(logs.dir()); return true; };
  function diagText() {
    const c = { ...cfg }; delete c.token; delete c.pubkey;   // 口令不放进去
    const a = agent ? agent.status() : null;
    return ["===== 捞捞算力诊断信息 =====", `版本 ${o.version}  系统 ${os.platform()} ${os.release()}  ${os.cpus()[0] ? os.cpus()[0].model : ""}  内存 ${Math.round(os.totalmem() / 1e9)}G`,
      "设置：" + JSON.stringify(set()), "体检：" + JSON.stringify(lastProbe && lastProbe.caps), "状态：" + JSON.stringify(a && { state: a.state, why: a.why, manual: a.manual, task: a.task && a.task.job && a.task.job.name }),
      "配置：" + JSON.stringify(c).slice(0, 4000), "防休眠：" + JSON.stringify(power.status()), "下载源：" + JSON.stringify(region.info()), ""].join("\n");
  }

  // ---------- 硬盘和缓存 ----------
  const disk = Disk.create({ base, lowGB: 20, parts: () => {
    const curDir = agent && agent.current() ? agent.current().dir : "";
    return [
      { id: "env", name: "训练环境（Python + PyTorch）", path: path.join(base(), "env"), note: "删了要重装" },
      { id: "ai", name: "AI 引擎和画图模型、GPT-SoVITS", path: path.join(base(), "ai"), note: "删了要重新下（几十 G）" },
      { id: "llm", name: "本地大模型", path: path.join(base(), "llm"), cleanable: "all", note: "用到时会自动重新下" },
      { id: "tasks", name: "任务文件（每个任务下的数据、中间结果）", path: path.join(work(), "tasks"), cleanable: "old", keepDays: 0, keep: (f) => !!curDir && path.resolve(f) === path.resolve(curDir), note: "算完的都可以删（正在算的留着）" },
      { id: "cache", name: "缓存（下过的模型、公开数据）", path: path.join(work(), "cache"), cleanable: "all", note: "用到时会重新下" },
      { id: "recipes", name: "配方", path: path.join(work(), "recipes"), cleanable: "all", note: "很小，用到时重新下" },
      { id: "update", name: "新版本安装包", path: path.join(base(), "update"), cleanable: "all" },
      { id: "logs", name: "日志", path: logs.dir(), cleanable: "old", keepDays: 1, note: "只留今天的" },
    ];
  } });
  H.diskReport = async () => disk.report();
  H.diskClean = async (id) => { const r = await disk.clean(id); L(`清理「${id}」：腾出 ${(r.freed / 1e9).toFixed(2)}G`, "info", "硬盘"); return r; };
  // 每 6 小时：删掉几天前算完的任务文件夹；硬盘快满了提醒（一天最多一次）
  async function housekeeping() {
    try {
      const curDir = agent && agent.current() ? agent.current().dir : "";
      await disk.cleanOld(path.join(work(), "tasks"), set().keepTaskDays, (f) => !!curDir && path.resolve(f) === path.resolve(curDir));
      for (const a of lanes) { const c = a.current(); await disk.cleanOld(path.join(work(), "gpu" + (lanes.indexOf(a) + 1), "tasks"), set().keepTaskDays, (f) => !!c && path.resolve(f) === path.resolve(c.dir)); }
      const fr = await disk.free(base());
      if (fr != null && fr < 20e9 && Date.now() - (cfg.lowDiskAt || 0) > 86400e3) { cfg.lowDiskAt = Date.now(); save(); notify("硬盘快满了", `数据文件夹所在的盘只剩 ${(fr / 1e9).toFixed(1)}G：打开捞捞算力「设置 → 硬盘」清理一下`, "disk"); }
    } catch (e) {}
  }
  const hk = setInterval(housekeeping, 6 * 3600e3); hk.unref && hk.unref();
  setTimeout(housekeeping, 120e3).unref?.();

  // ---------- 控制中心遥控 ----------
  async function onCommand(c, from) {
    let ok = true, result = null;
    try {
      if (c.cmd === "start") result = await H.setManual("on");
      else if (c.cmd === "stop") result = await H.setManual("off");
      else if (c.cmd === "auto") result = await H.setManual("auto");
      else if (c.cmd === "update") { result = await updater.now().catch((e) => { throw e; }); if (!result) { ok = false; result = updater.status().error || "现在没有新版本，或者这个版本不能自动更新"; } }
      else if (c.cmd === "restart") { result = "马上重启"; setTimeout(() => o.restart && o.restart(), 1500); }
      else if (c.cmd === "logs") result = await uploadLogs(c.args && c.args.days);
      else if (c.cmd === "clean") { const a = await disk.clean("tasks"); const b = await disk.clean("cache"); result = `腾出 ${((a.freed + b.freed) / 1e9).toFixed(2)}G`; }
      else if (c.cmd === "probe") { const r = await H.probe(); result = r.caps; }
      else if (c.cmd === "settings") result = await H.setSettings(c.args || {});
      else { ok = false; result = "不认识的命令"; }
    } catch (e) { ok = false; result = e.message; }
    L(`遥控「${c.cmd}」${ok ? "做好了" : "没做成"}：${typeof result === "string" ? result : JSON.stringify(result || "").slice(0, 200)}`, ok ? "info" : "warn", "遥控");
    const who = from || agent;
    if (who) await who.cmdDone(c.id, ok, result);
  }
  async function uploadLogs(days) {
    const f = logs.bundle(Math.min(7, +days || 2), diagText());
    const r = await api("/api/logs/put", { name: path.basename(f) });
    await Agent.xfer("PUT", r.url, f);
    fs.rmSync(f, { force: true });
    return { key: r.key };
  }
  H.uploadLogs = async () => uploadLogs(2);

  // ---------- 专业模式：任务控制台、诊断 ----------
  H.taskDir = async () => { const c = agent && agent.current(); if (!c) return null; o.openPath && o.openPath(c.dir); return c.dir; };
  H.killTask = async () => { if (!agent || !agent.current()) return false; await agent.kill("在本机结束了这个任务"); return true; };
  H.diag = async () => diagText();

  // ---------- 看门狗：主循环卡住了就重开 ----------
  const wd = setInterval(async () => {
    if (!agent) return;
    if (Date.now() - agent.lastTick() > (o.watchdogMs || 5 * 60e3)) {
      L("后台好像卡住了：自动重开（正在算的交给别的电脑从存档接着算）", "error", "看门狗");
      const a = agent; agent = null;
      try { await Promise.race([a.stop(), new Promise((r) => setTimeout(r, 30e3))]); } catch (e) {}
      startAgent();
    }
  }, o.watchdogTick || 60e3);
  wd.unref && wd.unref();

  // ---------- 每天早上 9 点：昨天帮忙算了多少 ----------
  const daily = setInterval(async () => {
    const d = new Date();
    const key = d.toISOString().slice(0, 10);
    if (d.getHours() < 9 || cfg.dailyAt === key || !agent) return;
    cfg.dailyAt = key; save();
    try {
      const r = await api("/api/me/stats?days=2");
      const y = (r.days || []).find((x) => x.day !== r.today) || null;
      if (y && y.busySecs > 60) notify("昨天的贡献", `这台电脑昨天算了 ${(y.busySecs / 3600).toFixed(1)} 小时、做完 ${y.tasks} 个任务，谢谢！`, "daily");
    } catch (e) {}
  }, 10 * 60e3);
  daily.unref && daily.unref();

  if (o.detectRegion !== false) { const rt = setTimeout(() => region.detect().catch(() => {}), 30e3); rt.unref && rt.unref(); }
  if (cfg.token) startAgent();
  L(`启动 ${o.version}（${o.hidden ? "开机自启，藏在托盘" : "打开了窗口"}）；上次的状态：${cfg.manual || "auto"}`, "info", "软件");
  return { H, logs, power, region, lanes: () => lanes, shutdown: async () => { updater.stop(); clearInterval(wd); clearInterval(daily); clearInterval(hk); await stopLanes(); if (agent) await agent.stop(); power.keepAwake(false); logs.flush(); try { ai.stop(); } catch (e) {} try { llm.stop(); } catch (e) {} }, agent: () => agent, updater, ai, llm };
}

// 数据文件夹在哪（主进程启动时就要知道：找上次下好的新版安装包）
function dataBaseOf(user) { try { return JSON.parse(fs.readFileSync(path.join(user, "grid.json"), "utf8")).dataDir || user; } catch (e) { return user; } }
module.exports = { createService, dataBaseOf };
