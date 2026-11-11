// 捞捞PPT助手 · 后台：老师的形象 / 声音存在本机，读 PPT、配音、合成视频、写回 PPT。
// 界面只能通过 cc.call 调这里 H 里的方法（Electron 主进程和测试用的 ui-server 都这样接）。
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PPTX = require("./pptx");
const MEDIA = require("./media");
const VOICE = require("./voice");
const DRAFT = require("./draft");
const AI3D = require("./ai3d");
const ENGINE = require("./engine");
const MIRROR = require("./mirror");
const INSTALL = require("./installer");
const WF = require("./workflows");

const IMG_EXT = ["png", "jpg", "jpeg", "webp", "bmp"];
const AUDIO_EXT = ["wav", "mp3", "m4a", "aac", "ogg", "flac", "wma", "amr", "opus", "webm"];
const VIDEO_EXT = ["mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp", "wmv", "flv"];
// 人脸和声音授权的版本：授权条款改了就要重新同意
const CONSENT_VER = "2026-11";

function createService(env) {
  const USER = env.user;
  // 文件都放在用户目录里；要写的时候文件夹不在了（被清理掉了）就重新建
  const P = (...a) => { const f = path.join(USER, ...a); if (a.length > 1) fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
  const CACHE = P("cache");
  fs.mkdirSync(CACHE, { recursive: true });
  const send = (ch, d) => env.send && env.send(ch, d);
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

  // 老师的资料：形象（捏脸数据）、照片、参考录音、GPT-SoVITS 在哪
  let profile = { avatar: null, photo: null, voice: null, gsvDir: null, side: "right", scale: 0.6, ...readJson(P("profile.json"), {}) };
  const saveProfile = () => fs.writeFileSync(P("profile.json"), JSON.stringify(profile, null, 2));
  const voice = VOICE.create({ onState: (s) => send("voice", s) });
  let doc = null;   // 打开的 PPT：{ file, info }
  // AI 3D 形象：工坊的文件都放在 用户目录/ai3d 下面（立绘候选 cands/、生成的模型 gen/、绑好骨骼的 out/）
  const ai = AI3D.create(env.ai3dOpt || {});
  const A3 = () => (profile.ai3d = profile.ai3d || {});
  const aiRt = () => { const d = A3().dir; if (!d) throw new Error("先选 Hunyuan3D-2 整合包的文件夹"); const r = AI3D.inspect(d); if (!r.ok) throw new Error(r.error); return r; };
  const aiSend = (m) => send("ai3d", m);
  const aiFile = (...a) => P("ai3d", ...a);
  const aiCands = () => { const d = aiFile("cands", "x"); const dir = path.dirname(d); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^cand_\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5))).map((f) => path.join(dir, f)) : []; };
  const aiModel = () => { const f = aiFile("out", "avatar.glb"); return fs.existsSync(f) ? f : null; };
  const firstExisting = (base) => IMG_EXT.map((e) => aiFile(base + "." + e)).find((f) => fs.existsSync(f)) || null;
  // AI 形象（本机 ComfyUI）：候选 aiav/cands、挑好的 aiav/figure.png、口型和眨眼图层 aiav/layers
  // 国内存储的清单：整合包、模型、插件优先从老师自己的国内存储下
  const mirror = MIRROR.create(env.mirrorOpt || {});
  const eng = ENGINE.create({ mirror, ...(env.engineOpt || {}) });
  let setupJob = null;   // 一键下载安装：一次只装一个
  const setupSend = (kind, m) => send("setup", { kind, ...m });
  async function runSetup(kind, title, fn) {
    if (setupJob) throw new Error("正在安装" + INSTALL.NAMES[setupJob.kind] + "，等它装完");
    const parent = await env.pickDir(title); if (!parent) return null;
    const ac = new AbortController(); setupJob = { kind, ac };
    try {
      const gpu = (eng.status().vram || {}).name || "";
      const r = await INSTALL.install(kind, parent, { mirror, gpu, signal: ac.signal, onMsg: (m) => setupSend(kind, m), ...(env.installOpt || {}) });
      return await fn(r);
    } finally { setupJob = null; }
  }
  const AV = () => (profile.aiav = profile.aiav || { files: {} });
  const avFile = (...a) => P("aiav", ...a);
  const avSend = (m) => send("aiav", m);
  const avRt = () => { const d = AV().dir; if (!d) throw new Error("先选 ComfyUI 整合包的文件夹"); const r = ENGINE.inspect(d); if (!r.ok) throw new Error(r.error); return r; };
  const avCands = () => { const d = path.dirname(avFile("cands", "x")); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^cand_\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5))).map((f) => path.join(d, f)) : []; };
  const avFigure = () => { const f = avFile("figure.png"); return fs.existsSync(f) ? f : null; };
  const avLayers = () => Object.fromEntries(Object.keys(WF.VARIANTS).map((k) => [k, avFile("layers", k + ".png")]).filter(([, f]) => fs.existsSync(f)));
  const avName = (k) => { const f = AV().files[k]; return (f && f.name) || WF.MODELS[k].name; };
  async function avReady(feature) {
    const st = eng.status(); if (!st.running) throw new Error("先启动 AI 引擎（ComfyUI）");
    const c = await eng.check(avRt(), AV().files);
    const f = c.feat[feature];
    if (c.coreMissing.length) throw new Error("ComfyUI 版本太旧（缺 " + c.coreMissing[0] + "）：运行整合包里的 update\\update_comfyui.bat 更新一下");
    if (f.packs.length) throw new Error("还没装 AI 引擎需要的插件：" + f.packs.join("、"));
    if (f.missing.length) throw new Error("还有模型没下载好（" + f.missing.map((k) => avName(k)).join("、") + "）");
    return st;
  }
  const jobs = new Map();
  const outputs = new Set();   // 只让界面打开 / 定位我们自己生成的文件
  let jobN = 0;

  const dataUrl = (f, mime) => `data:${mime};base64,${fs.readFileSync(f).toString("base64")}`;
  const mimeOf = (f) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" }[path.extname(f).slice(1).toLowerCase()] || "application/octet-stream");
  const hash = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
  const keyOk = (k) => /^[\w-]{1,40}$/.test(String(k || ""));
  const segWav = (key) => { const f = P("cache", `seg-${key}.json`); const j = readJson(f, null); return j && fs.existsSync(j.wav) ? j : null; };

  // ---------- 授权：用老师的人脸、声音（生物识别信息，《个人信息保护法》里的敏感个人信息）之前，必须本人同意或取得本人书面同意 ----------
  const consentOk = () => !!(profile.consent && profile.consent.ver === CONSENT_VER);
  const needConsent = () => { if (!consentOk()) throw new Error("先阅读并同意「人脸和声音的授权」（在「我的形象」页上面）"); };
  const logConsent = (o) => { try { fs.appendFileSync(P("consent-log.jsonl"), JSON.stringify(o) + "\n"); } catch (e) {} };
  const aigcId = () => crypto.randomUUID();
  const videoDir = (...a) => path.join(USER, "video", ...a);   // 只拼路径不建文件夹（看一眼在不在时别把清掉的文件夹又建出来）
  function viewsInfo() {
    const out = {};
    for (const k of ["left", "right", "back"]) { const f = videoDir("views", k + ".jpg"); if (fs.existsSync(f)) out[k] = dataUrl(f, "image/jpeg"); }
    return out;
  }
  function videoInfo() {
    const v = profile.video; if (!v || !fs.existsSync(P(v.src))) return null;
    return { seconds: v.seconds, w: v.w, h: v.h, audio: v.audio, fps: v.fps, n: v.n, views: viewsInfo(), template: fs.existsSync(videoDir("template.mp4")) };
  }

  function photoInfo() { return profile.photo && fs.existsSync(P(profile.photo)) ? dataUrl(P(profile.photo), mimeOf(profile.photo)) : null; }
  function voiceInfo() {
    const v = profile.voice; if (!v || !fs.existsSync(P(v.ref))) return null;
    return { prompt: v.prompt || "", seconds: v.seconds, url: dataUrl(P(v.ref), "audio/wav") };
  }

  const H = {
    state() {
      const face = profile.face && fs.existsSync(P(profile.face)) ? { url: dataUrl(P(profile.face), "image/png"), marks: profile.faceMarks || {} } : null;
      return { face, version: env.version, profile: { avatar: profile.avatar, gsvDir: profile.gsvDir, side: profile.side, scale: profile.scale }, photo: photoInfo(), voice: voiceInfo(), engine: voice.state, gsvPage: VOICE.DOWNLOAD_PAGE, doc: doc ? { file: doc.file, info: doc.info } : null,
        consent: consentOk() ? profile.consent : null, consentVer: CONSENT_VER, video: videoInfo(), talk: { template: fs.existsSync(videoDir("template.mp4")), check: (profile.ai3d && profile.ai3d.talk) || null } };
    },
    // ---------- 授权 ----------
    // o：{ who: "self" | "other", name（不是本人时：被拍的老师的名字）, agree: true, written（不是本人时：已经拿到书面同意）}
    saveConsent(o = {}) {
      const who = o.who === "other" ? "other" : "self";
      if (o.agree !== true) throw new Error("要勾选同意");
      const name = String(o.name || "").trim().slice(0, 40);
      if (who === "other" && (!name || o.written !== true)) throw new Error("用别人的照片 / 视频 / 声音，要写上他（她）的名字，并且已经拿到本人的书面同意");
      profile.consent = { ver: CONSENT_VER, at: new Date().toISOString(), who, name: who === "other" ? name : "", written: who === "other" };
      saveProfile(); logConsent({ act: "agree", ...profile.consent });
      return profile.consent;
    },
    // 一键清除：照片、视频、声音、做出来的脸 / 3D 形象 / 讲解视频全部删掉，授权也撤回（留一条撤回记录）
    clearBiometrics() {
      for (const e of IMG_EXT) fs.rmSync(P("photo." + e), { force: true });
      for (const d of ["video", "voice", "cache", path.join("ai3d", "cands"), path.join("ai3d", "gen"), path.join("ai3d", "out"), path.join("aiav", "cands"), path.join("aiav", "layers")]) fs.rmSync(P(d), { recursive: true, force: true });
      fs.rmSync(P("aiav", "figure.png"), { force: true }); fs.rmSync(P("aiav", "rig.json"), { force: true });
      for (const f of ["face.png", ...IMG_EXT.map((e) => path.join("ai3d", "figure." + e))]) fs.rmSync(P(f), { force: true });
      fs.mkdirSync(CACHE, { recursive: true });
      if (profile.avatar) { delete profile.avatar.faceLines; delete profile.avatar.faceImage; if (["ai3d", "real", "puppet", "aivideo"].includes(profile.avatar.faceStyle)) profile.avatar.faceStyle = "doll"; }
      logConsent({ act: "clear", at: new Date().toISOString(), was: profile.consent || null });
      for (const k of ["photo", "face", "faceMarks", "voice", "video", "consent"]) delete profile[k];
      saveProfile();
      return true;
    },
    // ---------- AI 3D 形象（照片 + 参考图 → 会动的 3D 公仔）----------
    ai3dState() {
      const a = A3(), m = aiModel(), fig = firstExisting("figure"), sty = firstExisting("style");
      let rt = null; try { rt = a.dir ? AI3D.inspect(a.dir) : null; } catch (e) {}
      return { dir: a.dir || null, rt, check: a.check || null, style: sty ? dataUrl(sty, mimeOf(sty)) : null, figure: fig ? dataUrl(fig, mimeOf(fig)) : null,
        cands: aiCands().map((f) => dataUrl(f, "image/png")), model: m ? { size: fs.statSync(m).size, warn: a.warn || [], notes: a.notes || [], at: fs.statSync(m).mtimeMs } : null,
        job: ai.state(), pages: AI3D.PAGES };
    },
    async ai3dPickDir() {
      const d = await env.pickDir("选 Hunyuan3D-2 整合包（Hunyuan3D-2GP / WinPortable）的文件夹"); if (!d) return null;
      const r = AI3D.inspect(d); if (!r.ok) throw new Error(r.error);
      A3().dir = d; A3().check = null; saveProfile();
      return H.ai3dCheck();
    },
    async ai3dCheck() { const r = await ai.run(aiRt(), ["check"], aiSend); A3().check = r.info; saveProfile(); return r.info; },
    async ai3dSetup() { const r = await ai.run(aiRt(), ["setup"], aiSend); A3().check = r.info || A3().check; saveProfile(); return A3().check; },
    async ai3dPickStyle() {
      const f = await env.pickFile(IMG_EXT, "选一张风格参考图（想要的公仔样子）", "图片"); if (!f) return null;
      if (fs.statSync(f).size > 20e6) throw new Error("图片太大了（超过 20MB）");
      for (const e of IMG_EXT) fs.rmSync(aiFile("style." + e), { force: true });
      const out = aiFile("style" + path.extname(f).toLowerCase()); fs.copyFileSync(f, out); return dataUrl(out, mimeOf(out));
    },
    async ai3dPickFigure() {
      const f = await env.pickFile(IMG_EXT, "选一张已经做好的公仔全身图（正面、站直、胳膊离开身子一点）", "图片"); if (!f) return null;
      if (fs.statSync(f).size > 20e6) throw new Error("图片太大了（超过 20MB）");
      for (const e of IMG_EXT) fs.rmSync(aiFile("figure." + e), { force: true });
      const out = aiFile("figure" + path.extname(f).toLowerCase()); fs.copyFileSync(f, out); return dataUrl(out, mimeOf(out));
    },
    async ai3dStylize(o = {}) {
      needConsent();
      if (!profile.photo || !fs.existsSync(P(profile.photo))) throw new Error("先在上面上传老师的照片");
      const dir = path.dirname(aiFile("cands", "x"));
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const sty = firstExisting("style");
      const n = Math.max(1, Math.min(6, parseInt(o.n) || 3));
      const extra = ["back", "left", "right"].map((k) => videoDir("views", k + ".jpg")).filter((f) => fs.existsSync(f)).slice(0, 2);
      const args = ["stylize", "--photo", P(profile.photo), ...(sty ? ["--style", sty] : []), ...(extra.length ? ["--extra", extra.join(",")] : []), "--out", dir, "--n", String(n), "--quality", o.quality === "fast" ? "fast" : "best", "--clothes", ["style", "photo"].includes(o.clothes) ? o.clothes : "guochao"];
      await ai.run(aiRt(), args, aiSend);
      return aiCands().map((f) => dataUrl(f, "image/png"));
    },
    ai3dChoose(i) {
      const c = aiCands()[parseInt(i)]; if (!c) throw new Error("没有这一张");
      for (const e of IMG_EXT) fs.rmSync(aiFile("figure." + e), { force: true });
      const out = aiFile("figure.png"); fs.copyFileSync(c, out); return dataUrl(out, "image/png");
    },
    async ai3dBuild(o = {}) {
      const fig = firstExisting("figure"); if (!fig) throw new Error("先选一张公仔图");
      const gen = path.dirname(aiFile("gen", "x")); fs.mkdirSync(gen, { recursive: true });
      const raw = path.join(gen, "raw.glb");
      if (!o.reuse || !fs.existsSync(raw)) {
        fs.rmSync(raw, { force: true });
        await ai.run(aiRt(), ["to3d", "--image", fig, "--out", raw, "--quality", o.quality === "fast" ? "fast" : "best", ...(o.seed != null ? ["--seed", String(parseInt(o.seed) || 0)] : [])], aiSend);
      }
      return H.ai3dRig();
    },
    // 只重做绑骨骼 + 脸（不用显卡，几十秒）
    async ai3dRig() {
      const raw = aiFile("gen", "raw.glb"); if (!fs.existsSync(raw)) throw new Error("还没生成 3D 模型");
      const out = path.dirname(aiFile("out", "x")); fs.mkdirSync(out, { recursive: true });
      const r = await ai.run(aiRt(), ["build", "--src", raw, "--out", out], aiSend);
      A3().warn = r.warn || []; A3().notes = r.notes || []; saveProfile();
      return { size: r.size, warn: A3().warn, notes: A3().notes };
    },
    // 眼睛和嘴的位置不对：老师在头部正面照上点三下（像素坐标）
    async ai3dFace(hints) {
      const ok = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(+v) && +v >= 0 && +v < 5000);
      if (!hints || !ok(hints.e1) || !ok(hints.e2) || !ok(hints.mouth)) throw new Error("要点三个点：两只眼睛、嘴");
      const h = { e1: hints.e1.map(Number), e2: hints.e2.map(Number), mouth: hints.mouth.map(Number) };
      const r = await ai.run(aiRt(), ["face", "--out", path.dirname(aiFile("out", "x")), "--hints", JSON.stringify(h)], aiSend);
      A3().notes = r.notes || []; saveProfile();
      return { size: r.size, notes: A3().notes };
    },
    ai3dShot() { const f = aiFile("out", "face_marked.png"), g = aiFile("out", "face_shot.png"); return fs.existsSync(f) ? { marked: dataUrl(f, "image/png"), plain: fs.existsSync(g) ? dataUrl(g, "image/png") : null } : null; },
    ai3dModel() { const m = aiModel(); return m ? new Uint8Array(fs.readFileSync(m)) : null; },
    ai3dCancel() { return ai.cancel(); },
    ai3dLog() { return ai.log.slice(-30); },
    ai3dOpenPage(k) { if (AI3D.PAGES[k]) env.openExternal(AI3D.PAGES[k]); return true; },
    // ---------- AI 形象（本机 ComfyUI）：照片 → Q版形象 → Q版动画 / AI 说话视频 / 3D 手办 ----------
    async aiavState(o = {}) {
      const a = AV(), fig = avFigure();
      let rt = null; try { rt = a.dir ? ENGINE.inspect(a.dir) : null; } catch (e) {}
      const engine = o.check === false ? eng.status() : await eng.refresh();
      let check = null; if (rt && rt.ok && o.check !== false) try { check = await eng.check(rt, a.files); } catch (e) {}
      const layers = avLayers();
      return { dir: a.dir || null, rt, engine, check, style: a.style || "toy", extra: a.extra || "", styles: Object.fromEntries(Object.entries(WF.STYLES).map(([k, v]) => [k, v.name])),
        cands: avCands().map((f) => dataUrl(f, "image/png")), figure: fig ? dataUrl(fig, "image/png") : null,
        layers: Object.fromEntries(Object.entries(layers).map(([k, f]) => [k, dataUrl(f, "image/png")])), rig: readJson(avFile("rig.json"), null), pages: ENGINE.PAGES };
    },
    async aiavPickDir() {
      const d = await env.pickDir("选 ComfyUI 整合包（ComfyUI_windows_portable）的文件夹"); if (!d) return null;
      const r = ENGINE.inspect(d); if (!r.ok) throw new Error(r.error);
      AV().dir = r.dir; saveProfile();
      return H.aiavState();
    },
    async aiavStart(o = {}) { const st = await eng.start(avRt(), { lowvram: !!o.lowvram }); if (!st.vram.gpu) avSend({ warn: "没认出 NVIDIA 显卡：AI 形象要用 NVIDIA 显卡（显存 8G 以上，说话视频要 12G 以上）" }); return H.aiavState(); },
    async aiavAttach(url) { await eng.attach(url); return H.aiavState(); },
    aiavStop() { eng.stop(); return eng.status(); },
    // 装插件（说话视频要用）；装完要重启 ComfyUI 才会加载
    async aiavInstall(feature = "talk") {
      const rt = avRt();
      await eng.installPacks(rt, feature, (m) => avSend({ ...m, stage: "install" }));
      if (eng.status().own) { eng.stop(); await eng.start(rt); }
      return H.aiavState();
    },
    async aiavDownload(feature) {
      if (!WF.NEEDS[feature]) throw new Error("没有这个功能");
      const vram = eng.status().vram.gb || AV().vram || 12;
      AV().vram = vram;
      await eng.fetchModels(avRt(), feature, AV().files, vram, (m) => avSend({ ...m, stage: "download", feature }));
      saveProfile();
      return H.aiavState();
    },
    // 照片 → 几张 Q版形象（白底全身竖图），老师挑
    async aiavPortrait(o = {}) {
      needConsent();
      if (!profile.photo || !fs.existsSync(P(profile.photo))) throw new Error("先在上面上传老师的照片");
      await avReady("portrait");
      const a = AV();
      a.style = WF.STYLES[o.style] ? o.style : a.style || "toy";
      a.extra = String(o.extra != null ? o.extra : a.extra || "").slice(0, 300);
      saveProfile();
      const name = await eng.upload(P(profile.photo), "laolao-photo" + path.extname(profile.photo));
      const n = Math.max(1, Math.min(4, parseInt(o.n) || 4));
      const g = WF.portrait({ photo: name, style: a.style, extra: a.extra, batch: n, fast: o.quality !== "best", seed: crypto.randomInt(1, 2 ** 31) }, avName);
      const tmp = path.dirname(avFile("tmp", "x")); fs.rmSync(tmp, { recursive: true, force: true });
      const files = await eng.run("画 Q版形象", g, tmp, (m) => avSend({ ...m, step: m.stage, stage: "portrait" }));
      const dir = path.dirname(avFile("cands", "x")); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      files.filter((f) => /\.png$/i.test(f)).forEach((f, i) => fs.renameSync(f, path.join(dir, `cand_${i}.png`)));
      fs.rmSync(tmp, { recursive: true, force: true });
      return avCands().map((f) => dataUrl(f, "image/png"));
    },
    // 挑一张；也可以用老师自己已经有的形象图（o.file）
    aiavChoose(i) {
      const c = avCands()[parseInt(i)]; if (!c) throw new Error("没有这一张");
      fs.rmSync(path.dirname(avFile("layers", "x")), { recursive: true, force: true }); fs.rmSync(avFile("rig.json"), { force: true });
      fs.copyFileSync(c, avFile("figure.png")); return dataUrl(avFile("figure.png"), "image/png");
    },
    async aiavPickFigure() {
      const f = await env.pickFile(["png", "jpg", "jpeg", "webp"], "选一张已经做好的 Q版形象（白底、全身、正面站好）", "图片"); if (!f) return null;
      if (fs.statSync(f).size > 20e6) throw new Error("图片太大了（超过 20MB）");
      fs.rmSync(path.dirname(avFile("layers", "x")), { recursive: true, force: true }); fs.rmSync(avFile("rig.json"), { force: true });
      if (/\.png$/i.test(f)) fs.copyFileSync(f, avFile("figure.png")); else await MEDIA.toPng(f, avFile("figure.png"));
      return dataUrl(avFile("figure.png"), "image/png");
    },
    // Q版动画要的图层：张一点嘴、张大嘴、闭眼（同一张图只改那一处）
    async aiavLayers(o = {}) {
      const fig = avFigure(); if (!fig) throw new Error("先挑一张 Q版形象");
      await avReady("portrait");
      const name = await eng.upload(fig, "laolao-figure.png");
      const dir = path.dirname(avFile("layers", "x")); fs.mkdirSync(dir, { recursive: true });
      const kinds = (o.kinds || Object.keys(WF.VARIANTS)).filter((k) => WF.VARIANTS[k]);
      for (let i = 0; i < kinds.length; i++) {
        const k = kinds[i], tmp = path.dirname(avFile("tmp", "x")); fs.rmSync(tmp, { recursive: true, force: true });
        const files = await eng.run("画口型和眨眼", WF.variant({ image: name, kind: k, seed: 7 + i, fast: o.quality !== "best" }, avName), tmp, (m) => avSend({ ...m, step: m.stage, stage: "layers", kind: k, i, n: kinds.length }));
        fs.renameSync(files[0], path.join(dir, k + ".png"));
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      fs.rmSync(avFile("rig.json"), { force: true });
      return H.aiavState({ check: false });
    },
    // 界面算好的 Q版动画数据（嘴、眼睛在哪，头怎么动）
    aiavSaveRig(rig) { const t = JSON.stringify(rig || null); if (!rig || t.length > 2e5) throw new Error("动画数据不对"); fs.writeFileSync(avFile("rig.json"), t); return true; },
    aiavSprites() {
      const fig = avFigure(); if (!fig) return null;
      const L = avLayers();
      return { figure: new Uint8Array(fs.readFileSync(fig)), layers: Object.fromEntries(Object.entries(L).map(([k, f]) => [k, new Uint8Array(fs.readFileSync(f))])), rig: readJson(avFile("rig.json"), null) };
    },
    // 挑好的形象拿去做 3D 手办（AI 3D 形象那一套）
    aiavTo3d() {
      const fig = avFigure(); if (!fig) throw new Error("先挑一张 Q版形象");
      for (const e of IMG_EXT) fs.rmSync(aiFile("figure." + e), { force: true });
      fs.copyFileSync(fig, aiFile("figure.png")); return dataUrl(aiFile("figure.png"), "image/png");
    },
    // AI 说话视频：形象 + 这一段配音 → 视频（慢：16G 显卡大约 2～3 分钟出 1 秒）
    async aiavTalk(key, o = {}) {
      needConsent();
      if (!keyOk(key)) throw new Error("编号不对");
      const s = segWav(key); if (!s) throw new Error("这一段还没有声音");
      const fig = avFigure(); if (!fig) throw new Error("先在「我的形象」里生成并挑一张 Q版形象");
      const st = await avReady("talk");
      const a16 = P("cache", `aiav-${key}-16k.wav`), out = P("cache", `vid-${key}.mp4`), png = P("cache", `vid-${key}.png`);
      await MEDIA.toWav(s.wav, a16, { rate: 16000 });
      const img = await eng.upload(fig, "laolao-figure.png");
      const aud = await eng.upload(a16, `laolao-${key}.wav`);
      const act = WF.TALK_ACT[o.act] ? o.act : "auto";
      const tmp = path.dirname(P("cache", "aiav-tmp", "x")); fs.rmSync(tmp, { recursive: true, force: true });
      const files = await eng.run("AI 说话视频", WF.talk({ image: img, audio: aud, seconds: s.ms / 1000, act, vramGB: st.vram.gb || 12, seed: crypto.randomInt(1, 2 ** 31) }, avName), tmp, (m) => send("talk", { ...m, step: m.stage, key, ai: true }));
      const raw = files.find((f) => /\.mp4$/i.test(f)); if (!raw) throw new Error("AI 引擎没出视频");
      await MEDIA.finalize(raw, s.wav, out, { meta: MEDIA.aigc(aigcId()), size: [720, 1280] });
      await MEDIA.poster(out, png);
      fs.rmSync(a16, { force: true }); fs.rmSync(tmp, { recursive: true, force: true });
      return { key, mp4: out, size: fs.statSync(out).size };
    },
    aiavCancel() { if (setupJob) setupJob.ac.abort(); return eng.cancel(); },
    // ---------- 一键下载安装（整合包从国内存储下，解压好自动选上）----------
    async setupInfo() {
      const out = {};
      for (const k of ["comfyui", "gsv", "hy3d"]) { const p = await mirror.pkg(k).catch(() => null); out[k] = p ? { size: p.size, ver: p.ver } : null; }
      const feat = {};
      for (const [f, keys] of Object.entries(WF.NEEDS)) {
        let n = 0, cn = 0;
        for (const k of keys) { const e = await mirror.model(k).catch(() => []); const one = e[0]; n += one ? one.size : WF.MODELS[k].size; if (one) cn++; }
        feat[f] = { bytes: n, cn: cn === keys.length };
      }
      return { pkg: out, feat, job: setupJob ? setupJob.kind : null };
    },
    // AI 形象一键装好：整合包（没有就下载安装）→ 启动 → 插件（说话视频要）→ 模型
    async aiavOneClick(feature = "portrait") {
      if (!WF.NEEDS[feature]) throw new Error("没有这个功能");
      let rt = null; try { rt = avRt(); } catch (e) {}
      if (!rt) {
        const need = WF.NEEDS[feature].reduce((s, k) => s + WF.MODELS[k].size, 0);
        const r = await runSetup("comfyui", `选一个放 AI 引擎的文件夹（路径只能有英文和数字，比如 D:\\AI；要留出大约 ${Math.ceil(need / 1e9 + 8)}G 空间）`, async (x) => x);
        if (!r) return null;
        AV().dir = r.dir; saveProfile(); rt = avRt();
      }
      if (!eng.status().running) { avSend({ stage: "setup", step: "start" }); await eng.start(rt); }
      const c = await eng.check(rt, AV().files);
      if (c.feat[feature].packs.length) { await H.aiavInstall(feature); }
      if (c.feat[feature].missing.length) await H.aiavDownload(feature);
      return H.aiavState();
    },
    async voiceInstall() {
      return runSetup("gsv", "选一个放声音克隆（GPT-SoVITS）的文件夹（路径只能有英文和数字，比如 D:\\AI；要留出大约 25G 空间）", async (r) => {
        const i = VOICE.inspect(r.dir); if (!i.ok) throw new Error(i.error);
        profile.gsvDir = r.dir; saveProfile(); return r.dir;
      });
    },
    async ai3dInstall() {
      return runSetup("hy3d", "选一个放 AI 3D 形象（Hunyuan3D-2）的文件夹（路径只能有英文和数字，比如 D:\\AI；要留出大约 80G 空间）", async (r) => {
        const i = AI3D.inspect(r.dir); if (!i.ok) throw new Error(i.error);
        A3().dir = r.dir; A3().check = null; saveProfile(); return H.ai3dCheck().catch(() => null);
      });
    },
    setupCancel() { if (setupJob) { setupJob.ac.abort(); return true; } return false; },
    aiavLog() { return eng.log.slice(-40); },
    aiavOpenPage(k) { if (ENGINE.PAGES[k]) env.openExternal(ENGINE.PAGES[k]); return true; },
    // ---------- 我的形象 ----------
    saveAvatar(spec) { if (!spec || typeof spec !== "object" || JSON.stringify(spec).length > 6000) throw new Error("形象数据不对"); profile.avatar = spec; saveProfile(); return true; },
    saveLayout(o) { if (o && (o.side === "left" || o.side === "right")) profile.side = o.side; if (o && +o.scale >= 0.25 && +o.scale <= 0.8) profile.scale = +o.scale; saveProfile(); return true; },
    // 照片做的脸（界面里做好的 1024×1024 png）和标的三个点
    saveFace(png, marks) {
      const b = Buffer.from(png || []);
      if (b.length < 100 || b.length > 4e6 || b.toString("ascii", 1, 4) !== "PNG") throw new Error("脸的图片不对");
      fs.writeFileSync(P("face.png"), b); profile.face = "face.png";
      profile.faceMarks = marks && typeof marks === "object" ? Object.fromEntries(Object.entries(marks).filter(([k, v]) => ["e1", "e2", "mouth"].includes(k) && Array.isArray(v)).map(([k, v]) => [k, v.slice(0, 2).map(Number)])) : {};
      saveProfile(); return true;
    },
    // 存成捞捞编程的皮肤文件（放在「文档」里），形象数据 + 缩小的脸
    exportSkin(sp) {
      if (!sp || typeof sp !== "object") throw new Error("形象数据不对");
      const face = typeof sp.faceImage === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(sp.faceImage) && sp.faceImage.length < 60000 ? sp.faceImage : undefined;
      const person = { ...sp }; delete person.faceImage; if (face) person.faceImage = face;
      const skin = { id: "my-teacher", name: "我的分身", author: "捞捞PPT助手", version: "1.0.0", desc: "用捞捞PPT助手做的老师分身", model: "person", person, colors: { body: "#7c8cf0" } };
      const out = path.join(env.documents, "捞捞编程皮肤-我的分身.json");
      fs.mkdirSync(env.documents, { recursive: true }); fs.writeFileSync(out, JSON.stringify(skin, null, 2));
      outputs.add(out); return { file: out, size: fs.statSync(out).size };
    },
    async pickPhoto() {
      needConsent();
      const f = await env.pickFile(IMG_EXT, "选一张老师的正面照片", "图片"); if (!f) return null;
      if (fs.statSync(f).size > 15e6) throw new Error("照片太大了（超过 15MB）");
      const name = "photo" + path.extname(f).toLowerCase();
      for (const e of IMG_EXT) fs.rmSync(P("photo." + e), { force: true });
      fs.copyFileSync(f, P(name)); profile.photo = name; saveProfile();
      return photoInfo();
    },
    // ---------- 上传一段视频：挑正脸 / 侧脸 / 后脑勺、截配音参考、做真人数字人的模板 ----------
    async pickVideo() {
      needConsent();
      const f = await env.pickFile(VIDEO_EXT, "选一段老师的视频（10～30 秒：看着镜头说一句话，再慢慢左右转头、转过去背对一下）", "视频"); if (!f) return null;
      if (fs.statSync(f).size > 1.5e9) throw new Error("视频太大了（超过 1.5GB），剪短一点再传");
      fs.rmSync(videoDir(), { recursive: true, force: true }); fs.mkdirSync(videoDir(), { recursive: true });
      const src = videoDir("src" + path.extname(f).toLowerCase()); fs.copyFileSync(f, src);
      const r = await MEDIA.extractVideo(src, videoDir(), { fps: 4, max: 960, maxSec: 60 });
      if (r.seconds < 3 || r.frames.length < 8) throw new Error("视频太短了（至少 3 秒，最好 10～30 秒）");
      profile.video = { src: path.relative(USER, src), seconds: Math.round(r.seconds * 10) / 10, w: r.w, h: r.h, audio: !!r.audio, fps: 4, n: r.frames.length, at: new Date().toISOString() };
      saveProfile();
      return videoInfo();
    },
    // 抽出来的帧（给界面一张张认脸、打分）：从第 i0 帧起 n 张
    videoFrames(i0 = 0, n = 8) {
      const d = videoDir("frames"); if (!fs.existsSync(d)) return [];
      const fr = fs.readdirSync(d).filter((f) => /^f_\d+\.jpg$/.test(f)).sort();
      const fps = (profile.video && profile.video.fps) || 4;
      return fr.slice(Math.max(0, i0 | 0), Math.max(0, i0 | 0) + Math.max(1, Math.min(32, n | 0))).map((f, k) => ({ i: (i0 | 0) + k, t: ((i0 | 0) + k + 0.5) / fps, jpg: new Uint8Array(fs.readFileSync(path.join(d, f))) }));
    },
    videoTemplate() { const f = videoDir("template.mp4"); return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null; },
    videoAudio() { const a = videoDir("audio.wav"); return fs.existsSync(a) ? new Uint8Array(fs.readFileSync(a)) : null; },
    // 老师确认了挑出来的东西：o = { front: 秒, views: { left, right, back: 秒 }, voice: [开始, 结束] 秒, text: 说的话, template: { t0, t1, cx, cy, w } }
    async videoUse(o = {}) {
      needConsent();
      const v = profile.video; if (!v || !fs.existsSync(P(v.src))) throw new Error("先上传一段视频");
      const src = P(v.src), num = (x) => Number.isFinite(+x) && +x >= 0 && +x <= v.seconds + 1;
      const done = {};
      if (num(o.front)) {
        for (const e of IMG_EXT) fs.rmSync(P("photo." + e), { force: true });
        await MEDIA.frameAt(src, +o.front, P("photo.jpg")); profile.photo = "photo.jpg"; done.photo = true;
      }
      fs.rmSync(videoDir("views"), { recursive: true, force: true });
      for (const k of ["left", "right", "back"]) if (o.views && num(o.views[k])) { fs.mkdirSync(videoDir("views"), { recursive: true }); await MEDIA.frameAt(src, +o.views[k], videoDir("views", k + ".jpg")); }
      if (Array.isArray(o.voice) && num(o.voice[0]) && num(o.voice[1]) && o.voice[1] - o.voice[0] >= 1 && fs.existsSync(videoDir("audio.wav"))) {
        fs.mkdirSync(P("voice"), { recursive: true });
        await MEDIA.cutWav(videoDir("audio.wav"), +o.voice[0], Math.min(+o.voice[1], +o.voice[0] + 10), P("voice", "ref.wav"), 32000);
        const w = MEDIA.readWav(fs.readFileSync(P("voice", "ref.wav")));
        profile.voice = { ref: path.join("voice", "ref.wav"), prompt: String(o.text || "").slice(0, 200), seconds: Math.round(w.seconds * 10) / 10, from: "video" };
        done.voice = true;
      }
      const t = o.template;
      if (t && num(t.t0) && num(t.t1) && t.t1 - t.t0 >= 2) {
        await MEDIA.makeTemplate(src, +t.t0, Math.min(+t.t1, +t.t0 + 20), videoDir("template.mp4"), { cx: +t.cx, cy: +t.cy, w: +t.w });
        done.template = true;
      }
      saveProfile();
      return { ...done, photo: photoInfo(), voice: voiceInfo(), video: videoInfo() };
    },
    // ---------- 真人数字人（老师视频 + 配音 → 对口型，LatentSync）----------
    async talkCheck() { const r = await ai.run(aiRt(), ["talk-check"], aiSend); A3().talk = r.info; saveProfile(); return r.info; },
    async talkSetup() { const r = await ai.run(aiRt(), ["talk-setup"], aiSend, { LAO_FFMPEG: MEDIA.ffmpegPath() }); A3().talk = r.info || A3().talk; saveProfile(); return A3().talk; },
    async talkMake(key, o = {}) {
      needConsent();
      if (!keyOk(key)) throw new Error("编号不对");
      const s = segWav(key); if (!s) throw new Error("这一段还没有声音");
      const tpl = videoDir("template.mp4"); if (!fs.existsSync(tpl)) throw new Error("还没有真人数字人的模板：先在「我的形象」上传一段视频");
      const a16 = P("cache", `talk-${key}-16k.wav`), raw = P("cache", `talk-${key}-raw.mp4`), out = P("cache", `vid-${key}.mp4`), png = P("cache", `vid-${key}.png`);
      await MEDIA.toWav(s.wav, a16, { rate: 16000 });
      fs.rmSync(raw, { force: true });
      await ai.run(aiRt(), ["talk", "--template", tpl, "--audio", a16, "--out", raw, "--quality", o.quality === "fast" ? "fast" : "best"], (m) => send("talk", { key, ...m }), { LAO_FFMPEG: MEDIA.ffmpegPath() });
      await MEDIA.finalize(raw, s.wav, out, { meta: MEDIA.aigc(aigcId()) });
      await MEDIA.poster(out, png);
      fs.rmSync(a16, { force: true }); fs.rmSync(raw, { force: true });
      return { key, mp4: out, size: fs.statSync(out).size };
    },
    // ---------- 我的声音 ----------
    async pickVoice() {
      needConsent();
      const f = await env.pickFile(AUDIO_EXT, "选一段老师的录音（3～10 秒，安静的地方录）", "声音"); if (!f) return null;
      fs.mkdirSync(P("voice"), { recursive: true });
      const w = await MEDIA.toWav(f, P("voice", "ref.wav"), { rate: 32000, maxSec: 10 });
      profile.voice = { ref: path.join("voice", "ref.wav"), prompt: (profile.voice && profile.voice.prompt) || "", seconds: Math.round(w.seconds * 10) / 10 };
      saveProfile();
      return { ...voiceInfo(), short: w.seconds < 3 };
    },
    setVoicePrompt(t) { if (!profile.voice) throw new Error("先上传一段录音"); profile.voice.prompt = String(t || "").slice(0, 200); saveProfile(); return true; },
    async pickGsvDir() {
      const d = await env.pickDir("选 GPT-SoVITS 整合包的文件夹"); if (!d) return null;
      const i = VOICE.inspect(d); if (!i.ok) throw new Error(i.error);
      profile.gsvDir = d; saveProfile(); return d;
    },
    async voiceStart() { if (!profile.gsvDir) throw new Error("先选 GPT-SoVITS 的文件夹"); await voice.start(profile.gsvDir, env.voiceOpt || {}); return voice.state; },
    voiceStop() { voice.stop(); return voice.state; },
    voiceState() { return { ...voice.state, log: voice.log.slice(-8) }; },
    openGsvPage() { env.openExternal(VOICE.DOWNLOAD_PAGE); return true; },
    // 网站上的页面：捞小智的入口（地址在网站的 site-config.js 里配，换地址不用改软件）、规划中的功能
    openSite(k) { const P2 = { xiaozhi: "xiaozhi/", next: "ppt/#next", ppt: "ppt/" }; if (!P2[k]) throw new Error("没有这个页面"); env.openExternal("https://www.laolaokechengbiao.cn/" + P2[k]); return true; },
    // ---------- PPT ----------
    async openPpt() {
      const f = await env.pickFile(["pptx"], "打开一个 PPT（.pptx）", "PowerPoint"); if (!f) return null;
      const info = await PPTX.read(fs.readFileSync(f));
      doc = { file: f, info };
      return { file: f, info };
    },
    draft(no, opt = {}) {
      if (!doc) throw new Error("先打开一个 PPT");
      const s = doc.info.slides.find((x) => x.no === no); if (!s) throw new Error("没有这一页");
      const qa = DRAFT.questions(s);
      return { narration: DRAFT.narration(s, { first: !!opt.first, hasQa: qa.length > 0 }), qa };
    },
    // 一段话的声音：有老师自己录的就用录的，没有就用 GPT-SoVITS 念（文字没变就用上次生成的）
    async synth(key, text) {
      if (!keyOk(key)) throw new Error("编号不对");
      text = String(text || "").trim(); if (!text) throw new Error("这一段没有文字");
      const rec = P("cache", `rec-${key}.wav`);
      let wav, src;
      if (fs.existsSync(rec)) { wav = rec; src = "rec"; }
      else {
        const v = profile.voice; if (!v || !fs.existsSync(P(v.ref))) throw new Error("还没有老师的声音：先在「我的声音」里上传一段录音");
        wav = P("cache", `tts-${key}-${hash(text + "|" + v.prompt + "|" + v.seconds)}.wav`); src = "tts";
        if (!fs.existsSync(wav)) { const b = await voice.tts({ text, refWav: P(v.ref), promptText: v.prompt }); fs.writeFileSync(wav, b); }
      }
      const w = MEDIA.readWav(fs.readFileSync(wav));
      const r = { key, src, wav, ms: Math.round(w.seconds * 1000), levels: MEDIA.lipLevels(w.samples, w.rate, 25) };
      fs.writeFileSync(P("cache", `seg-${key}.json`), JSON.stringify({ wav, ms: r.ms }));
      return r;
    },
    posterUrl(key) { const f = P("cache", `vid-${key}.png`); return keyOk(key) && fs.existsSync(f) ? dataUrl(f, "image/png") : null; },
    previewAudio(key) { const s = segWav(key); return s ? dataUrl(s.wav, "audio/wav") : null; },
    async pickRecording(key) {
      if (!keyOk(key)) throw new Error("编号不对");
      const f = await env.pickFile(AUDIO_EXT, "选老师自己录的这一段", "声音"); if (!f) return null;
      const w = await MEDIA.toWav(f, P("cache", `rec-${key}.wav`), { rate: 32000 });
      return { ms: Math.round(w.seconds * 1000) };
    },
    dropRecording(key) { if (keyOk(key)) fs.rmSync(P("cache", `rec-${key}.wav`), { force: true }); return true; },
    hasRecording(key) { return keyOk(key) && fs.existsSync(P("cache", `rec-${key}.wav`)); },
    // ---------- 视频：界面一帧帧画好送过来（png，或者 opt.jpeg 时是 jpg；封面单独一张 png）----------
    videoBegin(key, opt) {
      if (!keyOk(key)) throw new Error("编号不对");
      const s = segWav(key); if (!s) throw new Error("这一段还没有声音");
      const id = ++jobN, out = P("cache", `vid-${key}.mp4`);
      jobs.set(id, { key, enc: MEDIA.encoder(out, { fps: 25, wav: s.wav, codec: opt && opt.jpeg ? "mjpeg" : "png", meta: MEDIA.aigc(aigcId()) }), out, poster: P("cache", `vid-${key}.png`), first: true });
      return id;
    },
    async videoFrame(id, png, isPoster) {
      const j = jobs.get(id); if (!j) throw new Error("视频已经结束了");
      const b = Buffer.from(png);
      const isPng = b.length > 8 && b.toString("ascii", 1, 4) === "PNG";
      if (isPoster) { if (!isPng) throw new Error("封面要 png"); fs.writeFileSync(j.poster, b); j.first = false; return true; }
      if (j.first) { j.first = false; if (isPng) fs.writeFileSync(j.poster, b); }
      await j.enc.write(b); return true;
    },
    async videoEnd(id) {
      const j = jobs.get(id); if (!j) throw new Error("视频已经结束了"); jobs.delete(id); await j.enc.end();
      try { await MEDIA.poster(j.out, j.poster); } catch (e) {}   // 封面换成视频第一帧（带「AI生成」标识）
      return { key: j.key, mp4: j.out, size: fs.statSync(j.out).size };
    },
    videoCancel(id) { const j = jobs.get(id); if (j) { j.enc.kill(); jobs.delete(id); } return true; },
    // ---------- 写进 PPT ----------
    // plan: [{ no, narration: key|null, qa: [{ q, a, key }] }]
    async build(plan) {
      if (!doc) throw new Error("先打开一个 PPT");
      const segOf = (key) => {
        const v = P("cache", `vid-${key}.mp4`), p = P("cache", `vid-${key}.png`), s = segWav(key);
        if (!fs.existsSync(v) || !fs.existsSync(p)) throw new Error("视频还没生成：" + key);
        return { video: fs.readFileSync(v), poster: fs.readFileSync(p), ms: s ? s.ms + 600 : 10000 };
      };
      const items = (plan || []).map((it) => ({ no: it.no, narration: it.narration ? segOf(it.narration) : null, qa: (it.qa || []).filter((q) => q.key).map((q) => ({ q: q.q, a: q.a, ...segOf(q.key) })) }));
      const { buf, report } = await PPTX.write(fs.readFileSync(doc.file), items, { side: profile.side, scale: profile.scale });
      const base = path.basename(doc.file, path.extname(doc.file)).replace(/（捞捞助手）$/, "");
      let dir = path.dirname(doc.file), out = path.join(dir, `${base}（捞捞助手）.pptx`);
      try { fs.writeFileSync(out, buf); }
      catch (e) {
        if (e.code === "EBUSY" || e.code === "EPERM") throw new Error("「" + path.basename(out) + "」正在 PowerPoint 里打开着，先关掉它再生成");
        dir = env.documents; out = path.join(dir, `${base}（捞捞助手）.pptx`); fs.writeFileSync(out, buf);
      }
      outputs.add(out);
      return { file: out, report, size: buf.length };
    },
    openFile(f) { if (!outputs.has(f)) throw new Error("不能打开这个文件"); env.openPath(f); return true; },
    reveal(f) { if (!outputs.has(f)) throw new Error("不能打开这个文件"); env.reveal(f); return true; },
  };
  return { H, shutdown: () => { voice.stop(); eng.stop(); } };
}

module.exports = { createService };
