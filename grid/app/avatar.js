// 捞小智的形象：默认是机器人捞小智；也可以换成「老师的 3D 小人」——
//   上传一张照片（要先勾选授权）→ AI 画 3 张 Q版立绘 → 挑一张 → 做成带贴图的 3D 模型（Hunyuan3D-2）→ 绑骨骼、让眼睛和嘴会动 → avatar.glb
//   用的是和捞捞PPT助手同一套「捞捞形象工坊」（app/ai3d/lao3d，Python，打包时从 pptassist/ai3d 拷过来）和 Hunyuan3D-2 整合包（约 10G，要 NVIDIA 显卡），
//   全部在这台电脑上跑，照片不上传。也可以直接导入做好的 avatar.glb（比如捞捞PPT助手里做的）。
//   随时可以一键删掉照片、立绘和模型。
"use strict";
const fs = require("fs");
const path = require("path");
const PPT = (f) => require(path.join(__dirname, "ppt", f));
const IMG = ["png", "jpg", "jpeg", "webp"];

function create(o) {
  const dir = () => { const d = path.join(o.base(), "avatar"); fs.mkdirSync(d, { recursive: true }); return d; };
  const F = (...a) => path.join(dir(), ...a);
  const CFG = () => F("avatar.json");
  let cfg = null;
  const load = () => { if (!cfg) { try { cfg = JSON.parse(fs.readFileSync(CFG(), "utf8")); } catch (e) { cfg = {}; } } return cfg; };
  const save = () => { try { fs.writeFileSync(CFG(), JSON.stringify(load(), null, 1)); } catch (e) {} };
  const AI3D = o.ai3dMod || PPT("ai3d.js");
  const ai = (o.ai3dFactory || AI3D.create)({ lib: o.lib || path.join(__dirname, "ai3d").replace(/app\.asar([\\/])/, "app.asar.unpacked$1"), ...(o.ai3dOpt || {}) });
  const log = o.log || (() => {});
  const glb = () => F("out", "avatar.glb");
  const photo = () => IMG.map((e) => F("photo." + e)).find((f) => fs.existsSync(f)) || null;
  const figure = () => (fs.existsSync(F("figure.png")) ? F("figure.png") : null);
  const cands = () => { try { return fs.readdirSync(F("cands")).filter((f) => /\.png$/i.test(f)).sort().map((f) => F("cands", f)); } catch (e) { return []; } };
  const dataUrl = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
  // 3D 引擎（Hunyuan3D-2 整合包）在哪：装过的记在 avatar.json；没记就看数据文件夹 ai/LaolaoAI-Hunyuan3D
  function engine() {
    const c = load(), tries = [c.hyDir, path.join(o.base(), "ai", "LaolaoAI-Hunyuan3D")].filter(Boolean);
    for (const d of tries) { const r = AI3D.inspect(d); if (r.ok && r.hy) return r; }
    return null;
  }
  function state() {
    const c = load(), e = engine();
    return { use: c.use === "3d" && fs.existsSync(glb()) ? "3d" : "robot", has3d: fs.existsSync(glb()), engine: !!e, ready: !!(e && c.setupOk), consent: c.consent || null,
      photo: !!photo(), cands: cands().length, figure: !!figure(), busy: ai.state().busy, step: ai.state().cmd || null };
  }
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  // 装 3D 引擎：下整合包（国内存储优先）、解压，再装工坊要的 Python 包（画立绘的 4bit 引擎等）
  async function install(say = () => {}) {
    let e = engine();
    if (!e) {
      const INSTALL = PPT("installer.js"), MIRROR = PPT("mirror.js");
      const r = await (o.install || INSTALL.install)("hy3d", path.join(o.base(), "ai"), { mirror: MIRROR.create(o.mirrorOpt || {}), gpu: o.gpuName ? o.gpuName() : "", onMsg: (m) => say(typeof m === "string" ? m : m.msg || m.text || "", m) });
      load().hyDir = r.dir; save();
      e = engine(); need(e, "3D 引擎装好了，但是找不到 Hunyuan3D-2 的代码：删掉 ai/LaolaoAI-Hunyuan3D 重新装");
    }
    if (!load().setupOk) {
      say("安装画立绘、做 3D 要用的组件（第一次要几分钟）…");
      await ai.run(e, ["setup"], (m) => say(m.msg || "", m));
      load().setupOk = Date.now(); save();
    }
    say("3D 引擎准备好了", { done: true });
    return state();
  }
  // 上传照片：必须先勾选授权（照片里的人是本人，或者已经得到本人同意）
  async function setPhoto(consent) {
    need(consent && consent.ok, "要先勾选：照片里是我本人，或者我已经得到照片里的人同意，只用来做捞小智的形象");
    const f = o.pickFile ? await o.pickFile(IMG, "选一张老师的照片（正脸、光线好、只有一个人）", "照片") : null;
    if (!f) return null;
    need(fs.statSync(f).size <= 20e6, "照片太大了（超过 20MB）");
    for (const e of IMG) fs.rmSync(F("photo." + e), { force: true });
    fs.copyFileSync(f, F("photo." + path.extname(f).slice(1).toLowerCase().replace("jpeg", "jpg")));
    load().consent = { at: Date.now(), by: String(consent.by || "").slice(0, 40) }; save();
    return state();
  }
  // AI 画 3 张 Q版立绘（4bit 画图引擎，要 NVIDIA 显卡，几分钟）
  async function stylize(opt = {}, say = () => {}) {
    const e = engine(); need(e && load().setupOk, "先装好 3D 引擎");
    need(photo(), "先上传老师的照片");
    fs.rmSync(F("cands"), { recursive: true, force: true }); fs.mkdirSync(F("cands"), { recursive: true });
    await ai.run(e, ["stylize", "--photo", photo(), "--out", F("cands"), "--n", String(Math.max(1, Math.min(4, parseInt(opt.n) || 3))), "--quality", opt.quality === "fast" ? "fast" : "best", "--clothes", ["style", "photo"].includes(opt.clothes) ? opt.clothes : "guochao"], (m) => say(m.msg || "", m));
    return cands().map(dataUrl);
  }
  function choose(i) { const c = cands()[parseInt(i)]; need(c, "没有这一张"); fs.copyFileSync(c, F("figure.png")); return dataUrl(F("figure.png")); }
  // 做成 3D（Hunyuan3D-2，几分钟）→ 绑骨骼、让眼睛和嘴会动 → avatar.glb，换上
  async function build(opt = {}, say = () => {}) {
    const e = engine(); need(e && load().setupOk, "先装好 3D 引擎");
    need(figure(), "先挑一张 Q版立绘");
    fs.mkdirSync(F("gen"), { recursive: true }); fs.mkdirSync(F("out"), { recursive: true });
    const raw = F("gen", "raw.glb"); fs.rmSync(raw, { force: true });
    await ai.run(e, ["to3d", "--image", figure(), "--out", raw, "--quality", opt.quality === "fast" ? "fast" : "best"], (m) => say(m.msg || "", m));
    const r = await ai.run(e, ["build", "--src", raw, "--out", F("out")], (m) => say(m.msg || "", m));
    need(fs.existsSync(glb()), "3D 小人没做出来");
    load().use = "3d"; save();
    return { ...state(), warn: r.warn || [], notes: r.notes || [] };
  }
  // 导入做好的 avatar.glb（捞捞PPT助手「AI 3D 形象」做出来的那个）
  async function importGlb() {
    const f = o.pickFile ? await o.pickFile(["glb"], "选一个做好的 3D 形象（avatar.glb）", "3D 形象") : null;
    if (!f) return null;
    const b = fs.readFileSync(f);
    need(b.length > 1000 && b.toString("ascii", 0, 4) === "glTF", "这不是 .glb 的 3D 模型文件");
    need(b.length < 200e6, "模型太大了（超过 200MB）");
    fs.mkdirSync(F("out"), { recursive: true }); fs.writeFileSync(glb(), b);
    load().use = "3d"; save();
    return state();
  }
  function use(kind) { load().use = kind === "3d" && fs.existsSync(glb()) ? "3d" : "robot"; save(); return state(); }
  // 现在用 3D 小人的话，给界面 avatar.glb 的内容（base64）
  function model() { const s = state(); return s.use === "3d" ? fs.readFileSync(glb()).toString("base64") : null; }
  // 一键删除：照片、立绘、3D 模型都删掉，授权记录也撤回
  function wipe() {
    for (const d of ["cands", "gen", "out"]) fs.rmSync(F(d), { recursive: true, force: true });
    for (const e of IMG) fs.rmSync(F("photo." + e), { force: true });
    fs.rmSync(F("figure.png"), { force: true });
    const c = load(); delete c.consent; c.use = "robot"; c.wiped = Date.now(); save();
    return state();
  }
  return { state, install, setPhoto, stylize, choose, build, importGlb, use, model, wipe, cancel: () => ai.cancel(), cands: () => cands().map(dataUrl) };
}

// 界面用的几个功能（算力客户端、捞小智电脑版共用）：进度用 send({ type: "avatar", text, p }) 报给界面
function handlers(av, send) {
  const say = (m, x) => send({ type: "avatar", text: String(m || ""), p: x && x.p != null ? x.p : null, done: !!(x && x.done) });
  return {
    showAvatar: async () => av.state(),
    showAvatarInstall: async () => av.install(say),
    showAvatarPhoto: async (consent) => av.setPhoto(consent),
    showAvatarStylize: async (opt) => av.stylize(opt || {}, say),
    showAvatarCands: async () => av.cands(),
    showAvatarChoose: async (i) => av.choose(i),
    showAvatarBuild: async (opt) => av.build(opt || {}, say),
    showAvatarImport: async () => av.importGlb(),
    showAvatarUse: async (k) => av.use(k),
    showAvatarModel: async () => av.model(),
    showAvatarWipe: async () => av.wipe(),
    showAvatarCancel: async () => av.cancel(),
  };
}
module.exports = { create, handlers };
