// Q版自动训练（不定时间）：
//   · 设好就一直有画图的活，谁开着谁画，快领完了自动补；新审核攒够了就训练一次（离上次至少隔一会儿）
//   · 只有装好 AI 引擎的电脑领画图的任务；配方通过 lg.comfy() 让本机 ComfyUI 画图（这里用假的 ComfyUI）
//   · 审核带参考照片，训练用的特征不给审核界面；训练只拿到审核好了的
//   · 打分模型：第一版发布；审核不够就跳过（不算失败）；和现在的那一版在同一份考题上比
//   · AI 引擎模块（app/ai.js）：装、认已有的文件夹、只能用任务文件夹里的文件、插件放进 loras/laolao
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const Server = require("../server");
const Agent = require("../worker/agent");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-qv-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
process.env.PYTHONPATH = path.join(__dirname, "shim") + path.delimiter + (process.env.PYTHONPATH || "");   // 假的 torch / transformers
const Tools = require("../tools/grid");
const AI = require("../app/ai");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };

(async () => {
  // ---------- app/ai.js（假的 ComfyUI 引擎）----------
  {
    const d = path.join(tmp, "ai"), calls = [];
    let state = {};
    const comfyDir = path.join(d, "LaolaoAI-ComfyUI", "ComfyUI_windows_portable");
    const fakeEngine = {
      inspect: (dir) => (fs.existsSync(path.join(dir, "ok")) ? { ok: true, dir, comfy: dir, python: "py", models: path.join(dir, "models"), nodes: path.join(dir, "nodes") } : { ok: false, error: "这个文件夹里没有 ComfyUI" }),
    };
    let running = false;
    const eng = {
      status: () => ({ running, vram: { gb: 8 }, version: "0.9", job: null }),
      check: async () => ({ coreMissing: [], feat: { portrait: { missing: Object.keys(state.files || {}).length ? [] : ["qwenEdit"], bytes: 1 } } }),
      fetchModels: async (rt, f, files, vram, onMsg) => { calls.push("models:" + vram); onMsg({ name: "x", got: 1, total: 2 }); files.qwenEdit = { name: "qwen.safetensors", size: 1 }; return files; },
      start: async (rt, o) => { calls.push("start:" + o.port + (o.lowvram ? ":low" : "")); running = true; },
      stop: () => { calls.push("stop"); running = false; },
      upload: async (f, as) => as || path.basename(f),
      run: async (kind, g, out) => { fs.mkdirSync(out, { recursive: true }); const f = path.join(out, "a.png"); fs.writeFileSync(f, "x"); return [f]; },
      cancel: async () => true,
    };
    const ai = AI.create({ engine: fakeEngine, eng, workflows: { NEEDS: { portrait: ["qwenEdit"] }, MODELS: { qwenEdit: { name: "q.safetensors", size: 1 } } }, mirror: {},
      installer: { install: async (kind, parent) => { calls.push("pkg:" + kind); fs.mkdirSync(comfyDir, { recursive: true }); fs.writeFileSync(path.join(comfyDir, "ok"), ""); return { dir: comfyDir, ver: "v1" }; } },
      get: () => state, set: (v) => { state = v; }, vram: () => 8 });
    await assert.rejects(ai.ensure(), /还没装好 AI 引擎/);
    const r = await ai.install(d);
    assert.ok(r.ready, "装好了"); assert.deepEqual(calls, ["pkg:comfyui", "models:8", `start:${AI.PORT}:low`, "stop"]);
    calls.length = 0; await ai.install(d); assert.ok(!calls.includes("pkg:comfyui"), "装过的整合包不再装");
    const task = path.join(tmp, "task1"); fs.mkdirSync(task); fs.writeFileSync(path.join(task, "l.safetensors"), "abc");
    assert.equal((await ai.call("info", {}, { dir: task })).models.qwenEdit, "qwen.safetensors");
    await assert.rejects(ai.call("upload", { path: path.join(tmp, "..", "etc-passwd") }, { dir: task }), /只能用任务文件夹里的文件/);
    assert.equal((await ai.call("lora", { path: path.join(task, "l.safetensors"), name: "qv 1.safetensors" }, { dir: task })).name, "laolao/qv_1.safetensors");
    assert.ok(fs.existsSync(path.join(comfyDir, "models", "loras", "laolao", "qv_1.safetensors")));
    assert.equal((await ai.call("upload", { path: path.join(task, "l.safetensors"), as: "photo.png" }, { dir: task })).name, "lg-photo.png");
    fs.mkdirSync(path.join(comfyDir, "input"), { recursive: true }); fs.writeFileSync(path.join(comfyDir, "input", "lg-photo.png"), "x");
    fs.mkdirSync(path.join(comfyDir, "output", "laolao-grid"), { recursive: true }); fs.writeFileSync(path.join(comfyDir, "output", "laolao-grid", "q.png"), "x");
    assert.equal((await ai.call("run", { graph: { 1: {} } }, { dir: task })).files.length, 1);
    assert.ok(fs.existsSync(path.join(comfyDir, "input", "lg-photo.png")), "任务里传的图，任务做完前不删");
    assert.ok(!fs.existsSync(path.join(comfyDir, "output", "laolao-grid", "q.png")), "画完交了的图清掉");
    await ai.ensure(); assert.ok(!fs.existsSync(path.join(comfyDir, "input", "lg-photo.png")), "下一个任务开始前清掉上一个的");
    await assert.rejects(ai.useDir(path.join(tmp, "nothing")), /没有 ComfyUI/);
    ai.stop();
    ok("AI 引擎：一键装（整合包 → 模型 → 启动核对 → 关掉）、装过的不再装、只能用任务文件夹里的文件、插件放进 loras/laolao、用过的图清掉不占硬盘");
  }

  // ---------- 调度中心 + 两台电脑（一台装了 AI 引擎，一台显卡小）----------
  let now = Date.parse("2026-11-13T10:00:00Z");   // 北京时间 18:00
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 3000, noTick: true, clock: () => now });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 5, server: url });

  // 假的 ComfyUI：每次「画」一张不同颜色的图（像真的一样慢一点）
  const pngs = path.join(tmp, "pngs");
  execFileSync(PY, ["-c", `import sys\nfrom PIL import Image\nfor i in range(40): Image.new("RGB",(64,112),((i*53)%256,(i*97)%256,(i*31)%256)).save(sys.argv[1]+"/%d.png"%i)`, (fs.mkdirSync(pngs), pngs)]);
  let drawn = 0;
  const graphs = [];
  const fakeComfy = {
    ensure: async () => ({ running: true }),
    call: async (op, a, ctx) => {
      if (op === "info") return { models: { qwenEdit: "q.safetensors", qwenClip: "c.safetensors", qwenVae: "v.safetensors", qwenFast: "f.safetensors" }, vram: 8 };
      if (op === "upload") { assert.ok(a.path.startsWith(ctx.dir), "只传任务文件夹里的"); return { name: a.as || path.basename(a.path) }; }
      if (op === "run") {
        if (fakeComfy.broken) throw new Error("显卡内存不够");
        graphs.push(a.graph);
        await sleep(150);
        const out = path.join(ctx.dir, "comfy-" + drawn); fs.mkdirSync(out, { recursive: true });
        const f = path.join(out, "o.png"); fs.copyFileSync(path.join(pngs, (drawn++ % 40) + ".png"), f);
        return { files: [f] };
      }
      throw new Error("没有 " + op);
    },
    abort: async () => {}, stop: () => {},
  };
  const big = Agent.create({ ...(await Agent.join(inv.link, "张三", { name: "大显卡" }).then((j) => ({ token: j.token, pubkey: j.pubkey }))), server: url, workDir: path.join(tmp, "w-big"), python: PY, caps: { vram: 8, comfy: true }, comfy: fakeComfy, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300 });
  const small = Agent.create({ ...(await Agent.join(inv.link, "李四", { name: "小显卡" }).then((j) => ({ token: j.token, pubkey: j.pubkey }))), server: url, workDir: path.join(tmp, "w-small"), python: PY, caps: { vram: 6 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300 });

  // CLIP 的文件（假的），用 file:// 地址「下载」
  const clip = path.join(tmp, "clip"); fs.mkdirSync(clip);
  for (const f of ["config.json", "preprocessor_config.json", "model.safetensors"]) fs.writeFileSync(path.join(clip, f), "{}");
  const clipBase = "file://" + (process.platform === "win32" ? "/" : "") + clip.replace(/\\/g, "/") + "/";
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "qversion.json"), "utf8"));
  const pf = path.join(tmp, "qv.json");
  const writePlan = (o = {}) => fs.writeFileSync(pf, JSON.stringify({ ...plan, publish: { ...plan.publish, metrics: plan.publish.metrics.map((m) => ({ ...m, min: 0 })) }, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)),
    ...(s.key === "gen" ? { keep: 6, params: { ...s.params, clipBases: [clipBase], ...(o.gen || {}) } } : { when: { ...s.when, reviews: 4, minHours: 1 }, params: { ...s.params, minPairs: o.minPairs || 3, epochs: 60 } }) })) }));
  writePlan();
  await Tools.cycle(admin, pf);
  const C = app.cycle, db = app.core.db;
  assert.equal(new Date(C.nextAt("04:30", now)).toISOString(), "2026-11-13T20:30:00.000Z", "北京时间第二天 04:30");
  const genJob = () => db.prepare("select * from jobs where params like '%\"stageKey\":\"gen\"%' and state!='done' order by id desc limit 1").get();
  const doneOf = (id) => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(id).n;

  // 不定时间：设好就有活，谁开着谁画
  C.tick();
  const gen = genJob();
  assert.ok(gen, "设好就有画图的活"); assert.equal(gen.total, 6);
  assert.equal(C.view().pipelines[0].runs.length, 0, "还没攒够审核，不训练");
  big.start(); small.start();
  await until(() => doneOf(gen.id) >= 4, "画 4 个");
  C.tick();
  assert.ok(db.prepare("select total from jobs where id=?").get(gen.id).total > 6, "快领完了自动补一批");
  assert.equal(db.prepare("select count(*) as n from tasks where job_id=? and device_id=(select id from devices where name='小显卡')").get(gen.id).n, 0, "小显卡的电脑不领画图的任务");
  assert.equal(graphs[0]["20"].class_type, "TextEncodeQwenImageEditPlus"); assert.ok(!graphs[0]["20"].inputs.image1, "先画照片（不带图）");
  assert.deepEqual(graphs[1]["20"].inputs.image1, ["11", 0], "再把照片变成 Q版");
  assert.equal(graphs[1]["5"].inputs.lora_name, "f.safetensors", "用这台电脑上的模型文件名");
  ok("不定时间：设好就有活，开着 AI 引擎的电脑就画，快领完了自动补；小显卡的电脑不领画图的；节点图和老师端一样");

  const rv = await big.api("/api/review/next");
  assert.ok(rv.item && rv.item.payload.refUrl && rv.item.payload.aUrl && rv.item.payload.bUrl, "审核带参考照片");
  assert.ok(!("meta" in rv.item.payload), "训练用的特征不给审核界面");
  assert.equal(rv.item.payload.tag, "qv1");
  let voted = 0;
  const voteAll = async () => { let n = 0; for (;;) { const r = await small.api("/api/review/next"); if (!r.item) return n; await small.api("/api/review/vote", { review: r.item.id, choice: voted % 3 === 2 ? "b" : "a" }); voted++; n++; } };
  await voteAll();
  assert.ok(voted >= 4);
  ok(`审核：左边参考照片、中间和右边两张 Q版；投了 ${voted} 票`);

  // 审核攒够了 → 开一轮训练（画图不停）
  C.tick();
  const run1 = C.view().pipelines[0].runs[0];
  assert.ok(run1 && run1.state === "running", "攒够了就训练");
  await until(() => db.prepare("select state from runs where id=?").get(run1.id).state === "done", "第 1 轮训练做完");
  let models = C.view().models;
  assert.equal(models[0].name, "qversion-scorer"); assert.equal(models[0].version, 1); assert.equal(models[0].state, "released");
  assert.equal(genJob().id, gen.id, "训练的时候画图照常");
  const m1 = await (await fetch(url + "/pub/models/manifest.json")).json();
  const sf = Buffer.from(await (await fetch(m1.models["qversion-scorer"].files[0].url)).arrayBuffer());
  const head = JSON.parse(sf.subarray(8, 8 + Number(sf.readBigUInt64LE(0))).toString());
  assert.equal(head.__metadata__.format, "laolao-qversion-scorer-1"); assert.deepEqual(head.v.shape, [1536, 1]);
  ok(`新审核攒够了就训练打分模型，第 1 版发布（考题答对 ${models[0].metrics.acc}）；文件是标准的 safetensors`);

  // 又攒够了，但离上次不到 1 小时 → 等一等；过了 1 小时再训练；审核不够训练的对数 → 跳过，不算失败
  writePlan({ minPairs: 1000 }); await Tools.cycle(admin, pf);
  await until(async () => { await voteAll(); return C.view().pipelines[0].when.fresh >= 4; }, "又攒 4 条审核");
  C.tick(); assert.equal(C.view().pipelines[0].runs.length, 1, "离上次不到 1 小时，先不训练");
  assert.equal(genJob().id, gen.id, "只改了训练的设置：画图的活不用换");
  now += 3601e3; C.tick();
  const run2 = C.view().pipelines[0].runs[0];
  assert.notEqual(run2.id, run1.id);
  await until(() => db.prepare("select state from runs where id=?").get(run2.id).state !== "running", "第 2 轮做完");
  assert.equal(db.prepare("select state from runs where id=?").get(run2.id).state, "done");
  assert.equal(C.view().models.length, 1, "没出新版");
  assert.ok(db.prepare("select msg from events where msg like '%没出新版%'").get(), "动态里说了为什么");
  ok("又攒够了：离上次至少隔 1 小时才训练；训练对数不够 → 这一轮不出新版，也不算失败");

  // 控制中心「现在训练一次」
  const r3 = await Tools.api(admin, "/api/admin/pipeline/run", { id: C.view().pipelines[0].id });
  await until(() => db.prepare("select state from runs where id=?").get(r3.run).state !== "running", "手动训练做完");
  ok("控制中心点「现在训练一次」：不用等");

  // 画图的配方设置改了 → 换成新的活，正在画的画完；新的一个都画不成（AI 引擎坏了）→ 停下，不一直空转
  fakeComfy.broken = true;
  writePlan({ gen: { cands: 4 } }); await Tools.cycle(admin, pf);
  C.tick();
  const gen2 = genJob();
  assert.notEqual(gen2.id, gen.id, "换成新的活");
  assert.equal(db.prepare("select count(*) as n from tasks where job_id=? and state='queued'").get(gen.id).n, 0, "旧的没人领的不做了");
  await until(() => { C.tick(); return db.prepare("select state from jobs where id=?").get(gen2.id).state === "paused"; }, "连着失败停下", 120000);
  assert.ok(db.prepare("select msg from events where msg like '%一个都没做成%'").get());
  ok("配方设置改了：换成新的活（正在画的画完）；连着 5 个都画不成 → 停下等你看出错信息");

  // 同一份考题比：新的不如现在的 → 不发布（vs）
  const g = C.better({ metrics: [{ k: "acc", better: "higher", vs: "base_acc" }] }, { metrics: JSON.stringify({ acc: 0.5 }) }, { acc: 0.6, base_acc: 0.7 });
  assert.equal(g.ok, false);
  assert.equal(C.better({ metrics: [{ k: "acc", better: "higher", vs: "base_acc" }] }, { metrics: JSON.stringify({ acc: 0.9 }) }, { acc: 0.6, base_acc: 0.55 }).ok, true, "以前的分数高也没关系：现在的考题更多");
  assert.equal(C.better(plan.publish, null, { acc: 0.5 }).ok, false, "第一版也要过及格线");
  assert.equal(C.better(plan.publish, null, { acc: 0.6 }).ok, true);
  ok("和现在的那一版在同一份考题上比（考题越攒越多，不和以前的分数比）；第一版也要过及格线（比瞎猜好）");

  big.stop(); small.stop();
  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Q版自动训练：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
