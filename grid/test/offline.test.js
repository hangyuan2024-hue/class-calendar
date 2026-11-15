// 断网测试：电脑正在算，调度中心连不上了（服务器挂了 / 校园网掉了），时间超过租约。
// 检查：
//   1. 状态里说清楚连不上的原因（不是一句 fetch failed），并说明手上的还在算；
//   2. 断网期间算完的结果先留在本机，连上后自动交上去，不白算；
//   3. 调度中心把这个任务收回队列后，只要还没别的电脑领走，原来那台连回来就把任务还给它；
//   4. 要是已经被别的电脑领走了，原来那台连回来就停下（不重复交）。
"use strict";
process.removeAllListeners("warning");
process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Server = require("../server");
const Agent = require("../worker/agent");

const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-offline-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("等太久了：" + what); await sleep(50); } };

// 假装连不上：和 Node 自带 fetch 断网时一模一样的错误（TypeError: fetch failed，cause 里是 ECONNREFUSED）
function flakyFetch() {
  const f = async (url, o) => {
    if (f.down) { const c = new Error("connect ECONNREFUSED 1.2.3.4:8787"); c.code = "ECONNREFUSED"; throw new TypeError("fetch failed", { cause: c }); }
    return fetch(url, o);
  };
  f.down = false;
  return f;
}

(async () => {
  // 好认的错误原因
  {
    const c = new Error("x"); c.code = "ECONNREFUSED";
    const e = new TypeError("fetch failed", { cause: c });
    assert.ok(Agent.isNet(e)); assert.match(Agent.netWhy(e), /调度中心没开.*ECONNREFUSED/);
    const d = new Error("getaddrinfo ENOTFOUND grid.x.cn"); d.code = "ENOTFOUND";
    assert.match(Agent.netWhy(new TypeError("fetch failed", { cause: d })), /域名解析失败/);
    const t = new Error("x"); t.code = "CERT_HAS_EXPIRED";
    assert.match(Agent.netWhy(new TypeError("fetch failed", { cause: t })), /证书过期/);
    const to = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    assert.ok(Agent.isNet(to)); assert.match(Agent.netWhy(to), /没回应/);
    const s = new Error("调度中心出错 500"); s.status = 500; assert.ok(!Agent.isNet(s));
    ok("连不上的原因说成人话：没开 / 域名 / 证书 / 超时；调度中心明确报错不算断网");
  }

  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 1500 });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const join = (n) => Agent.join(inv.link, n, { name: n + "的电脑", info: { gpu: "RTX 5060", vram: 8 } });
  const boot = (cred, dir, f) => Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, dir), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 150, hbMs: 300, leaseEveryMs: 150, renewMs: 300, retryMs: 200, fetch: f });

  // ---------- 1～3：断网超过租约，结果留在本机；连回来任务还给它，交上去 ----------
  const planFile = path.join(tmp, "plan1.json");
  fs.writeFileSync(planFile, JSON.stringify({ jobs: [
    { name: "断网接力", stage: "阶段 2 · 训练", kind: "relay", recipe: path.join(ROOT, "recipes/demo_relay.py"), params: { totalSteps: 120, segSteps: 120, ckptEvery: 20, sleep: 0.02 }, priority: 3 },
  ] }));
  const [jobId] = await Tools.plan(admin, planFile);
  const f1 = flakyFetch();
  const a = boot(await join("张三"), "a", f1);
  const states = [], logs = [];
  a.on("state", (s) => states.push(s)); a.on("log", (l) => logs.push(l.msg));
  let done = null; a.on("done", (d) => { done = d; });
  a.start();
  await until(() => a.current() && a.current().progress > 0.15, 20000, "开始算");
  f1.down = true;
  await until(() => states.some((s) => s.state === "offline"), 5000, "发现断网");
  const off = states.find((s) => s.state === "offline");
  assert.match(off.why, /调度中心没开（连接被拒绝）（ECONNREFUSED）/); assert.match(off.why, /手上的还在接着算/); assert.ok(off.running);
  ok("断网：状态写明「调度中心没开（ECONNREFUSED）」，而且说手上的还在算");
  await until(() => logs.some((m) => /换了一套新的网络连接/.test(m)), 5000, "自动换网络连接");
  ok("连续连不上：自动换一套新的网络连接（不用重开软件）");
  // 超过租约（1.5 秒），调度中心把任务收回队列
  await sleep(2000); app.core.sweep();
  assert.ok(app.core.overview(true).events.some((e) => e.type === "lost"), "调度中心应该把任务收回去");
  // 断网期间算完：结果等着交
  await until(() => logs.some((m) => /交结果：连不上调度中心/.test(m)) || logs.some((m) => /上传结果.*连不上/.test(m)), 20000, "算完、等着交结果").catch((e) => { const c = a.current(); console.log(logs.slice(-25).join("\n")); console.log(JSON.stringify(c && { p: c.progress, lastCkpt: c.lastCkpt, result: !!c.result, fin: c.finishing, wait: c.waitNet, exit: c.child && c.child.exitCode, line: c.line, note: c.note })); throw e; });
  assert.ok(a.current() && a.current().finishing, "算完的结果应该还留着");
  assert.strictEqual(done, null);
  ok("断网期间算完了：结果先留在本机，不报错、不扔");
  f1.down = false;
  await until(() => done, 15000, "连回来交结果");
  assert.strictEqual(done.ok, true, "连回来交的结果应该收下");
  const ov = app.core.overview(true);
  assert.ok(ov.events.some((e) => e.type === "back"), "应该有「连回来了，还给它」");
  const job = ov.jobs.find((j) => j.id === jobId);
  assert.strictEqual(job.state, "done");
  assert.ok(!logs.some((m) => /从第 \d+ 步的存档接着算/.test(m)), "没有换电脑重算");
  assert.ok(logs.some((m) => /又连上调度中心了/.test(m)));
  ok("连回来了：任务还给原来那台，断网期间算的结果交上去了，任务完成（没有从存档重算）");
  await a.stop();

  // ---------- 4：断网期间被别的电脑领走 → 原来那台连回来就停，不重复交 ----------
  const planFile2 = path.join(tmp, "plan2.json");
  fs.writeFileSync(planFile2, JSON.stringify({ jobs: [
    { name: "断网被接走", stage: "阶段 2 · 训练", kind: "relay", recipe: path.join(ROOT, "recipes/demo_relay.py"), params: { totalSteps: 200, segSteps: 200, ckptEvery: 20, sleep: 0.03 }, priority: 3 },
  ] }));
  const [job2] = await Tools.plan(admin, planFile2);
  const f2 = flakyFetch();
  const b = boot(await join("李四"), "b", f2);
  const blogs = []; b.on("log", (l) => blogs.push(l.msg));
  let bdone = null; b.on("done", (d) => { bdone = d; });
  b.start();
  await until(() => b.current() && b.current().ckpts >= 1, 20000, "李四开始算、存了档");
  f2.down = true;
  await sleep(2000);
  const c = boot(await join("王五"), "c", flakyFetch());   // 别的电脑：一上线就领走（顺便触发收回）
  c.start();
  await until(() => c.current(), 10000, "王五领走");
  f2.down = false;
  await until(() => bdone, 20000, "李四连回来");
  assert.ok(!bdone.ok, "李四不该再交");
  assert.ok(blogs.some((m) => /已经交给别的电脑了/.test(m)));
  await until(() => app.core.overview(true).jobs.find((j) => j.id === job2).state === "done", 30000, "王五算完");
  ok("断网期间被别的电脑接走：原来那台连回来就停下，不重复交；接手的从存档算完");
  await b.stop(); await c.stop();

  // ---------- 5：传文件断了（socket hang up）：自动重试、接着下，不让整个任务失败 ----------
  {
    const http = require("http");
    const body = Buffer.alloc(300000, 7);
    let n = 0;
    const fsrv = http.createServer((q, r) => {
      n++;
      if (n <= 2) return q.socket.destroy();   // 前两次直接挂断：客户端看到的就是 socket hang up
      if (n === 3) { r.writeHead(200, { "content-length": body.length }); r.write(body.subarray(0, 100000)); return setTimeout(() => q.socket.destroy(), 50); }   // 第三次传一半断了
      const m = /bytes=(\d+)-/.exec(q.headers.range || "");
      const from = m ? +m[1] : 0;
      r.writeHead(m ? 206 : 200, { "content-length": body.length - from }); r.end(body.subarray(from));
    }).listen(0, "127.0.0.1");
    await new Promise((r) => fsrv.on("listening", r));
    const f = path.join(tmp, "dl.bin");
    await Agent.xfer("GET", `http://127.0.0.1:${fsrv.address().port}/x`, f, { retryMs: 50 });
    assert.ok(fs.readFileSync(f).equals(body), "下载的内容要完整");
    assert.ok(n >= 4);
    fsrv.close();
    ok("下载被挂断（socket hang up）、传一半断了：自动重试、从断的地方接着下，内容完整");
  }

  // ---------- 6：一个人算的大任务（map）中途出错 / 停下：下次从它自己的存档接着算 ----------
  {
    const rf = path.join(tmp, "ck_map.py");
    fs.writeFileSync(rf, [
      "import os, lg",
      "t = lg.task()",
      "if t.get('resume'):",
      "    lg.log('resume %s' % open(t['resume']).read())",
      "    lg.done(ok=1)",
      "else:",
      "    f = os.path.join(lg.work_dir(), 'ck-7.txt'); open(f, 'w').write('7'); lg.checkpoint(f, 7)",
      "    import time; time.sleep(1.5)",
      "    raise SystemExit('boom')",
    ].join("\n"));
    const pf = path.join(tmp, "plan3.json");
    fs.writeFileSync(pf, JSON.stringify({ jobs: [{ name: "存档接着算", stage: "阶段 2 · 训练", kind: "map", recipe: rf, params: { count: 1 }, priority: 9 }] }));
    const [j3] = await Tools.plan(admin, pf);
    const d = boot(await join("赵六"), "d", flakyFetch());
    const dl = []; d.on("log", (l) => dl.push(l.msg));
    d.start();
    await until(() => app.core.overview(true).jobs.find((j) => j.id === j3).state === "done", 30000, "存档接着算");
    assert.ok(dl.some((m) => m === "resume 7"), "第二次应该拿到第一次的存档：" + dl.slice(-10).join(" | "));
    ok("一个人算的大任务出错重来：从它自己最近的存档接着算（训练答题大脑不再从头训）");
    await d.stop();
  }

  // ---------- 7：配方开的子程序不留在后台；模型缓存不放 C 盘 ----------
  {
    const rf = path.join(tmp, "orphan.py");
    fs.writeFileSync(rf, [
      "import os, sys, subprocess, lg",
      "t = lg.task()",
      "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])",
      "open(os.path.join(lg.work_dir(), '..', '..', 'kid.pid'), 'w').write(str(p.pid))",
      "lg.log('HF_HOME=' + os.environ.get('HF_HOME', ''))",
      "lg.done(ok=1)",
    ].join("\n"));
    const pf = path.join(tmp, "plan4.json");
    fs.writeFileSync(pf, JSON.stringify({ jobs: [{ name: "留了子程序", stage: "阶段 2 · 训练", kind: "map", recipe: rf, params: { count: 1 }, priority: 9 }] }));
    const [j4] = await Tools.plan(admin, pf);
    const e = boot(await join("钱七"), "e", flakyFetch());
    const el = []; e.on("log", (l) => el.push(l.msg));
    e.start();
    await until(() => app.core.overview(true).jobs.find((j) => j.id === j4).state === "done", 30000, "留了子程序");
    const kidFile = path.join(tmp, "e", "kid.pid");
    const kid = +fs.readFileSync(kidFile, "utf8");
    await until(() => { try { process.kill(kid, 0); return false; } catch (x) { return true; } }, 5000, "子程序被收掉");
    assert.ok(el.some((m) => m.startsWith("HF_HOME=" + path.join(tmp, "e", "cache", "hf"))), "模型缓存应该在数据文件夹里：" + el.filter((m) => /HF_HOME/.test(m)).join());
    ok("配方退出时留在后台的子程序被一起收掉（不再一直占内存、显存）；模型缓存放在数据文件夹里，不占 C 盘");
    await e.stop();
  }

  // ---------- 8：硬盘快满了：先不领新任务，说清楚哪个盘剩多少 ----------
  {
    const cred = await join("孙八");
    const g = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "g"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32 }, tickMs: 150, hbMs: 300, minFreeGB: 1e9 });
    const gs = []; g.on("state", (x) => gs.push(x));
    g.start();
    await until(() => gs.some((x) => x.state === "waiting" && /只剩 .*G：先不领新任务/.test(x.why)), 5000, "硬盘快满了");
    assert.ok(!g.current(), "硬盘快满了不该领任务");
    ok("硬盘快满了：先不领新任务，告诉你是哪个盘、还剩多少");
    await g.stop();
  }

  // ---------- 9：任务一直在用本地大模型：不会被「10 分钟没人用就关」中途关掉 ----------
  {
    const rf = path.join(tmp, "llm_long.py");
    fs.writeFileSync(rf, ["# needs: llm", "import time, lg", "t = lg.task()", "time.sleep(1.5)", "lg.done(ok=1)"].join("\n"));
    const pf = path.join(tmp, "plan5.json");
    fs.writeFileSync(pf, JSON.stringify({ jobs: [{ name: "一直问大模型", stage: "阶段 2 · 训练", kind: "map", recipe: rf, params: { count: 1, llm: { lazy: true } }, priority: 9 }] }));
    const [j5] = await Tools.plan(admin, pf);
    let touched = 0;
    const cred = await join("周九");
    const h = Agent.create({ server: cred.server, token: cred.token, pubkey: cred.pubkey, workDir: path.join(tmp, "h"), python: PY, caps: { gpu: "RTX 5060", vram: 8, ram: 32, llm: true }, tickMs: 150, hbMs: 300, leaseEveryMs: 150, renewMs: 200,
      llm: { ensure: async () => "http://127.0.0.1:1", stop: () => {}, touch: () => { touched++; } } });
    h.start();
    await until(() => app.core.overview(true).jobs.find((j) => j.id === j5).state === "done", 30000, "一直问大模型");
    assert.ok(touched >= 3, "任务在算的时候要一直替大模型报平安：" + touched);
    ok("任务一直在问本地大模型：替它续着「没人用就关」的计时，不会中途被关掉（以前 10 分钟一到就连不上了）");
    await h.stop();
  }

  await app.close();
  console.log("断网测试：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
