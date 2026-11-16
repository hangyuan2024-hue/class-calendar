// 内存和显存、硬盘清理：24 小时开着的电脑不越用越满
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Mem = require("../app/mem");
const Disk = require("../app/disk");
const ok = (m) => console.log("✓", m);

(async () => {
  // 1. 挑后台残留：数据文件夹里的、不是捞捞子孙的、上级已经没了的；用户自己开的（上级还活着）不碰
  {
    const base = path.resolve("/data/LaolaoGrid");
    const P = (pid, ppid, exe, cmd) => ({ pid, ppid, exe, cmd: cmd || "" });
    const procs = [P(1, 0, "/sbin/init"), P(100, 1, "/app/electron"), P(101, 100, base + "/env/python"), P(102, 101, base + "/ai/py/python"),
      P(200, 999, base + "/ai/gsv/runtime/python"), P(201, 200, base + "/ai/gsv/runtime/python"),
      P(50, 1, "/usr/bin/bash"), P(300, 50, base + "/ai/gsv/runtime/python"), P(500, 777, "/other/python"), P(600, 888, base + "/update/LaolaoGrid-Setup.exe")];
    const got = Mem.pickOrphans(procs, { root: 100, base, skip: [base + "/update"] }).map((p) => p.pid).sort();
    assert.deepStrictEqual(got, [200, 201]);
    ok("后台残留：只收数据文件夹里、上级已经没了的（连同它的子程序）；捞捞正在用的、你自己打开的、正在装的新版本、别的程序都不碰");
  }

  // 2. 真的收：开一个「残留」（父程序退出了，自己还在跑）
  if (process.platform !== "win32") {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lg-mem-"));
    const script = path.join(base, "ai", "left.py");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "import time\ntime.sleep(120)\n");
    // 用 sh 开它再让 sh 退出：它就成了没有上级的残留（Linux 上会过继给 1 号）
    const sh = spawn("sh", ["-c", `python3 ${script} & echo $!`], { detached: true });
    const pid = await new Promise((r) => sh.stdout.on("data", (d) => r(+String(d).trim())));
    await new Promise((r) => sh.on("exit", r));
    await new Promise((r) => setTimeout(r, 300));
    const logs = [];
    const m = Mem.create({ base: () => base, log: (x) => logs.push(x), root: process.pid });
    const n = await m.sweep("测试");
    await new Promise((r) => setTimeout(r, 300));
    let alive = true; try { process.kill(pid, 0); alive = !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); } catch (e) { alive = false; }   // 僵尸（等上级回收）也算结束了
    // 容器里 1 号进程有时不是 init（会被别的进程收养）：只要收到了就算
    if (n) { assert.ok(!alive, "残留应该被收掉"); ok("真的收：没有上级的残留程序被结束了"); }
    else { try { process.kill(pid, "SIGKILL"); } catch (e) {} ok("真的收：这个环境里残留被别的进程收养了（跳过）"); }
    fs.rmSync(base, { recursive: true, force: true });
  }

  // 3. 任务开始前：用不上的引擎关掉；画图引擎开久了重启；内存紧张先收残留；多显卡的其它显卡不动共用引擎
  {
    const ev = [];
    let aiRun = true, since = Date.now() - 7 * 3600e3, llmRun = true, free = 8e9;
    const ai = { status: () => ({ running: aiRun }), stop: async () => { aiRun = false; ev.push("ai.stop"); }, runningSince: () => since };
    const llm = { running: () => llmRun, stop: () => { llmRun = false; ev.push("llm.stop"); } };
    const swept = [];
    const m = Mem.create({ base: () => "/x", ai, llm, set: () => ({}), log: () => {}, memNow: () => ({ free, total: 16e9 }), listProcs: async () => { swept.push(1); return []; } });
    await m.beforeTask({ needs: ["gsv"] });
    assert.deepStrictEqual(ev, ["ai.stop", "llm.stop"]);
    ev.length = 0; aiRun = true; llmRun = true;
    await m.beforeTask({ needs: ["comfy"] });
    assert.deepStrictEqual(ev, ["llm.stop", "ai.stop"], "画图任务：大模型关掉；画图引擎开了 7 小时 → 重启");
    ev.length = 0; aiRun = true; since = Date.now() - 600e3;
    await m.beforeTask({ needs: ["comfy"] });
    assert.deepStrictEqual(ev, [], "刚开不久的画图引擎接着用");
    aiRun = true; llmRun = true;
    await m.beforeTask({ needs: [], lane: 1 });
    assert.deepStrictEqual(ev, [], "其它显卡的任务不动共用的引擎");
    free = 1e9; swept.length = 0;
    await m.beforeTask({ needs: ["comfy"] });
    assert.ok(swept.length, "内存紧张：先收一遍后台残留");
    ok("任务开始前：用不上的引擎关掉；画图引擎开了 6 小时以上在两个任务之间重启；内存紧张先收残留；其它显卡不动共用引擎");

    // 现在释放：正在用的不关
    aiRun = true; llmRun = true; ev.length = 0;
    const m2 = Mem.create({ base: () => "/x", ai, llm, set: () => ({}), log: () => {}, busy: () => ["comfy"], settleMs: 0, listProcs: async () => [] });
    const r = await m2.freeNow();
    assert.deepStrictEqual(r.stopped, ["本地大模型"]);
    ok("「现在释放内存」：没在用的引擎关掉，正在画图的画图引擎不动");
  }

  // 4. 硬盘：换盘前的旧数据只删训练环境、模型、任务文件，软件自己的设置留着
  {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "lg-disk-"));
    for (const x of ["env/a", "ai/b", "work/c", "Local Storage/d"]) { fs.mkdirSync(path.join(d, path.dirname(x)), { recursive: true }); fs.writeFileSync(path.join(d, x), Buffer.alloc(1000)); }
    fs.writeFileSync(path.join(d, "grid.json"), "{}");
    const disk = Disk.create({ base: () => d, parts: () => [{ id: "oldbase", name: "旧", path: d, only: ["env", "ai", "work", "llm", "update"], cleanable: "all" }] });
    const rep = await disk.report();
    assert.strictEqual(rep.parts[0].bytes, 3000);
    const r = await disk.clean("oldbase");
    assert.strictEqual(r.freed, 3000);
    assert.ok(fs.existsSync(path.join(d, "grid.json")) && fs.existsSync(path.join(d, "Local Storage", "d")) && !fs.existsSync(path.join(d, "env")));
    fs.rmSync(d, { recursive: true, force: true });
    ok("换盘前留在 C 盘的旧数据：只删训练环境、模型、任务文件，软件自己的设置留着");
  }
  // 5. 把数据文件夹整个搬到别的盘：装好的一起搬、记着的路径跟着改、原来的删掉
  {
    const { createService } = require("../app/service");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-move-"));
    const me = path.join(tmp, "me");
    for (const x of ["env/py/python.txt", "ai/ComfyUI_windows_portable/main.py", "llm/m.gguf", "work/cache/inputs/a.bin"]) { fs.mkdirSync(path.join(me, path.dirname(x)), { recursive: true }); fs.writeFileSync(path.join(me, x), Buffer.alloc(2000)); }
    fs.writeFileSync(path.join(me, "grid.json"), JSON.stringify({ ai: { dir: path.join(me, "ai", "ComfyUI_windows_portable"), ready: false }, gsv: { dir: path.join(me, "ai", "gsv") } }));
    const svc = createService({ user: me, version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, moveSettleMs: 0 });
    const r = await svc.H.moveDataDir(path.join(tmp, "D"));
    const to = path.join(tmp, "D", "LaolaoGrid");
    assert.strictEqual(r.to, to);
    for (const x of ["env/py/python.txt", "ai/ComfyUI_windows_portable/main.py", "llm/m.gguf", "work/cache/inputs/a.bin"]) assert.ok(fs.existsSync(path.join(to, x)), "搬过去了：" + x);
    for (const x of ["env", "ai", "llm", "work"]) assert.ok(!fs.existsSync(path.join(me, x)), "原来的删掉了：" + x);
    const cfg = JSON.parse(fs.readFileSync(path.join(me, "grid.json"), "utf8"));
    assert.strictEqual(cfg.dataDir, to);
    assert.strictEqual(cfg.ai.dir, path.join(to, "ai", "ComfyUI_windows_portable"));
    assert.strictEqual(cfg.gsv.dir, path.join(to, "ai", "gsv"));
    await assert.rejects(() => svc.H.moveDataDir(path.join(to, "sub")), /里面|已经/);
    ok("把数据文件夹搬到别的盘：训练环境、AI 引擎和模型、本地大模型、任务文件一起搬，记着的路径跟着改，原来的删掉（不用重新下几十 G）");
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  // 6. 第一次用：数据文件夹自动放到空间最大的非系统盘；已经装过东西的不动；留在 C 盘的旧缓存列出来可以删
  {
    const { createService } = require("../app/service");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-auto-"));
    const D = path.join(tmp, "D"), E2 = path.join(tmp, "E"); fs.mkdirSync(D); fs.mkdirSync(E2);
    const drives = () => [{ root: D, free: 80e9 }, { root: E2, free: 228e9 }];
    const me = path.join(tmp, "me");
    createService({ user: me, version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, drives });
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(me, "grid.json"), "utf8")).dataDir, path.join(E2, "LaolaoGrid"));
    const old = path.join(tmp, "old"); fs.mkdirSync(path.join(old, "env"), { recursive: true });
    createService({ user: old, version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, drives });
    assert.ok(!fs.existsSync(path.join(old, "grid.json")) || !JSON.parse(fs.readFileSync(path.join(old, "grid.json"), "utf8")).dataDir);
    const small = path.join(tmp, "small");
    createService({ user: small, version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, drives: () => [{ root: D, free: 20e9 }] });
    assert.ok(!fs.existsSync(path.join(small, "grid.json")) || !JSON.parse(fs.readFileSync(path.join(small, "grid.json"), "utf8")).dataDir);
    ok("第一次用：数据文件夹自动放到空间最大的非系统盘（不放 C 盘）；已经装过的不动；别的盘都不到 60G 就还放原处");
    const hc = path.join(tmp, "home", ".cache", "huggingface"); fs.mkdirSync(hc, { recursive: true }); fs.writeFileSync(path.join(hc, "m.bin"), Buffer.alloc(5000));
    const svc = createService({ user: path.join(tmp, "u2"), version: "t", python: "python3", send: () => {}, detectRegion: false, noMemTimers: true, autoDrive: false, homeCaches: () => [{ name: "HuggingFace 模型", path: hc }] });
    const rep = await svc.H.diskReport();
    const part = rep.parts.find((x) => /留在 C 盘的旧缓存/.test(x.name));
    assert.ok(part && part.bytes === 5000, JSON.stringify(rep.parts.map((x) => [x.id, x.bytes])));
    await svc.H.diskCleanAll();
    assert.ok(fs.existsSync(path.join(hc, "m.bin")), "一键清理不碰");
    await svc.H.diskClean(part.id);
    assert.ok(!fs.existsSync(path.join(hc, "m.bin")));
    ok("旧版本留在 C 盘用户文件夹里的模型缓存：硬盘页列出来、能单独删（一键清理和自动清理不碰）");
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log("内存和硬盘：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
