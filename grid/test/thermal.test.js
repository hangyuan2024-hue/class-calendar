// 散热不好的电脑：显卡快到温度上限时自动调训练密度（算一会儿歇一会儿），而不是一到上限就停、凉了又重新启动
"use strict";
process.removeAllListeners("warning");
process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Server = require("../server");
const Agent = require("../worker/agent");

const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-thermal-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + (typeof what === "function" ? what() : what)); await sleep(50); } };

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const join = (n) => Agent.join(inv.link, n, { name: n + "的电脑", info: { gpu: "RTX 4060", vram: 8 } });
  const tasksOf = async (id) => (await Tools.api(admin, "/api/admin/job?id=" + id, null, "GET")).tasks;
  const plan = async (name, src, count = 1, priority = 5) => {
    const rc = path.join(tmp, name + ".py"); fs.writeFileSync(rc, src);
    const pf = path.join(tmp, name + ".json"); fs.writeFileSync(pf, JSON.stringify({ jobs: [{ name, kind: "map", recipe: rc, params: { count }, priority }] }));
    return (await Tools.plan(admin, pf))[0];
  };
  const base = { python: PY, caps: { gpu: "RTX 4060", vram: 8, ram: 32 }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300, paceEveryMs: 150, heatStopMs: 1500, gpuApps: async () => [], policy: { maxTemp: 83 } };

  // ---------- 1. 配方照常用 lg.progress：温度压在上限下，任务一次算完，不停 ----------
  {
    // 一道题算 0.05 秒；配方完全不知道温度这回事
    const jobId = await plan("做题", "import lg, time\nt = lg.task()\nt0 = time.time()\nfor i in range(60):\n    time.sleep(0.05)\n    lg.progress((i + 1) / 60.0)\nlg.done(secs=time.time() - t0)\n");
    const cred = await join("甲");
    // 假显卡：密度越高越热（全速 86℃，比上限高），温度慢慢跟上去
    let temp = 70, duty = 1;
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"),
      gpuInfo: async () => { temp += ((68 + 18 * duty) - temp) * 0.5; return { temp: Math.round(temp) }; } });
    const logs = [], paces = [], dbg = []; let result = null;
    a.on("log", (l) => logs.push(l.msg)); a.on("pace", (p) => { duty = p.duty; paces.push(p.duty); dbg.push([Date.now() % 100000, p.duty, p.temp]); });
    a.on("task", () => dbg.push(["task", Date.now() % 100000])); a.on("done", (d) => { if (d.ok) result = d.result; });
    a.start();
    await until(() => result, 30000, "算完");
    await a.stop();
    assert.ok(!logs.some((m) => /^停下/.test(m)), "不该停：" + logs.filter((m) => /停下/.test(m)).join(" / "));
    assert.ok(paces.length && Math.min(...paces) < 1 && Math.min(...paces) >= 0.15, "密度调过：" + paces.join(","));
    assert.ok(logs.some((m) => /训练密度调到 \d+%/.test(m)), "日志里说了调到多少");
    assert.ok(result.secs > 60 * 0.05 * 1.15, "配方真的歇了：" + result.secs + " " + JSON.stringify(dbg));
    assert.ok((await tasksOf(jobId)).every((t) => t.state === "done"));
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, "a", "thermal.json"), "utf8"));
    assert.ok(saved.duty < 1);
    ok(`显卡全速会到 86℃：密度自动降到 ${Math.round(Math.min(...paces) * 100)}%，温度压在 83℃ 以下，任务一次算完（没有「停下 → 重新启动」）`);

    // 同一台电脑下一个任务：从记下的密度开始
    await plan("做题2", "import lg\nt = lg.task()\nlg.progress(1)\nlg.done(ok=1)\n");
    const b = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "a"), gpuInfo: async () => ({ temp: 60 }) });
    const lb = []; let done2 = false; b.on("log", (l) => lb.push(l.msg)); b.on("done", (d) => { if (d.ok) done2 = true; });
    b.start(); await until(() => done2, 20000, "第二个任务"); await b.stop();
    assert.ok(lb.some((m) => /上次在 \d+% 的训练密度下温度刚好/.test(m)), lb.join("\n"));
    ok("下一个任务直接从这台电脑合适的密度开始，凉快再慢慢加回全速");
  }

  // ---------- 2. 配方不会歇（自己跑外部程序）：压不住才停；停了要凉到上限下 8℃ 才再领 ----------
  {
    const jobId = await plan("外部程序", "import lg, time\nt = lg.task()\ntime.sleep(60)\nlg.done(ok=1)\n");
    const cred = await join("乙");
    let temp = 70;
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "b"), gpuInfo: async () => ({ temp }) });
    const logs = [], states = []; let n = 0;
    a.on("log", (l) => logs.push(l.msg)); a.on("state", (s) => states.push(s)); a.on("task", () => { n++; if (n === 1) setTimeout(() => (temp = 85), 300); });
    a.start();
    await until(() => logs.some((m) => /^停下：显卡 85℃，这个任务没法放慢/.test(m)), 15000, () => "压不住才停：" + logs.join("\n") + JSON.stringify(states.slice(-3)));
    temp = 80;
    await until(() => states.some((s) => /凉到 75℃ 再接着算/.test(s.why || "")), 5000, "等凉");
    await sleep(600);
    assert.strictEqual(n, 1, "80℃ 还不领（以前 82℃ 就又领回来）");
    temp = 74;
    await until(() => n >= 2, 5000, "凉了再领");
    await a.stop();
    ok("配方没法放慢、一直超温：过一会儿才停；停了等凉到 75℃ 再领，不会 82℃ 又领回来、马上又停");
    void jobId;
  }

  // ---------- 3. 比上限高 5℃：马上停 ----------
  {
    await plan("很热", "import lg, time\nt = lg.task()\nfor i in range(600):\n    time.sleep(0.05)\n    lg.progress(i / 600.0)\nlg.done(ok=1)\n");
    const cred = await join("丙");
    let temp = 70;
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "c"), gpuInfo: async () => ({ temp }) });
    const logs = []; let started = false;
    a.on("log", (l) => logs.push(l.msg)); a.on("task", () => (started = true));
    a.start();
    await until(() => started, 10000, "开始");
    await sleep(800);
    temp = 89;
    const t0 = Date.now();
    await until(() => logs.some((m) => /^停下：显卡 89℃，比上限 83℃ 高太多/.test(m)), 3000, "马上停");
    assert.ok(Date.now() - t0 < 1000);
    await a.stop();
    ok("比上限高 5℃ 以上：不等，马上停");
  }

  // ---------- 4. 睡眠模式：晚上照样算，但密度最多 50%、温度压到 70℃ ----------
  {
    const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const now = new Date(), from = hm(new Date(now - 60e3)), to = hm(new Date(+now + 3600e3));
    await plan("睡眠", "import lg, time, json, os\nt = lg.task()\nt0 = time.time()\nfor i in range(40):\n    time.sleep(0.05)\n    lg.progress((i + 1) / 40.0)\nlg.done(secs=time.time() - t0, d=json.load(open(os.environ['LG_PACE']))['duty'])\n", 1, 9);
    const cred = await join("丁2");
    let temp = 55, duty = 0.5;   // 配方一开始读到的就是睡眠模式的 50%
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "d"), policy: { maxTemp: 83, quiet: { on: true, from, to } },
      gpuInfo: async () => { temp += ((55 + 25 * duty) - temp) * 0.5; return { temp: Math.round(temp) }; } });
    const logs = []; let result = null, maxT = 0;
    a.on("log", (l) => logs.push(l.msg)); a.on("pace", (p) => { duty = Math.min(p.duty, 0.5); }); a.on("done", (d) => { if (d.ok) result = d.result; });
    a.on("gpu", (g) => { if (a.current()) maxT = Math.max(maxT, g.temp); });
    a.start();
    await until(() => result, 30000, "算完");
    await a.stop();
    assert.ok(result.d <= 0.5, "密度最多 50%：" + result.d);
    assert.ok(result.secs > 40 * 0.05 * 1.7, "真的慢下来了：" + result.secs);
    assert.ok(logs.some((m) => /现在是睡眠模式：密度最多 50%/.test(m)), logs.join("\n"));
    assert.ok(maxT <= 72, "温度压在 70℃ 附近：" + maxT);
    assert.strictEqual(a.quiet().maxTemp, 70);
    ok(`睡眠模式（${from}～${to}）：照样算完，密度最多 50%、显卡最高 ${maxT}℃（平时全速会到 80℃）`);
  }

  // ---------- 5. 慢电脑：做某类任务慢得不正常 → 第一次 1 小时内不再领这一类（连着慢才 3、6 小时），先做别的 ----------
  {
    const slowJob = await plan("慢训练", "import lg, sys\nt = lg.task()\nlg.unfit('这台电脑训练慢得不正常（每秒 12 字，正常是几百）：换别的电脑接着训')\nsys.exit(1)\n", 2, 9);
    const lightJob = await plan("轻活", "import lg\nt = lg.task()\nlg.done(ok=1)\n", 3, 8);
    const cred = await join("慢电脑");
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "e"), gpuInfo: async () => ({ temp: 50 }) });
    const logs = [], states = []; a.on("log", (l) => logs.push(l.msg)); a.on("state", (s) => states.push(s.why || ""));
    a.start();
    await until(async () => (await tasksOf(lightJob)).every((t) => t.state === "done"), 30000, () => "轻活做完：" + logs.join("\n"));
    await a.stop();
    const sl = await tasksOf(slowJob);
    assert.ok(sl.every((t) => !t.errors && t.state === "queued"), "慢的那类不记失败、留给别的电脑：" + JSON.stringify(sl.map((t) => [t.state, t.errors])));
    assert.strictEqual(logs.filter((m) => /^领到任务：「慢训练」/.test(m)).length, 1, "慢的那类只领了一次");
    assert.ok(logs.some((m) => /做「慢训练」太慢：1 小时内不再领这一类/.test(m)));
    assert.ok(!states.some((w) => /分钟后自动再试/.test(w)), "不是整台电脑歇着：轻活照样做");
    assert.deepStrictEqual(a.avoiding().map((x) => x.recipe), ["慢训练"]);
    ok("慢电脑做训练慢得不正常：这一类先歇 1 小时（连着慢才加长），不再派给它（只领了一次），3 个轻活照样做完；训练留给别的电脑");
  }

  // ---------- 6. 显存被别的程序占着：只是吃显存的那一类先不领（半小时），做题、搜题这些照样领，不是整台电脑歇着 ----------
  {
    const bigJob = await plan("训练大脑", "import lg, sys\nt = lg.task()\nlg.unfit('出错：显存不够：256 个字的讲解都放不下（别的程序占着显存）。关掉占显存的程序再算')\nsys.exit(1)\n", 2, 9);
    const lightJob = await plan("搜题", "import lg\nt = lg.task()\nlg.done(ok=1)\n", 3, 8);
    const cred = await join("显存被占的电脑");
    const a = Agent.create({ ...base, server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "f"), gpuInfo: async () => ({ temp: 50 }) });
    const logs = [], states = []; a.on("log", (l) => logs.push(l.msg)); a.on("state", (s) => states.push(s.why || ""));
    a.start();
    await until(async () => (await tasksOf(lightJob)).every((t) => t.state === "done"), 30000, () => "搜题做完：" + logs.join("\n"));
    await a.stop();
    const bl = await tasksOf(bigJob);
    assert.ok(bl.every((t) => !t.errors && t.state === "queued"), "训练不记失败、留给别的电脑：" + JSON.stringify(bl.map((t) => [t.state, t.errors])));
    assert.strictEqual(logs.filter((m) => /^领到任务：「训练大脑」/.test(m)).length, 1, "训练只领了一次");
    assert.ok(logs.some((m) => /现在显存不够做「训练大脑」：30 分钟内不再领这一类/.test(m)), logs.join("\n"));
    assert.ok(!states.some((w) => /分钟后自动再试/.test(w)), "不是整台电脑歇着：搜题照样做");
    ok("显存被占着：训练这一类 30 分钟内先不领（不记失败、留给别的电脑），搜题这些照样做，不是整台电脑歇着");
  }

  await app.close();
  console.log("全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
