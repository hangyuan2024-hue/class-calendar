// Q版每日一轮：
//   · 到点收尾（until）：不管画了多少，到 04:30 就收尾，后面的训练接着开始
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
  const writePlan = (minPairs) => fs.writeFileSync(pf, JSON.stringify({ ...plan, publish: { ...plan.publish, metrics: plan.publish.metrics.map((m) => ({ ...m, min: 0 })) }, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", path.basename(s.recipeFile)),
    params: s.key === "gen" ? { ...s.params, count: 200, clipBases: [clipBase] } : { ...s.params, minPairs, epochs: 60 } })) }));
  writePlan(3);
  await Tools.cycle(admin, pf);
  const C = app.cycle, db = app.core.db;
  assert.equal(new Date(C.nextAt("04:30", now)).toISOString(), "2026-11-13T20:30:00.000Z", "北京时间第二天 04:30");

  big.start(); small.start();
  now = Date.parse("2026-11-13T11:00:00Z"); C.tick();   // 19:00
  const run1 = C.view().pipelines[0].runs[0];
  assert.ok(run1, "到点开了一轮");
  const gen = db.prepare("select * from jobs where run_id=? and params like '%\"stageKey\":\"gen\"%'").get(run1.id);
  assert.equal(JSON.parse(gen.params).deadline, Date.parse("2026-11-13T20:30:00Z"));

  // 画了几个，审核几条（大家白天审核）
  await until(() => db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(gen.id).n >= 4, "画 4 个");
  assert.equal(db.prepare("select count(*) as n from tasks where job_id=? and device_id=(select id from devices where name='小显卡')").get(gen.id).n, 0, "小显卡的电脑不领画图的任务");
  assert.equal(graphs[0]["20"].class_type, "TextEncodeQwenImageEditPlus"); assert.ok(!graphs[0]["20"].inputs.image1, "先画照片（不带图）");
  assert.deepEqual(graphs[1]["20"].inputs.image1, ["11", 0], "再把照片变成 Q版");
  assert.equal(graphs[1]["5"].inputs.lora_name, "f.safetensors", "用这台电脑上的模型文件名");
  ok("只有装好 AI 引擎的电脑领画图的任务；配方先画虚拟老师的照片，再变成 Q版（和老师端一样的节点图）");

  const rv = await big.api("/api/review/next");
  assert.ok(rv.item && rv.item.payload.refUrl && rv.item.payload.aUrl && rv.item.payload.bUrl, "审核带参考照片");
  assert.ok(!("meta" in rv.item.payload), "训练用的特征不给审核界面");
  assert.equal(rv.item.payload.tag, "qv1");
  let voted = 0;
  for (;;) {
    const r = await small.api("/api/review/next"); if (!r.item) break;
    await small.api("/api/review/vote", { review: r.item.id, choice: voted % 3 === 2 ? "b" : "a" }); voted++;
  }
  assert.ok(voted >= 4);
  ok(`审核：左边参考照片、中间和右边两张 Q版；投了 ${voted} 票`);

  // 到点收尾：没人领的不画了，正在画的画完；训练接着开始
  now = Date.parse("2026-11-13T20:31:00Z"); C.tick();
  await until(() => { C.tick(); return db.prepare("select state from jobs where id=?").get(gen.id).state === "done"; }, "画图收尾");
  const g2 = db.prepare("select * from jobs where id=?").get(gen.id);
  const dropped = db.prepare("select count(*) as n from tasks where job_id=? and state='dropped'").get(gen.id).n;
  assert.ok(dropped > 100, "没人领的不画了"); assert.equal(g2.total, g2.done, "进度算成 100%");
  ok(`到 04:30 收尾：画了 ${g2.done} 个，剩下 ${dropped} 个不画了；不用先测每台电脑多快`);

  await until(() => db.prepare("select state from runs where id=?").get(run1.id).state === "done", "第 1 轮做完", 30000).catch((e) => { console.log(db.prepare("select id,name,state,deps from jobs").all(), db.prepare("select job_id,state,error from tasks where state!='dropped' and job_id>1").all(), db.prepare("select msg from events order by id desc limit 8").all()); throw e; });
  let models = C.view().models;
  assert.equal(models[0].name, "qversion-scorer"); assert.equal(models[0].version, 1); assert.equal(models[0].state, "released");
  const m1 = await (await fetch(url + "/pub/models/manifest.json")).json();
  const sf = Buffer.from(await (await fetch(m1.models["qversion-scorer"].files[0].url)).arrayBuffer());
  const head = JSON.parse(sf.subarray(8, 8 + Number(sf.readBigUInt64LE(0))).toString());
  assert.equal(head.__metadata__.format, "laolao-qversion-scorer-1"); assert.deepEqual(head.v.shape, [1536, 1]);
  ok(`接着训练打分模型（用今天的审核），第 1 版发布（考题答对 ${models[0].metrics.acc}）；文件是标准的 safetensors`);

  // 第 2 天：审核不够（要求 1000 对）→ 跳过，不算失败；老师端继续用第 1 版
  writePlan(1000); await Tools.cycle(admin, pf);
  now = Date.parse("2026-11-14T11:00:00Z"); C.tick();
  const run2 = C.view().pipelines[0].runs[0];
  await until(() => db.prepare("select count(*) as n from tasks t join jobs j on j.id=t.job_id where j.run_id=? and t.state='done'").get(run2.id).n >= 1, "第 2 天画 1 个");
  now = Date.parse("2026-11-14T20:31:00Z");
  await until(() => { C.tick(); return db.prepare("select state from runs where id=?").get(run2.id).state !== "running"; }, "第 2 轮做完");
  assert.equal(db.prepare("select state from runs where id=?").get(run2.id).state, "done");
  assert.equal(C.view().models.length, 1, "没出新版");
  assert.ok(app.core.db.prepare("select msg from events where msg like '%没出新版%'").get(), "动态里说了为什么");
  ok("审核结果不够：这一轮不出新版，也不算失败");

  // 同一份考题比：新的不如现在的 → 不发布（vs）
  const g = C.better({ metrics: [{ k: "acc", better: "higher", vs: "base_acc" }] }, { metrics: JSON.stringify({ acc: 0.5 }) }, { acc: 0.6, base_acc: 0.7 });
  assert.equal(g.ok, false);
  assert.equal(C.better({ metrics: [{ k: "acc", better: "higher", vs: "base_acc" }] }, { metrics: JSON.stringify({ acc: 0.9 }) }, { acc: 0.6, base_acc: 0.55 }).ok, true, "昨天的分数高也没关系：今天的考题更难");
  assert.equal(C.better(plan.publish, null, { acc: 0.5 }).ok, false, "第一版也要过及格线");
  assert.equal(C.better(plan.publish, null, { acc: 0.6 }).ok, true);
  ok("和现在的那一版在同一份考题上比（每天考题变多，不和昨天的分数比）；第一版也要过及格线（比瞎猜好）");

  // 一个都没画成：这一轮失败
  now = Date.parse("2026-11-15T11:00:00Z"); big.stop(); small.stop(); await sleep(300); C.tick();
  const run3 = C.view().pipelines[0].runs[0];
  now = Date.parse("2026-11-15T20:31:00Z"); C.tick();
  assert.equal(db.prepare("select state from runs where id=?").get(run3.id).state, "failed");
  ok("到点了一个都没画成：这一轮算失败，老师端继续用现在的");

  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Q版每日一轮：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
