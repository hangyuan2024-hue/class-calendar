// 后台：草稿、配音（有录音用录音）、只能打开自己生成的文件
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const { createService } = require("../core/service");
const M = require("../core/media");
const ok = (m) => console.log("✓ " + m);
(async () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), "svc-")), gsv = path.join(user, "gsv");
  fs.mkdirSync(gsv); fs.writeFileSync(path.join(gsv, "api_v2.py"), "");
  const ref = path.join(user, "ref.wav"), rec = path.join(user, "rec.wav");
  fs.writeFileSync(ref, M.writeWav(new Float32Array(16000 * 5).map((_, i) => 0.3 * Math.sin(i / 6)), 16000));
  fs.writeFileSync(rec, M.writeWav(new Float32Array(16000 * 2).map((_, i) => 0.3 * Math.sin(i / 6)), 16000));
  let next = null;
  const opened = [];
  const svc = createService({ user, documents: user, version: "t", send() {}, pickFile: async () => next, pickDir: async () => gsv, openPath: (f) => opened.push(f), reveal() {}, openExternal() {},
    voiceOpt: { cmd: process.execPath, args: (p) => [path.join(__dirname, "fake-gsv.js"), String(p)], waitMs: 15000 } });
  const H = svc.H;
  await assert.rejects(H.synth("n2", "你好"), /还没有老师的声音/);
  next = ref; await assert.rejects(H.pickVoice(), /授权/); await assert.rejects(H.pickPhoto(), /授权/); await assert.rejects(H.pickVideo(), /授权/);
  assert.throws(() => H.saveConsent({ who: "self" }), /勾选同意/);
  assert.throws(() => H.saveConsent({ who: "other", agree: true, name: "丁老师" }), /书面同意/);
  assert.throws(() => H.saveConsent({ who: "other", agree: true, written: true }), /名字/);
  H.saveConsent({ who: "self", agree: true }); assert.equal(H.state().consent.who, "self");
  ok("授权：没同意之前不能上传照片、视频、声音；用别人的要写名字、要有书面同意");
  const v = await H.pickVoice(); assert.equal(v.seconds, 5); H.setVoicePrompt("你好");
  await H.pickGsvDir(); await H.voiceStart();
  const a = await H.synth("n2", "同学们好，我们开始上课。");
  assert.equal(a.src, "tts"); assert.ok(a.ms > 2000 && a.levels.length === Math.ceil(a.ms / 40));
  next = rec; await H.pickRecording("n2");
  const b = await H.synth("n2", "同学们好，我们开始上课。");
  assert.equal(b.src, "rec"); assert.equal(b.ms, 2000);
  await assert.rejects(H.synth("../x", "hi"), /编号不对/);
  ok("配音：用 GPT-SoVITS 念；这一段有自己的录音就用录音；编号不能乱写");
  next = path.join(__dirname, "fixtures", "sample.pptx"); await H.openPpt();
  const d = H.draft(2, { first: true });
  assert.ok(d.narration.startsWith("同学们好！这一页我们来看「冒泡排序」") && d.qa.length === 2);
  assert.ok(H.draft(3).qa.some((q) => /代码/.test(q.q)));
  ok("草稿：讲解词从标题和要点来，有代码的页问代码");
  assert.throws(() => H.saveFace(new Uint8Array(50), {}), /脸的图片不对/);
  const png = fs.readFileSync(path.join(__dirname, "fixtures", "face.png"));
  H.saveFace(new Uint8Array(png), { e1: [1, 2], e2: [3, 4], mouth: [5, 6], evil: "x" });
  const st = H.state(); assert.ok(st.face.url.startsWith("data:image/png;base64,")); assert.deepStrictEqual(Object.keys(st.face.marks), ["e1", "e2", "mouth"]);
  const ex = H.exportSkin({ hairStyle: "flare", faceImage: "data:image/jpeg;base64,/9j/AAAA" });
  const sk = JSON.parse(fs.readFileSync(ex.file, "utf8"));
  assert.equal(sk.model, "person"); assert.equal(sk.person.faceImage, "data:image/jpeg;base64,/9j/AAAA");
  assert.equal(JSON.parse(fs.readFileSync(H.exportSkin({ faceImage: "javascript:x" }).file, "utf8")).person.faceImage, undefined);
  H.reveal(ex.file);
  ok("照片脸：存脸（只收 png）、标的点只留三个；导出捞捞编程皮肤（脸只收 data:image）");
  assert.throws(() => H.openFile("C:\\Windows\\system32\\calc.exe"), /不能打开/);
  ok("只能打开自己生成的 PPT");
  { const opened = []; const sv = createService({ user, documents: user, version: "t", send() {}, pickFile: async () => null, pickDir: async () => null, openPath() {}, reveal() {}, openExternal: (u) => opened.push(u), voiceOpt: {} });
    sv.H.openSite("xiaozhi"); sv.H.openSite("next"); assert.throws(() => sv.H.openSite("https://evil.example/"), /没有这个页面/);
    assert.deepStrictEqual(opened, ["https://www.laolaokechengbiao.cn/xiaozhi/", "https://www.laolaokechengbiao.cn/ppt/#next"]); sv.shutdown();
    ok("左边栏「捞小智」「更多功能」打开网站上的页面（只认固定的几个）"); }

  // 上传视频：抽帧、截配音、挑正脸 / 后脑勺、做真人数字人模板
  const vid = path.join(user, "teacher.mp4");
  await M.run(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=8", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid]);
  next = vid; const vi = await H.pickVideo();
  assert.ok(vi.seconds > 7.5 && vi.audio && vi.n >= 30, JSON.stringify(vi));
  const fr = H.videoFrames(4, 3); assert.equal(fr.length, 3); assert.equal(fr[0].i, 4); assert.ok(fr[0].jpg[0] === 0xff && fr[0].jpg[1] === 0xd8); assert.ok(Math.abs(fr[0].t - 1.125) < 1e-6);
  const used = await H.videoUse({ front: 2.1, views: { back: 6.2, left: 99 }, voice: [1, 5], text: "同学们好", template: { t0: 0.5, t1: 6, cx: 0.5, cy: 0.4, w: 0.5 } });
  assert.ok(used.photo.startsWith("data:image/jpeg") && used.voice.prompt === "同学们好" && Math.abs(used.voice.seconds - 4) < 0.1);
  assert.deepStrictEqual(Object.keys(used.video.views), ["back"]); assert.equal(used.video.template, true);
  const tp = await M.probe(path.join(user, "video", "template.mp4")); assert.equal(tp.w, 720); assert.equal(tp.h, 1280); assert.equal(tp.audio, false);
  ok("上传视频：每秒 4 帧给界面挑；正脸那一帧当照片、后脑勺存下来、截 4 秒当配音参考（带说的话）、裁成竖的 720×1280 当真人模板");

  // 讲解视频带「AI生成」标识（画面左上角）和元数据里的 AIGC 隐式标识
  const { spawnSync } = require("child_process");
  const meta = (f) => spawnSync(M.ffmpegPath(), ["-hide_banner", "-i", f], { encoding: "utf8" }).stderr;
  const id = H.videoBegin("n2", {});
  const blank = fs.readFileSync(path.join(__dirname, "fixtures", "face.png"));
  for (let i = 0; i < 10; i++) await H.videoFrame(id, new Uint8Array(blank));
  const ve = await H.videoEnd(id);
  assert.match(meta(ve.mp4), /AIGC\s*:\s*\{"AIGC":\{"Label":"1","ContentProducer":"捞捞PPT助手","ProduceID":"[0-9a-f-]{36}"/);
  ok("讲解视频：元数据里有 AIGC 隐式标识（GB 45438-2025 附录 E 的格式）");

  // 真人数字人（工坊用测试模式：把模板接到配音那么长）
  const py = process.platform === "win32" ? "python" : "python3";
  if (spawnSync(py, ["-c", "import cv2, soundfile, numpy"]).status === 0) {
    const hyd = path.join(user, "hy"); fs.mkdirSync(path.join(hyd, "Hunyuan3D-2", "hy3dgen", "shapegen"), { recursive: true }); fs.writeFileSync(path.join(hyd, "Hunyuan3D-2", "hy3dgen", "shapegen", "__init__.py"), "");
    next = null; const svc2 = createService({ user, documents: user, version: "t", send() {}, pickFile: async () => null, pickDir: async () => hyd, openPath() {}, reveal() {}, openExternal() {}, voiceOpt: {} });
    process.env.LAO3D_TEST_TALK = "1";
    svc2.H.ai3dPickDir = svc2.H.ai3dPickDir; await svc2.H.ai3dPickDir().catch(() => {});
    const tk = await svc2.H.talkMake("n2");
    const inf = await M.probe(tk.mp4); assert.equal(inf.w, 720); assert.ok(inf.audio);
    assert.match(meta(tk.mp4), /AIGC/); assert.ok(fs.existsSync(path.join(user, "cache", "vid-n2.png")));
    delete process.env.LAO3D_TEST_TALK; svc2.shutdown();
    ok("真人数字人：模板 + 配音 → 对口型（测试模式）→ 叠「AI生成」、写 AIGC 元数据、出封面");
  } else console.log("（跳过真人数字人：这台电脑的 Python 没有 cv2 / soundfile）");

  // AI 形象（本机 ComfyUI，用假的）：照片 → Q版候选 → 挑一张 → 口型 / 眨眼图层 → AI 说话视频
  {
    const FAKE = require("./fake-comfy");
    const W = require("../core/workflows");
    const talkMp4 = path.join(user, "ai-talk.mp4");
    await M.run(["-f", "lavfi", "-i", "testsrc=size=480x832:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", talkMp4]);
    const fake = await FAKE.start({ view: (fn) => fs.readFileSync(/\.mp4$/.test(fn) ? talkMp4 : path.join(__dirname, "fixtures", "face.png")) });
    const comfy = path.join(user, "ComfyUI_windows_portable");
    fs.mkdirSync(path.join(comfy, "ComfyUI", "comfy"), { recursive: true }); fs.writeFileSync(path.join(comfy, "ComfyUI", "main.py"), "");
    const pyRel = process.platform === "win32" ? ["python_embeded", "python.exe"] : ["python_embeded", "bin", "python3"];
    fs.mkdirSync(path.join(comfy, ...pyRel.slice(0, -1)), { recursive: true }); fs.writeFileSync(path.join(comfy, ...pyRel), "");
    const sends = [];
    const sv = createService({ user, documents: user, version: "t", send: (ch, d) => sends.push([ch, d]), pickFile: async () => null, pickDir: async () => comfy, openPath() {}, reveal() {}, openExternal() {}, voiceOpt: {}, engineOpt: { hf: [fake.url], poll: 20 } });
    const A = sv.H;
    let st = await A.aiavPickDir(); assert.equal(st.rt.ok, true); assert.equal(st.engine.running, false);
    await assert.rejects(A.aiavPortrait(), /先启动 AI 引擎/);
    st = await A.aiavAttach(fake.url); assert.equal(st.engine.vram.gb, 16);
    await assert.rejects(A.aiavPortrait(), /模型没下载好/);
    const put = (k) => { const m = W.MODELS[k], f = path.join(comfy, "ComfyUI", "models", m.dir, m.name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "x"); };
    W.NEEDS.portrait.forEach(put);
    st = await A.aiavState(); assert.equal(st.check.feat.portrait.ready, true); assert.equal(st.check.feat.talk.ready, false);
    const cands = await A.aiavPortrait({ style: "anime", extra: "戴细框眼镜", n: 2 });
    assert.equal(cands.length, 2); assert.ok(cands[0].startsWith("data:image/png;base64,"));
    const pp = fake.st.prompts[0].prompt; const enc = Object.values(pp).find((n) => n.class_type === "TextEncodeQwenImageEditPlus");
    assert.match(enc.inputs.prompt, /anime/); assert.match(enc.inputs.prompt, /戴细框眼镜/); assert.ok(fake.st.uploads["laolao-photo.jpg"] > 0);
    assert.equal(Object.values(pp).find((n) => n.class_type === "EmptySD3LatentImage").inputs.batch_size, 2);
    assert.ok(sends.some(([ch, d]) => ch === "aiav" && d.stage === "portrait" && d.value === 2));
    A.aiavChoose(1);
    st = await A.aiavLayers();
    assert.deepStrictEqual(Object.keys(st.layers).sort(), ["eyesClosed", "mouthHalf", "mouthOpen"]); assert.ok(st.figure);
    A.aiavSaveRig({ mouth: [1, 2, 3, 4] }); assert.deepStrictEqual(A.aiavSprites().rig, { mouth: [1, 2, 3, 4] }); assert.ok(A.aiavSprites().layers.mouthOpen.length > 100);
    ok("AI 形象：先启动引擎、模型下全才能画；照片 → 几张 Q版候选（画风、补充说明都传进去）→ 挑一张 → 画出张嘴、闭眼图层");
    await assert.rejects(A.aiavTalk("n2"), /插件/);
    for (const p of W.NODE_PACKS) fs.mkdirSync(path.join(comfy, "ComfyUI", "custom_nodes", p.dir), { recursive: true });
    W.NEEDS.talk.forEach(put);
    const tv = await A.aiavTalk("n2", { act: "wave" });
    const inf = await M.probe(tv.mp4); assert.equal(inf.w, 720); assert.equal(inf.h, 1280); assert.ok(inf.audio);
    assert.match(meta(tv.mp4), /AIGC/); assert.ok(fs.existsSync(path.join(user, "cache", "vid-n2.png")));
    const tp2 = fake.st.prompts[fake.st.prompts.length - 1].prompt;
    assert.match(Object.values(tp2).find((n) => n.class_type === "WanVideoTextEncodeCached").inputs.positive_prompt, /waves one hand/);
    assert.equal(Object.values(tp2).find((n) => n.class_type === "WanVideoBlockSwap").inputs.blocks_to_swap, 25);
    ok("AI 说话视频：形象 + 配音 → 视频（按 16G 显存省显存）→ 放大到 720×1280、叠「AI生成」、写 AIGC 元数据、出封面");
    A.aiavTo3d(); assert.ok(fs.existsSync(path.join(user, "ai3d", "figure.png")));
    ok("挑好的 Q版形象可以直接拿去做 3D 手办");
    sv.shutdown(); fake.close();
  }

  // 一键清除
  H.clearBiometrics();
  assert.ok(!fs.existsSync(path.join(user, "aiav", "figure.png")) && !fs.existsSync(path.join(user, "aiav", "cands")) && !fs.existsSync(path.join(user, "aiav", "layers")));
  const st2 = H.state();
  assert.equal(st2.photo, null); assert.equal(st2.voice, null); assert.equal(st2.video, null); assert.equal(st2.consent, null); assert.equal(st2.face, null);
  assert.ok(!fs.existsSync(path.join(user, "video")) && !fs.existsSync(path.join(user, "voice")));
  assert.ok(fs.readFileSync(path.join(user, "consent-log.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse).some((r) => r.act === "clear"));
  await assert.rejects(H.pickPhoto(), /授权/);
  ok("一键清除：照片、视频、声音、做好的脸和讲解视频都删掉，授权撤回（留一条记录）");
  svc.shutdown();
  console.log("后台：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
