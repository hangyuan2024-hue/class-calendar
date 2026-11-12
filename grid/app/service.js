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

const RECIPES = path.join(__dirname, "..", "recipes").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");  // 打包后 Python 读不了 asar 里的文件

function createService(o) {
  const dir = o.user;
  fs.mkdirSync(dir, { recursive: true });
  const CFG = path.join(dir, "grid.json");
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) {}
  const save = () => fs.writeFileSync(CFG, JSON.stringify(cfg, null, 1));
  const send = (ch, d) => { try { o.send(ch, d); } catch (e) {} };
  const work = () => cfg.workDir || path.join(dir, "work");
  const env = Env.create({ dir: path.join(dir, "env"), python: o.python || cfg.python, onEvent: (e) => send("env", e) });
  let agent = null, lastProbe = cfg.probe || null, sources = {};
  const gallery = [];

  function startAgent() {
    if (agent || !cfg.token) return;
    agent = Agent.create({
      server: cfg.server, token: cfg.token, pubkey: cfg.pubkey, workDir: work(), python: () => env.python(),
      caps: lastProbe ? lastProbe.caps : null, policy: cfg.policy || { mode: "idle", idleMin: 5 },
      idleSecs: o.idleSecs, ensure: (pkgs) => env.ensure(pkgs), gpuInfo: async () => (await probe.gpus())[0] || null, gpuApps: (ours) => probe.gpuApps(undefined, ours),
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
    if (cfg.paused) agent.pause(true);
    agent.start();
  }
  const api = (p, b) => { if (!agent) throw new Error("还没加入训练网"); return agent.api(p, b); };

  const H = {
    // ---- 加入 ----
    async status() {
      return {
        joined: !!cfg.token, server: cfg.server || "", me: cfg.member || null, deviceId: cfg.device || null, deviceName: cfg.deviceName || "", version: o.version,
        agent: agent ? agent.status() : null, probe: lastProbe, policy: cfg.policy || (agent && agent.policy) || null, paused: !!cfg.paused,
        python: cfg.python || "", env: cfg.envOk || null, testResult: cfg.testResult || null, consent: cfg.consent || null, autostart: !!cfg.autostart,
        steps: { probe: !!(lastProbe && lastProbe.ok), env: !!(cfg.envOk && cfg.envOk.ok), test: !!(cfg.testResult && cfg.testResult.ok), record: !!cfg.recorded, policy: !!cfg.policySet },
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
      if (agent) agent.setCaps(lastProbe.caps);
      return lastProbe;
    },
    // ---- ② 装环境 ----
    envCheck: async () => { const r = await env.check(); cfg.envOk = r; save(); return r; },
    async envInstall() { const r = await env.install(); cfg.envOk = r; save(); return r; },
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
    // ---- ⑤ 挂机 ----
    async setPolicy(p) { cfg.policy = { ...(cfg.policy || {}), ...p }; cfg.policySet = true; save(); if (agent) agent.setPolicy(cfg.policy); if (o.setAutostart && p.autostart != null) { cfg.autostart = !!p.autostart; o.setAutostart(cfg.autostart); save(); } return cfg.policy; },
    async pause(v) { cfg.paused = !!v; save(); if (agent) agent.pause(cfg.paused); return cfg.paused; },
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
  if (cfg.token) startAgent();
  return { H, shutdown: async () => { if (agent) await agent.stop(); }, agent: () => agent };
}

module.exports = { createService };
