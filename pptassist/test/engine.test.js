// 本机 AI 引擎（ComfyUI）：认整合包、连接、检查缺什么、挑模型文件、断点续传、装插件、跑工作流、出错、停止
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const E = require("../core/engine");
const W = require("../core/workflows");
const FAKE = require("./fake-comfy");
const ok = (m) => console.log("✓ " + m);
const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-"));
  // ---- 认整合包 ----
  assert.equal(E.inspect(path.join(tmp, "nope")).ok, false);
  assert.match(E.inspect(tmp).error, /没有 ComfyUI/);
  const root = path.join(tmp, "ComfyUI_windows_portable");
  fs.mkdirSync(path.join(root, "ComfyUI", "models"), { recursive: true });
  fs.writeFileSync(path.join(root, "ComfyUI", "main.py"), ""); fs.mkdirSync(path.join(root, "ComfyUI", "comfy"));
  assert.match(E.inspect(root).error, /python_embeded/);
  const pyRel = process.platform === "win32" ? ["python_embeded", "python.exe"] : ["python_embeded", "bin", "python3"];
  fs.mkdirSync(path.join(root, ...pyRel.slice(0, -1)), { recursive: true }); fs.writeFileSync(path.join(root, ...pyRel), "");
  const rt = E.inspect(tmp);   // 选外面一层也能找到
  assert.equal(rt.ok, true); assert.equal(rt.comfy, path.join(root, "ComfyUI")); assert.equal(E.inspect(path.join(root, "ComfyUI")).dir, root);
  ok("认整合包：ComfyUI + 自带的 Python，选外面一层、里面一层都行");

  // ---- 连接、检查 ----
  const fake = await FAKE.start({
    trees: { "city96/Wan2.1-I2V-14B-480P-gguf": ["Q3_K_M", "Q4_K_M", "Q5_K_M", "Q8_0"].map((q) => ({ type: "file", path: `wan2.1-i2v-14b-480p-${q}.gguf`, size: 100 })), "Kijai/WanVideo_comfy_GGUF/InfiniteTalk": [{ type: "file", path: "InfiniteTalk/Wan2_1-InfiniteTalk_Single_Q8.gguf", size: 50 }, { type: "file", path: "InfiniteTalk/Wan2_1-InfiniteTalk_Multi_Q8.gguf", size: 50 }] },
  });
  const eng = E.create({ hf: [fake.url], gh: [fake.url + "/"], pip: [""], poll: 30 });
  await assert.rejects(eng.attach("http://192.168.1.5:8188"), /本机/);
  const s = await eng.attach(fake.url);
  assert.equal(s.running, true); assert.deepEqual(s.vram, { gb: 16, name: "NVIDIA GeForce RTX 4060 Ti", gpu: true });
  rt.nodes = path.join(root, "ComfyUI", "custom_nodes"); rt.models = path.join(root, "ComfyUI", "models");
  let c = await eng.check(rt, {});
  assert.equal(c.feat.portrait.ready, false); assert.deepEqual(c.feat.portrait.missing, W.NEEDS.portrait);
  assert.ok(c.feat.talk.packs.includes("ComfyUI-WanVideoWrapper")); assert.ok(c.feat.portrait.bytes > 20e9);
  ok("连接本机的 ComfyUI（不连别的电脑）；认出显卡和显存；查出缺哪些模型和插件");

  // ---- 挑模型文件 ----
  assert.equal((await eng.resolve("wanI2V", 16)).name, "wan2.1-i2v-14b-480p-Q5_K_M.gguf");
  assert.equal((await eng.resolve("wanI2V", 24)).name, "wan2.1-i2v-14b-480p-Q8_0.gguf");
  assert.equal((await eng.resolve("wanI2V", 8)).name, "wan2.1-i2v-14b-480p-Q4_K_M.gguf");
  const tk = await eng.resolve("talkModel", 12);
  assert.equal(tk.name, "Wan2_1-InfiniteTalk_Single_Q8.gguf"); assert.equal(tk.urls[0], `${fake.url}/Kijai/WanVideo_comfy_GGUF/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk_Single_Q8.gguf`);
  assert.equal((await eng.resolve("qwenVae", 12)).urls[0], `${fake.url}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors`);
  ok("挑模型：按显存挑量化版本（24G Q8、16G Q5、更小 Q4），国内走镜像");

  // ---- 下载：断点续传、失败重试 ----
  fake.st.files["a.bin"] = Buffer.from(Array.from({ length: 8000 }, (_, i) => i & 255));
  const fake2 = await FAKE.start({ cutFirst: true, files: { "a.bin": fake.st.files["a.bin"] } });
  const dest = path.join(tmp, "dl", "a.bin");
  const e2 = E.create({ hf: [fake2.url] });
  await e2.download([`${fake2.url}/x/resolve/main/a.bin`], dest);
  assert.deepEqual(fs.readFileSync(dest), fake.st.files["a.bin"]); assert.ok(fake2.st.rangeAsked.includes(4000)); assert.equal(fs.existsSync(dest + ".part"), false);
  fake2.st.failNext = 2;
  await e2.download([`${fake2.url}/x/resolve/main/a.bin`], dest + "2");
  assert.equal(fs.statSync(dest + "2").size, 8000);
  fake2.close();
  ok("下载：断了从断的地方接着下（不从头来），服务器出错会重试");

  // 下一个功能要的全部模型
  const files = {};
  const prog = [];
  await eng.fetchModels(rt, "portrait", files, 16, (m) => prog.push(m));
  c = await eng.check(rt, files);
  assert.equal(c.feat.portrait.missing.length, 0); assert.equal(files.qwenEdit.name, W.MODELS.qwenEdit.name);
  assert.ok(fs.existsSync(path.join(rt.models, "diffusion_models", W.MODELS.qwenEdit.name)));
  ok("下载一个功能要的所有模型，放到 ComfyUI/models 对应的文件夹");

  // ---- 装插件（zip 用整合包的 Python 解压；这里用系统的 Python 代替）----
  let havePy = true; try { execFileSync(PY, ["-c", "print(1)"]); } catch (e) { havePy = false; }
  if (havePy) {
    const rt2 = { ...rt, python: PY };
    for (const p of W.NODE_PACKS) {
      const zdir = path.join(tmp, "z-" + p.dir);
      execFileSync(PY, ["-c", "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w');z.writestr(sys.argv[2]+'/__init__.py','NODE_CLASS_MAPPINGS={}')\nz.close()", zdir + ".zip", p.dir + "-" + p.commit]);
      fake.st.files[p.commit] = fs.readFileSync(zdir + ".zip");
    }
    await eng.installPacks(rt2, "talk");
    for (const p of W.NODE_PACKS) {
      assert.ok(fs.existsSync(path.join(rt.nodes, p.dir, "__init__.py")), p.dir);
      assert.equal(fs.readFileSync(path.join(rt.nodes, p.dir, ".laolao-commit"), "utf8"), p.commit);
    }
    c = await eng.check(rt, files);
    assert.deepEqual(c.feat.talk.packs, []);
    ok("装插件：下固定版本的 zip，解压到 custom_nodes，记下版本（装过的不重复装）");
  } else console.log("（没有 Python，跳过装插件的测试）");

  // ---- 跑工作流 ----
  const img = path.join(tmp, "photo.png"); fs.writeFileSync(img, "PNG");
  const name = await eng.upload(img, "laolao-photo.png");
  assert.equal(name, "laolao-photo.png"); assert.ok(fake.st.uploads["laolao-photo.png"] > 0);
  const g = W.portrait({ photo: name, batch: 2 }, (k) => (files[k] && files[k].name) || W.MODELS[k].name);
  const msgs = [];
  const out = await eng.run("画形象", g, path.join(tmp, "out"), (m) => msgs.push(m));
  assert.equal(out.length, 2); assert.equal(fs.readFileSync(out[0], "utf8"), "FILE:portrait_0.png");
  assert.ok(msgs.some((m) => m.stage === "queued")); assert.ok(msgs.some((m) => m.value === 2 && m.max === 4 && m.node === "UNETLoader"));
  ok("跑工作流：上传照片、交任务、收进度（WebSocket）、取回结果文件");

  const v = await eng.run("说话视频", W.talk({ image: name, audio: "a.wav", seconds: 3 }, (k) => W.MODELS[k].name), path.join(tmp, "out2"));
  assert.ok(v[0].endsWith("talk_00001.mp4"));
  ok("说话视频的结果（VideoHelperSuite 的 gifs 输出）也能取回");

  // 出错：显存不够要说人话
  fake.st.fail = "CUDA error: out of memory";
  await assert.rejects(eng.run("画形象", g, path.join(tmp, "out3")), /显卡内存不够/);
  fake.st.fail = "something broke";
  await assert.rejects(eng.run("画形象", g, path.join(tmp, "out3")), /AI 引擎出错（KSampler）：something broke/);
  fake.st.fail = null;
  ok("出错：显存不够、其他错误都告诉老师是哪一步");

  // 缺节点：不交给 ComfyUI，直接说缺什么
  const fake3 = await FAKE.start({ noPacks: true });
  const e3 = E.create({ poll: 30 }); await e3.attach(fake3.url);
  await assert.rejects(e3.run("说话视频", W.talk({ image: "a.png", audio: "a.wav", seconds: 1 }, (k) => W.MODELS[k].name), tmp), /缺这些节点：.*WanVideo/);
  fake3.close();
  ok("ComfyUI 里缺插件：先说缺什么，不白跑");

  // 停止
  const fake4 = await FAKE.start({ delay: 5000 });
  const e4 = E.create({ poll: 30 }); await e4.attach(fake4.url);
  const p = e4.run("画形象", g, path.join(tmp, "out4"));
  p.catch(() => {});   // 停的时候它可能比下面的 assert.rejects 先失败：先挂上处理，免得「没人接的失败」把测试进程弄崩（Windows 上常见）
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(e4.status().job.kind, "画形象");
  await assert.rejects(e4.run("画形象", g, tmp), /还没做完/);
  await e4.cancel();
  await assert.rejects(p, /停了/);
  assert.equal(fake4.st.interrupted, 1); assert.equal(fake4.st.deleted.length, 1); assert.equal(e4.status().job, null);
  fake4.close();
  ok("一次只做一件；能停（ComfyUI 那边也取消）");

  fake.close();
  console.log("本机 AI 引擎：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
