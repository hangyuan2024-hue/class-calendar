// 捞捞编程 · 主进程里的全部功能（文件、运行、练习、安装语言、本地模型、账号），不依赖 Electron：
// main.js 把 Electron 的对话框、回收站、窗口消息传进来；测试时（test/ui-server.js）用 Node 自己的实现。
"use strict";
const fs = require("fs");
const path = require("path");
const { LANGS, byId, langOfFile, locate } = require("./langs");
const { Session, runOnce, runMany } = require("./runner");
const TC = require("./toolchains");
const AI = require("./ai");
const { messages, options: tutorOptions } = require("./tutor");
const { EX, BANKS, starter, check } = require("./exercises");
const { Progress, sync } = require("./account");
const VIZ = require("./viz");
const TRACE = require("./trace");
const { Bank, leetcodeRecent, codeforcesSolved } = require("./judge");
const { Skill } = require("./skill");
const PB = require("./problems");

// env：{ dev, res, user, documents, version, platform, send(ch, data), pickDir(), pickFile(exts), trash(f), reveal(f), openPath(d), openExternal(u), siteConfig }
function createService(env) {
  const DEV = !!env.dev;
  const RES = env.res;
  const USER = env.user;
  const DIRS = { bundled: path.join(RES, "toolchains"), user: path.join(USER, "toolchains") };
  const BUILD = path.join(USER, "build");
  const LLAMA = path.join(RES, "llama", process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const MODEL_DIRS = [path.join(RES, "models"), path.join(USER, "models")];
  const SETTINGS_FILE = path.join(USER, "settings.json");

  const send = (ch, data) => env.send(ch, data);

  // ---------- 设置 ----------
  let settings = { workspace: "", recent: [], fontSize: 15, theme: "dark", lastFile: "", aiOpen: true };
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch (e) {}
  const saveSettings = () => { try { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1)); } catch (e) {} };
  function workspace() {
    if (settings.workspace && fs.existsSync(settings.workspace)) return settings.workspace;
    const d = path.join(env.documents, "捞捞编程");
    fs.mkdirSync(d, { recursive: true });
    settings.workspace = d; saveSettings();
    return d;
  }

  // ---------- 账号 ----------
  const progress = new Progress(path.join(USER, "progress.json"));
  const bank = new Bank(path.join(USER, "judge-cache.json"));
  const skill = new Skill(path.join(USER, "skill.json"));
  const traces = {};
  // 哪个文件是哪道题：{ 文件路径: { id, lang } }
  const probFile = path.join(USER, "problem-files.json");
  let probFiles = {}; try { probFiles = JSON.parse(fs.readFileSync(probFile, "utf8")); } catch (e) {}
  const saveProbFiles = () => { try { fs.writeFileSync(probFile, JSON.stringify(probFiles)); } catch (e) {} };
  const tries = {};
  // 生成的文件里的行号 → 你的代码里的行号
  const fixLines = (t, from, to, pre) => String(t || "").split(from).join(to).replace(new RegExp(to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\d+)", "g"), (m0, n) => to + ":" + Math.max(1, n - pre));
  // 报错里的行号（line、改法 fix、中文提示里的「第 N 行」）都减掉前面多出来的行；不在你代码里的（自动生成的 main）不要
  const shiftDiags = (ds, pre, n) => (ds || []).map((d) => ({ ...d, line: d.line - pre, hint: String(d.hint || "").replace(/第 (\d+) 行/g, (m0, k) => `第 ${k - pre} 行`),
    fix: d.fix ? { ...d.fix, line: d.fix.line - pre, endLine: d.fix.endLine - pre } : d.fix })).filter((d) => d.line > 0 && d.line <= n);
  const runErr = (err, lang) => { const t = String(err || "").trim().split("\n").filter(Boolean); return lang === "python" ? t.slice(-1)[0] || "" : t.slice(0, 2).join(" ").slice(0, 200); };    // 正在跑的「画出来」：{ channel: { kill } }
  const exTries = {};   // 这次打开软件以来每道练习检查了几次（用来估水平）
  const exAsked = new Set();
  let api = null, me = null;
  function makeApi() {
    try {
      const { Api, loadSiteConfig } = require("./api");
      const cfg = loadSiteConfig([env.siteConfig || path.join(__dirname, "site-config.js")]);
      const sf = path.join(USER, "session.json"), rf = path.join(USER, "route.json");
      const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
      const wr = (f, v) => { try { v == null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, JSON.stringify(v)); } catch (e) {} };
      return new Api({ url: cfg.SUPABASE_URL, alt: cfg.SUPABASE_URL_ALT, key: cfg.SUPABASE_ANON_KEY, domain: cfg.AUTH_EMAIL_DOMAIN, store: { load: () => rd(sf), save: (s) => wr(sf, s) }, routeStore: { load: () => rd(rf), save: (i) => wr(rf, i) } });
    } catch (e) { console.error("账号模块没加载：", e.message); return null; }
  }
  async function loadMe() {
    me = null;
    if (!api) return null;
    const s = await api.session().catch(() => null);
    if (!s || !s.user_id) return null;
    try {
      const rows = await api.rest("profiles?select=id,account,display_name&id=eq." + encodeURIComponent(s.user_id));
      me = rows && rows[0] ? rows[0] : { id: s.user_id };
    } catch (e) { me = { id: s.user_id, offline: true }; }
    return me;
  }
  let syncing = null;
  function syncNow() {
    if (!me || syncing) return syncing;
    syncing = sync(api, progress).then((r) => { send("progress", progress.summary()); return r; }).catch((e) => ({ ok: false, reason: e.message })).finally(() => { syncing = null; });
    return syncing;
  }

  // ---------- 文件 ----------
  const CODE_EXT = new Set(LANGS.flatMap((l) => l.exts).concat([".txt", ".md", ".h", ".hpp", ".in"]));
  function listFiles(root, rel = "", depth = 0, out = []) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (e) { return out; }
    names.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, "zh") : a.isDirectory() ? -1 : 1));
    for (const d of names) {
      if (d.name.startsWith(".") || d.name === "node_modules" || out.length > 800) continue;
      const r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) { if (depth < 3) { out.push({ dir: true, rel: r, name: d.name, depth }); listFiles(root, r, depth + 1, out); } }
      else if (CODE_EXT.has(path.extname(d.name).toLowerCase())) out.push({ rel: r, name: d.name, depth, lang: (langOfFile(d.name) || {}).id || "" });
    }
    return out;
  }
  // 界面传来的路径：只认绝对路径的普通文件，不认奇怪的东西
  function safeFile(f) {
    f = String(f || "");
    if (!path.isAbsolute(f) || /\0/.test(f)) throw new Error("文件路径不对");
    return path.normalize(f);
  }
  function pushRecent(f) { settings.recent = [f, ...settings.recent.filter((x) => x !== f)].slice(0, 12); settings.lastFile = f; saveSettings(); }

  // ---------- 运行 ----------
  const session = new Session();
  let lastRun = { output: "", diags: [], file: "" };
  function langStatus() {
    return LANGS.map((L) => {
      const t = locate(L, DIRS, DEV);
      return { id: L.id, name: L.name, exts: L.exts, cm: L.cm, tool: L.tool, template: L.template, ready: !!t, where: t ? t.where : "", installable: !!TC.TOOLS[L.tool], toolName: TC.TOOLS[L.tool] ? TC.TOOLS[L.tool].name : L.name, size: TC.TOOLS[L.tool] ? TC.TOOLS[L.tool].size : "" };
    });
  }

  // ---------- 本地模型 ----------
  let aiChild = null, aiState = { state: "off", msg: "" }, aiStarting = null, aiReq = null, dlSignal = null;
  function setAi(state, msg, extra) { aiState = { state, msg: msg || "", ...(extra || {}) }; send("ai-state", aiState); }
  async function aiStart() {
    if (aiState.state === "ready") return true;
    if (aiStarting) return aiStarting;
    aiStarting = (async () => {
      if (!fs.existsSync(LLAMA)) { setAi("missing", "这个版本没带本地模型程序（llama-server），重新下载安装包试试"); return false; }
      let model = AI.findModel(MODEL_DIRS);
      if (!model) { setAi("need-model", "本地模型还没下载（约 1 GB）"); return false; }
      setAi("starting", "正在启动本地模型，第一次大概要 10~30 秒…");
      try { aiChild = await AI.startServer(LLAMA, model, {}); setAi("ready", AI.MODEL.name); return true; }
      catch (e) { setAi("error", e.message); return false; }
    })().finally(() => { aiStarting = null; });
    return aiStarting;
  }

  // ---------- 界面能调的方法 ----------
  const H = {
    async state() {
      const ws = workspace();
      return {
        dev: DEV, version: env.version, platform: env.platform || process.platform, workspace: ws, files: listFiles(ws), settings,
        langs: langStatus(), exercises: EX.map((e) => ({ id: e.id, bank: e.bank, title: e.title, level: e.level, topic: e.topic, desc: e.desc, tests: e.tests.length, sample: e.tests[0] })), banks: BANKS,
        progress: progress.summary(), me, ai: aiState, model: AI.MODEL.name,
      };
    },
    files() { return listFiles(workspace()); },
    read(f) { f = safeFile(f); const st = fs.statSync(f); if (st.size > 2e6) throw new Error("文件太大了（超过 2MB），不像是代码文件"); return { file: f, text: fs.readFileSync(f, "utf8"), lang: (langOfFile(f) || {}).id || "" }; },
    write(f, text) { f = safeFile(f); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(text)); return true; },
    create(name, langId, text, folder) {
      const L = byId[langId]; name = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
      if (!name) throw new Error("给文件起个名字");
      if (L && !L.exts.includes(path.extname(name).toLowerCase())) name += L.exts[0];
      const dir = folder ? safeFile(folder) : workspace();
      let f = path.join(dir, name), i = 2;
      while (fs.existsSync(f)) { const p = path.parse(name); f = path.join(dir, `${p.name}${i++}${p.ext}`); }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text != null ? String(text) : L ? L.template : "");
      return f;
    },
    mkdir(name) { const d = path.join(workspace(), String(name || "").replace(/[\\/:*?"<>|]/g, "").trim()); if (d === workspace()) throw new Error("给文件夹起个名字"); fs.mkdirSync(d, { recursive: true }); return d; },
    async remove(f) { f = safeFile(f); await env.trash(f); return true; },
    rename(f, name) { f = safeFile(f); name = String(name || "").replace(/[\\/:*?"<>|]/g, "").trim(); if (!name) throw new Error("名字不能空"); const t = path.join(path.dirname(f), name); if (fs.existsSync(t)) throw new Error("已经有同名的文件了"); fs.renameSync(f, t); return t; },
    reveal(f) { env.reveal(safeFile(f)); return true; },
    openWorkspaceFolder() { env.openPath(workspace()); return true; },
    async pickWorkspace() { const d = await env.pickDir(); if (!d) return null; settings.workspace = d; saveSettings(); return settings.workspace; },
    async openFile() { return (await env.pickFile([...CODE_EXT].map((e) => e.slice(1)))) || null; },
    setSettings(o) { for (const k of ["fontSize", "theme", "aiOpen", "lastFile"]) if (o && k in o) settings[k] = o[k]; saveSettings(); return settings; },
    opened(f) { pushRecent(safeFile(f)); return true; },

    // 运行
    run(f, langId) {
      f = safeFile(f);
      if (session.running) session.stop();
      lastRun = { output: "", diags: [], file: f };
      progress.ran(); send("progress", progress.summary());
      session.start(langId || (langOfFile(f) || {}).id, f, { toolDirs: DIRS, allowSystem: DEV, buildDir: BUILD }, {
        phase: (p) => send("run", { type: "phase", phase: p }),
        out: (stream, text) => { lastRun.output = (lastRun.output + text).slice(-8000); send("run", { type: "out", stream, text }); },
        diags: (d) => { lastRun.diags = d; send("run", { type: "diags", diags: d }); },
        exit: (info) => { send("run", { type: "exit", ...info }); if (me) syncNow(); },
      });
      return true;
    },
    input(text) { return session.input(String(text)); },
    endInput() { session.endInput(); return true; },
    stop() { session.stop(); return true; },

    // 练习
    exOpen(id, langId) {
      const ex = EX.find((e) => e.id === id), L = byId[langId];
      if (!ex || !L) throw new Error("没有这道题");
      const dir = path.join(workspace(), "练习", ex.id);
      const f = path.join(dir, (L.id === "java" ? "Main" : ex.id) + L.exts[0]);
      if (!fs.existsSync(f)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, starter(ex, L.id)); }
      return f;
    },
    async exCheck(id, f, langId) {
      const ex = EX.find((e) => e.id === id); if (!ex) throw new Error("没有这道题");
      f = safeFile(f);
      const lang = langId || (langOfFile(f) || {}).id;
      progress.ran();
      let r;
      try { r = await check(ex, (input) => runOnce(lang, f, { toolDirs: DIRS, allowSystem: DEV, buildDir: BUILD }, input)); }
      catch (e) { return { error: e.message, needInstall: e.needInstall || null, lang }; }
      if (r.pass) r.first = progress.solved(id, lang); else progress.tried(id, lang);
      exTries[id] = (exTries[id] || 0) + 1;
      // 估水平：第一次做对才算（同一道题反复做对不重复加分）
      if (!r.pass || !skill.isDone("ex:" + id)) r.skillDelta = skill.exercise(ex, r.pass, exTries[id], exAsked.has(id));
      if (r.pass) delete exTries[id];
      r.progress = progress.summary();
      lastRun = { output: r.results.length ? (r.results[r.results.length - 1].got || "") : r.stderr || "", diags: r.diags || (r.results.slice(-1)[0] || {}).diags || [], file: f };
      if (me) syncNow();
      return r;
    },

    // 画出来：把你自己的代码跑一遍，数组每变一次记一帧（auto：自动在给数组赋值的地方加 SHOW；false：只认你自己写的 SHOW）
    async vizRun(f, stdin, auto = true, text = null) {
      f = safeFile(f);
      const lang = (langOfFile(f) || {}).id;
      if (lang !== "c" && lang !== "cpp") throw new Error("「画出来」现在只支持 C / C++ 文件");
      const src = text != null ? String(text) : fs.readFileSync(f, "utf8");
      const ins = auto ? VIZ.instrument(src) : { src, added: 0, arrays: [], manual: VIZ.hasShow(src) };
      fs.mkdirSync(BUILD, { recursive: true });
      fs.writeFileSync(path.join(BUILD, "laolao_viz.h"), VIZ.HEADER);
      const tag = require("crypto").createHash("md5").update(path.resolve(f)).digest("hex").slice(0, 8);
      const copy = path.join(BUILD, `viz-${tag}${path.extname(f).toLowerCase()}`);
      fs.writeFileSync(copy, ins.src);
      if (text == null) progress.ran();
      let r;
      try { r = await runOnce(lang, copy, { toolDirs: DIRS, allowSystem: DEV, buildDir: BUILD, include: "laolao_viz.h", incDir: /#\s*include\s*"/.test(src) ? path.dirname(f) : "" }, stdin || "", { timeoutMs: 8000 }); }
      catch (e) { return { error: e.message, needInstall: e.needInstall || null, lang }; }
      if (r.compileFailed) return { compileFailed: true, stderr: r.stderr.split(path.basename(copy)).join(path.basename(f)), diags: r.diags, lang };
      const p = VIZ.parseFrames(r.stdout);
      return { frames: VIZ.dedupe(p.frames), noArray: !ins.manual && !ins.added, found: [...VIZ.findArrays(src).keys()], output: p.output, stderr: r.stderr, code: r.code, timedOut: r.timedOut, tooMuch: r.tooMuch, arrays: ins.arrays, manual: !!ins.manual, added: ins.added, lang };
    },

    // 画出来（新）：一行一行走一遍，每一步所有变量都记下来（core/trace.js）。
    // text：编辑器里还没保存的代码（悬浮小窗边打字边画）；channel：float（悬浮小窗）/ main（大画面），同一个 channel 新的来了旧的就停掉
    async traceRun(f, stdin, channel = "main", text = null) {
      f = safeFile(f);
      const lang = (langOfFile(f) || {}).id;
      if (!["c", "cpp", "python"].includes(lang)) return { unsupported: true, lang };
      const ch = String(channel || "main").replace(/\W/g, "").slice(0, 12) || "main";
      let src = f;
      if (text != null) {
        const d = path.join(BUILD, "trace-" + ch, "src");
        fs.mkdirSync(d, { recursive: true });
        src = path.join(d, path.basename(f));
        fs.writeFileSync(src, String(text));
      }
      if (traces[ch]) traces[ch].kill();
      const float = ch === "float";
      // 刷题的文件：力扣题只写了一个函数 → 套上自动生成的 main，用第一个样例跑；Codeforces 题没填输入就用第一个样例
      let shift = null;
      const pf = probFiles[f];
      if (pf) {
        let p = null; try { p = JSON.parse(fs.readFileSync(path.join(USER, "problems", pf.id.replace(/[^\w.-]/g, "_") + ".json"), "utf8")); } catch (e) {}
        const s0 = p && (p.samples || []).find((x) => x.input != null);
        if (p && p.src === "lc" && s0 && !PB.harnessSupport(p.meta, lang)) {
          const code = text != null ? String(text) : fs.readFileSync(f, "utf8");
          let hs = null; try { hs = { c: PB.cHarness, cpp: PB.cppHarness, python: PB.pyHarness }[lang](code, p.meta); } catch (e) {}
          if (hs) {
            const d = path.join(BUILD, "trace-" + ch, "src"); fs.mkdirSync(d, { recursive: true });
            src = path.join(d, path.basename(f)); fs.writeFileSync(src, hs);
            shift = { pre: hs.slice(0, hs.indexOf(code)).split("\n").length - 1, n: code.split("\n").length };
            if (!String(stdin || "").trim()) stdin = s0.input + "\n";
          }
        } else if (p && p.src === "cf" && s0 && !String(stdin || "").trim()) stdin = s0.input.endsWith("\n") ? s0.input : s0.input + "\n";
      }
      const h = TRACE.trace(lang, src, stdin || "", { toolDirs: DIRS, allowSystem: DEV, buildDir: BUILD, channel: ch, maxSteps: float ? 800 : 3000, secs: float ? 8 : 15, incDir: path.dirname(f) });
      traces[ch] = h;
      let r;
      try { r = await h.done; } finally { if (traces[ch] === h) delete traces[ch]; }
      if (r.cancelled) return { cancelled: true };
      // 套了 main 的：行号对回你的代码，只留你写的那几行（自动生成的 main 不画）
      if (shift) {
        const inUser = (l) => l > shift.pre && l <= shift.pre + shift.n;
        if (r.diags) r.diags = shiftDiags(r.diags, shift.pre, shift.n);
        if (r.stderr) r.stderr = String(r.stderr).replace(/:(\d+):/g, (m0, n) => ":" + Math.max(1, n - shift.pre) + ":");
        if (r.steps) r.steps = r.steps.filter((st) => inUser(st.l)).map((st) => ({ ...st, l: st.l - shift.pre, g: [], f: (st.f || []).filter((fr) => inUser(fr.l) && !/^_ll_|^ll_/.test(fr.fn)).map((fr) => ({ ...fr, l: fr.l - shift.pre })) })).filter((st) => st.f.length || lang === "python");
        if (r.error && r.error.line) r.error.line = inUser(r.error.line) ? r.error.line - shift.pre : null;
        r.harness = true;
      }
      // 电脑上的 gdb 没有 Python（很少见）：退回老办法，只画数组
      if (r.noTracer && (lang === "c" || lang === "cpp")) {
        const v = await H.vizRun(f, stdin, true, text != null ? text : null);
        if (v.compileFailed || v.error) return { ...v, lang };
        return { lang, fallback: true, why: r.why || "", output: v.output, exit: v.code, trunc: !!(v.timedOut || v.tooMuch),
          steps: v.frames.map((fr) => ({ l: fr.line, f: [{ fn: "", l: fr.line, v: [[fr.name, { k: "a", v: fr.a.map((n) => ({ k: "n", v: n })), n: fr.a.length }]].concat(fr.i >= 0 ? [["i", { k: "n", v: fr.i }]] : []).concat(fr.j >= 0 ? [["j", { k: "n", v: fr.j }]] : []) }], g: [] })) };
      }
      return r;
    },
    traceStop(channel) { const ch = String(channel || "main").replace(/\W/g, "").slice(0, 12); if (traces[ch]) { traces[ch].kill(); delete traces[ch]; } return true; },

    // 刷题：外面的题库 + 估水平 + 推荐
    judgeState() { return { bank: bank.status(), skill: skill.summary(), tags: [...new Set(bank.list().flatMap((p) => p.tags))] }; },
    async judgeRefresh(src) {
      const res = {};
      for (const s of src ? [src] : ["lc", "cf"]) { try { res[s] = { n: await bank.refresh(s) }; } catch (e) { res[s] = { error: e.message }; } }
      return { res, ...H.judgeState() };
    },
    judgeRecommend(opt = {}) {
      if (bank.stale("lc", 7) && !bank.data.err.lc) bank.refresh("lc").catch(() => {});   // 后台悄悄更新，下次就用新的
      return skill.recommend(bank.list(), Math.min(20, opt.n || 6), { src: opt.src || "", tag: opt.tag || "" });
    },
    judgeMark(id, how) {
      const p = bank.list().find((x) => x.id === id); if (!p) throw new Error("题库里没有这道题");
      if (how === "skip") { skill.skip(id); return { delta: 0, ...H.judgeState() }; }
      return { delta: skill.external(p, how), ...H.judgeState() };
    },
    judgeSetUser(site, name) { name = String(name || "").trim().slice(0, 40); skill.d.accounts[site] = name; skill.save(); return skill.summary(); },
    // 把你在力扣 / Codeforces 上做出来的题拿过来：没记过的按「做出来了」算（分量轻一点）
    async judgeSync() {
      const out = {}; const all = new Map(bank.list().map((p) => [p.id, p]));
      for (const [site, fn] of [["lc", leetcodeRecent], ["cf", codeforcesSolved]]) {
        const u = skill.d.accounts[site]; if (!u) continue;
        try {
          if (site === "cf" && !bank.data.cf) await bank.refresh("cf").catch(() => {});
          if (site === "cf") for (const p of bank.data.cf || []) all.set(p.id, p);
          const got = await fn(u); let n = 0;
          for (const g of got.sort((a, b) => a.t - b.t)) { const p = all.get(g.id); if (p && !skill.isDone(p.id)) { skill.external(p, "auto"); n++; } }
          out[site] = { n, seen: got.length };
        } catch (e) { out[site] = { error: e.message }; }
      }
      return { out, ...H.judgeState() };
    },

    // ---------- 在软件里做题（core/problems.js） ----------
    // 题面：先看本机缓存（7 天内），没有再联网拿
    async problemGet(id, fresh = false) {
      id = String(id || "");
      const file = path.join(USER, "problems", id.replace(/[^\w.-]/g, "_") + ".json");
      if (!fresh) { try { const c = JSON.parse(fs.readFileSync(file, "utf8")); if (Date.now() - c.at < 7 * 864e5) return c; } catch (e) {} }
      let p;
      const m = id.match(/^cf:(\d+)([A-Z]\d?)$/);
      if (id.startsWith("lc:")) p = await PB.fetchLeetcode(id.slice(3));
      else if (m) p = await PB.fetchCodeforces(m[1], m[2]);
      else throw new Error("不认识这道题");
      const meta = bank.list().find((x) => x.id === id);
      if (meta) p.diff = meta.diff;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(p));
      return p;
    },
    // 开始做：在「刷题」文件夹里建一个代码文件（已经有了就接着写，不覆盖）
    async problemOpen(id, lang) {
      const p = await H.problemGet(id);
      if (!PB.EXT[lang]) throw new Error("还不支持这种语言");
      const dir = path.join(workspace(), "刷题");
      fs.mkdirSync(dir, { recursive: true });
      const name = `${p.src === "cf" ? "CF" : "力扣"}${p.no}-${String(p.title).replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24)}`;
      let f = path.join(dir, name + (lang === "java" ? "" : "") + PB.EXT[lang]);
      if (lang === "java") { const d2 = path.join(dir, name); fs.mkdirSync(d2, { recursive: true }); f = path.join(d2, p.src === "lc" ? "Solution.java" : "Main.java"); }
      if (!fs.existsSync(f)) fs.writeFileSync(f, PB.template(p, lang));
      probFiles[f] = { id, lang }; saveProbFiles();
      return { file: f, problem: p };
    },
    problemOfFile(f) {
      const x = probFiles[path.normalize(String(f || ""))];
      if (!x) return null;
      let p = null;
      try { p = JSON.parse(fs.readFileSync(path.join(USER, "problems", x.id.replace(/[^\w.-]/g, "_") + ".json"), "utf8")); } catch (e) {}
      return { ...x, problem: p, done: skill.isDone(x.id) };
    },
    // 本地跑样例。text：编辑器里的代码（可能还没保存）
    async problemRun(f, text) {
      f = safeFile(f);
      const x = probFiles[f]; if (!x) throw new Error("这个文件不是刷题的文件");
      const p = await H.problemGet(x.id);
      const lang = (langOfFile(f) || {}).id;
      const code = text != null ? String(text) : fs.readFileSync(f, "utf8");
      const samples = (p.samples || []).filter((s) => s.input != null);
      if (!samples.length) throw new Error("这道题没拿到样例");
      const jd = path.join(BUILD, "judge"); fs.mkdirSync(jd, { recursive: true });
      const opt = { toolDirs: DIRS, allowSystem: DEV, buildDir: BUILD };
      let cases = [];
      if (p.src === "lc") {
        const why = PB.harnessSupport(p.meta, lang);
        if (why) return { unsupported: why };
        let src;
        try { src = { c: PB.cHarness, cpp: PB.cppHarness, python: PB.pyHarness }[lang](code, p.meta); } catch (e) { return { unsupported: e.message + "，登录力扣后在线运行" }; }
        const hf = path.join(jd, "lc-" + p.slug.replace(/[^\w-]/g, "") + PB.EXT[lang]);
        fs.writeFileSync(hf, src);
        // 报错的行号对回你的代码：生成的文件前面多了几行
        const pre = src.slice(0, src.indexOf(code)).split("\n").length - 1;
        const r = await runMany(lang, hf, opt, [samples.map((s) => s.input).join("\n") + "\n"], { timeoutMs: 6000 });
        if (r.compileFailed) return { compileFailed: true, stderr: fixLines(r.stderr, path.basename(hf), path.basename(f), pre), diags: shiftDiags(r.diags, pre, code.split("\n").length) };
        const res = r.results[0];
        const lines = res.stdout.split("\n");
        cases = samples.map((s, i) => ({ input: s.input, want: s.output, got: lines[i] != null && i < lines.length - (res.stdout.endsWith("\n") ? 1 : 0) ? lines[i] : "", pass: lines[i] != null ? PB.lcSame(lines[i], s.output) : false }));
        if (res.code !== 0 || res.timedOut) { const k = cases.findIndex((c) => !c.got); if (k >= 0) { cases[k].error = res.timedOut ? "超时（是不是死循环？）" : runErr(res.stderr, lang).replace(/line (\d+)/g, (m0, n) => "line " + Math.max(1, n - pre)).split(path.basename(hf)).join(path.basename(f)); for (let i = k + 1; i < cases.length; i++) cases[i].skipped = true; } }
      } else {
        if (text != null) fs.writeFileSync(f, code);
        const r = await runMany(lang, f, opt, samples.map((s) => (s.input.endsWith("\n") ? s.input : s.input + "\n")), { timeoutMs: 4000 });
        if (r.compileFailed) return { compileFailed: true, stderr: r.stderr, diags: r.diags };
        cases = samples.map((s, i) => { const o = r.results[i]; return { input: s.input, want: s.output, got: o.stdout, pass: !o.timedOut && o.code === 0 && PB.cfSame(o.stdout, s.output), error: o.timedOut ? "超时（是不是死循环？或者在等输入）" : o.code !== 0 ? runErr(o.stderr, lang) || "程序出错退出了（返回 " + o.code + "）" : "", ms: o.ms }; });
      }
      progress.ran();
      return { local: true, cases, allPass: cases.length > 0 && cases.every((c) => c.pass) };
    },
    // 提交：登录了力扣就在线判；不然本地样例全对也算做出来（分量轻一点）
    async problemSubmit(f, text, mode = "submit") {
      f = safeFile(f);
      const x = probFiles[f]; if (!x) throw new Error("这个文件不是刷题的文件");
      const p = await H.problemGet(x.id);
      const code = text != null ? String(text) : fs.readFileSync(f, "utf8");
      const lang = (langOfFile(f) || {}).id;
      const bankP = bank.list().find((b) => b.id === x.id) || { id: x.id, title: p.title, diff: p.diff || 1300, tags: [], src: p.src };
      if (p.src === "lc" && env.lcCookies) {
        const s = await PB.lcSession(env.lcCookies);
        if (s) {
          const r = await PB.lcRemote(env.lcCookies, p, lang, code, mode, (state) => send("judge", { state }));
          if (mode === "submit") {
            if (r.ok && !skill.isDone(x.id)) r.delta = skill.external(bankP, "accepted");
            else if (!r.ok && !r.compileError) { tries[x.id] = (tries[x.id] || 0) + 1; if (tries[x.id] === 3) r.delta = skill.external(bankP, "failed") * 0.5; }
          }
          return r;
        }
      }
      if (mode === "run") return H.problemRun(f, text);
      const r = await H.problemRun(f, text);
      if (r.allPass && !skill.isDone(x.id)) r.delta = skill.external(bankP, "samples");
      r.offline = true;
      return r;
    },
    async lcAccount() {
      if (!env.lcCookies) return { available: false };
      try { return { available: true, ...(await PB.lcUser(env.lcCookies)) }; } catch (e) { return { available: true, signedIn: false, error: e.message }; }
    },
    async lcLogin() { if (!env.lcLogin) throw new Error("要在电脑版里登录"); await env.lcLogin(); return H.lcAccount(); },
    async lcLogout() { if (env.lcLogout) await env.lcLogout(); return H.lcAccount(); },

    // 安装语言
    async install(tool) {
      if (!TC.TOOLS[tool]) throw new Error("这个不用装");
      dlSignal = { aborted: false };
      try { await TC.install(tool, DIRS.user, (p) => send("install", { tool, ...p }), dlSignal); }
      finally { dlSignal = null; }
      return langStatus();
    },
    cancelInstall() { if (dlSignal) dlSignal.aborted = true; return true; },

    // 问捞捞
    aiState() { return aiState; },
    async aiStart() { return aiStart(); },
    async aiDownload() {
      dlSignal = { aborted: false };
      setAi("downloading", "正在下载本地模型…", { got: 0, total: 0 });
      try { await AI.downloadModel(MODEL_DIRS[1], (got, total) => setAi("downloading", "正在下载本地模型…", { got, total }), dlSignal); }
      catch (e) { setAi("need-model", "下载没完成：" + e.message + "（再点一次会接着下）"); return false; }
      finally { dlSignal = null; }
      return aiStart();
    },
    async ask({ mode, ctx, question, history, id }) {
      if (!(await aiStart())) throw new Error(aiState.msg || "本地模型没准备好");
      if (aiReq) { aiReq.abort(); aiReq = null; }
      const c = { ...(ctx || {}) };
      if (c.exercise && c.exercise.id) exAsked.add(c.exercise.id);
      if (!c.output && lastRun.file === c.fileFull) c.output = lastRun.output;
      if ((!c.diags || !c.diags.length) && lastRun.file === c.fileFull) c.diags = lastRun.diags;
      const msgs = messages(mode, c, question, history || []);
      aiReq = AI.chat(msgs, (text) => send("ai", { id, text }), tutorOptions(question ? "free" : mode));
      try { const full = await aiReq; send("ai", { id, text: full, done: true }); return full; }
      catch (e) { send("ai", { id, error: e.message, done: true }); throw e; }
      finally { aiReq = null; }
    },
    aiStop() { if (aiReq) aiReq.abort(); return true; },

    // 账号
    async login(account, password) {
      if (!api) throw new Error("账号功能没加载");
      await api.signIn(account, password);
      await loadMe(); await syncNow();
      return { me, progress: progress.summary() };
    },
    async logout() { if (api) await api.signOut(); me = null; return true; },
    async syncNow() { const r = await syncNow(); return { r, progress: progress.summary() }; },
    // 只打开自己网站和题库里列出的几个知名题库网站
    openUrl(u) { u = String(u); if (/^https:\/\/(www\.)?laolaokechengbiao\.cn\//.test(u) || /^https:\/\/leetcode\.cn\/(problems|u)\/[\w-]+\/(submissions\/)?$/.test(u) || /^https:\/\/leetcode\.cn\/(problems|u)\/[\w-]+$/.test(u) || /^https:\/\/codeforces\.com\/problemset\/problem\/\d+\/[A-Z]\d?$/.test(u) || BANKS.some((b) => (b.links || []).some((l) => l[1] === u))) env.openExternal(u); return true; },
  };

  api = makeApi();
  const boot = () => loadMe().then(() => { send("me", me); if (me) syncNow(); });
  const shutdown = () => { session.stop(); for (const k in traces) try { traces[k].kill(); } catch (e) {} try { aiChild && aiChild.kill(); } catch (e) {} };
  return { H, boot, shutdown };
}

module.exports = { createService };
