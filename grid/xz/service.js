// 捞小智电脑版 · 后台：只有捞小智用得到的部分（本地大模型、声音、成品展示「捞小智」），不带训练网的任何东西
//   · 大模型、声音组件第一次用时从国内镜像下载（和捞捞算力用的是同一套下载代码）
//   · 训练、考试通过的新版模型：从公开发布清单（https://dl.laolaokechengbiao.cn/dl/models/manifest.json）自动下载、换上
//   · 这里不领任务、不跑训练配方、不连调度中心的接口；只读那份公开清单
"use strict";
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const APP = path.join(__dirname, "..", "app");
const LLMW = require(path.join(APP, "llmw"));
const GSVW = require(path.join(APP, "gsvw"));
const Region = require(path.join(APP, "region"));

const PUB = "https://dl.laolaokechengbiao.cn";
const SOURCES = [PUB + "/dl/models/manifest.json"];

// GPT-SoVITS 的整合包放在路径里有中文或空格的文件夹会出错：用户名是中文时换到公共文件夹
function pickBase(user) {
  const ok = (p) => /^[\x20-\x7e]+$/.test(p) && !/\s/.test(p);
  if (ok(user)) return user;
  const pub = process.platform === "win32" ? path.join(process.env.PUBLIC || "C:\\Users\\Public", "LaolaoXiaozhi") : path.join(require("os").tmpdir(), "LaolaoXiaozhi");
  return ok(pub) ? pub : user;
}

function gpuName() {
  return new Promise((ok) => {
    if (process.platform !== "win32") return ok("");
    execFile("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { windowsHide: true, timeout: 8000 }, (e, out) => ok(e ? "" : String(out || "").split(/\r?\n/)[0].trim()));
  });
}

function createXz(o) {
  const user = o.user;
  fs.mkdirSync(user, { recursive: true });
  const CFG = path.join(user, "xiaozhi.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) {}
  const save = () => { try { fs.writeFileSync(CFG, JSON.stringify(cfg, null, 1)); } catch (e) {} };
  const base = () => { const b = cfg.dataDir || o.dataDir || pickBase(user); fs.mkdirSync(b, { recursive: true }); return b; };
  const send = o.send || (() => {});
  const logFile = path.join(user, "xiaozhi.log");
  const log = (m) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`); } catch (e) {} };

  const region = (o.regionFactory || Region.create)({ get: () => cfg.region, set: (v) => { cfg.region = v; save(); }, pref: () => "auto" });
  const regionNow = () => { try { return region.current(); } catch (e) { return "cn"; } };
  if (!o.noDetect) { const t = setTimeout(() => { try { region.detect().catch(() => {}); } catch (e) {} }, 20000); t.unref && t.unref(); }
  const mirror = (() => { try { return require(path.join(APP, "ppt", "mirror.js")).create({ region: regionNow }); } catch (e) { return null; } })();
  let gpu = "";
  gpuName().then((n) => { gpu = n; }).catch(() => {});

  const llm = (o.llmFactory || LLMW.create)({ exe: o.llamaExe, base, mirror, region: regionNow, ...(o.llmOpt || {}) });
  const gsv = (o.gsvFactory || GSVW.create)({ base, get: () => cfg.gsv, set: (v) => { cfg.gsv = { ...(cfg.gsv || {}), ...v }; save(); }, gpuName: () => gpu,
    mirrorOpt: { region: regionNow }, beforeStart: async () => { try { llm.stop(); } catch (e) {} }, ...(o.gsvOpt || {}) });
  const show = (o.showFactory || require(path.join(APP, "show")).create)({
    dir: () => path.join(base(), "show"), server: () => "", llm, log, send: (e) => send("show", e),
    modelsOpt: { sources: o.sources || SOURCES, ...(o.modelsOpt || {}) },
    busy: () => null, used: () => true,
    gsvDir: () => { const r = gsv.inspect((cfg.gsv || {}).dir) || gsv.find(path.join(base(), "ai", "LaolaoAI-GPT-SoVITS")); return r ? r.dir : null; },
    llmName: async () => { if (!mirror) return null; try { const hit = (await mirror.model("llmMain"))[0]; return hit && hit.name; } catch (e) { return null; } },
    gsvEnsure: (say) => gsv.ensure((m) => say(m)), base,
    ...(o.showOpt || {}) });

  const st = async () => ({ ...(await show.state()), paused: false, joined: true, fullscreen: o.isFullscreen ? !!o.isFullscreen() : false, app: { version: o.version || "", trial: true } });
  const H = {
    showState: st,
    async showSend(text) { await show.send(text); return st(); },
    showStop: async () => show.stop(),
    showReset: async () => show.reset(),
    async showRole(r) { await show.setRole(r); return st(); },
    async showCheck() { await show.fuse("手动"); return st(); },
    async showApprove(id, ok) { await show.approve(id, ok); return st(); },
    async showCampusReset() { await show.campusReset(); return st(); },
    async showOpenPpt(reveal) { const lp = show.lastPpt(); if (!lp || !fs.existsSync(lp.file)) throw new Error("还没有做好的 PPT"); if (reveal) o.reveal && o.reveal(lp.file); else o.openPath && o.openPath(lp.file); return true; },
    showSlides: async (rev) => show.slides(rev),
    async showPptExam() { const r = await show.pptExam(); return { exam: r, state: await st() }; },
    async showPptTheme(k) { await show.pptTheme(String(k)); return true; },
    async showPptUndo() { return show.pptUndo(); },
    async showPickPpt() { const f = o.pickFile ? await o.pickFile(["pptx"], "打开一份 PPT（.pptx），让捞小智改", "PowerPoint") : null; if (!f) return null; await show.openPpt(f); return st(); },
    showSpeak: async (text) => show.speak(text),
    showHear: async (b64) => show.hear(b64),
    async showCall(on) { show.setCall(!!on); return st(); },
    setShowSpeak: async (on) => show.setSpeak(on),
    async showActive(on) { show.setActive(!!on); return st(); },
    async showPause() { return st(); },
    async showInstallVoice() { await gsv.ensure((m) => send("show", { type: "note", text: m })); return st(); },
    showCheckup: async (b) => show.checkupView(b),
    showCheckupScan: async (a) => show.checkupScan(a || {}),
    showCheckupConfig: async (c) => show.checkupConfig(c),
    async showCheckupImport() { const f = o.pickFile ? await o.pickFile(["json", "csv", "txt"], "导入检测结果（合作方导出的 JSON，或 Excel 另存的 CSV）", "检测结果") : null; if (!f) return null; const r = show.checkupImport(f); return { added: r.added, view: show.checkupView() }; },
    async showCheckupDemo() { show.checkupDemo(); return show.checkupView(); },
    async showCheckupWipe() { show.checkupWipe(); return show.checkupView(); },
    async showCheckupRemove(id) { show.checkupRemove(id); return show.checkupView(); },
    showCheckupPhoto: async (f) => show.checkupPhoto(f),
    async showFullscreen(on) { if (o.fullscreen) o.fullscreen(!!on); return !!on; },
    ...require(path.join(APP, "avatar")).handlers(require(path.join(APP, "avatar")).create({ base, pickFile: o.pickFile, gpuName: () => gpu, mirrorOpt: { region: regionNow }, log }), (e) => send("show", e)),
    showPrep: async () => show.prepStatus(),
    showPrepRun: async (opt) => show.prepRun(opt || {}),
    async showVoicePref(v) { return show.setVoicePref(v); },
    openSite: async () => { o.openExternal && o.openExternal("https://www.laolaokechengbiao.cn/xiaozhi/"); return true; },
  };
  return { H, show, llm, gsv, shutdown: () => { try { show.shutdown(); } catch (e) {} try { llm.stop(); } catch (e) {} } };
}

module.exports = { createXz, SOURCES, pickBase };
