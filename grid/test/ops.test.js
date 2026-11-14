// 运维：防休眠、日志、硬盘、下载源判断、设置、拔电暂停、功耗上限、卡住检测、看门狗、控制中心遥控（开始 / 停止 / 取日志）、贡献统计、模型每一版的评测
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { EventEmitter } = require("events");
const Server = require("../server");
const Agent = require("../worker/agent");
const Power = require("../app/power");
const Logs = require("../app/logs");
const Disk = require("../app/disk");
const Region = require("../app/region");
const { createService } = require("../app/service");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await sleep(50); } throw new Error("等太久了：" + what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ops-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost";
const Tools = require("../tools/grid");

(async () => {
  // ---------- 防休眠（Windows：PowerRequest 小助手 + Electron 的 powerSaveBlocker）----------
  {
    const spawned = [], blocks = [], cmds = [];
    const fakeSpawn = (cmd, args) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => (p.killed = true); spawned.push({ cmd, args, p }); setTimeout(() => p.stdout.emit("data", "LG_POWER_OK\n"), 5); return p; };
    let lid = 1;
    const exec = async (cmd, args) => { cmds.push(args.join(" ")); if (args[0] === "/q") return `Power Setting Index\n    Current AC Power Setting Index: 0x0000000${lid}\n    Current DC Power Setting Index: 0x00000001`; if (args[0] === "/setacvalueindex") lid = +args[4]; return ""; };
    const pw = Power.create({ platform: "win32", spawn: fakeSpawn, execFile: exec, powerSaveBlocker: { start: (t) => (blocks.push(t), 7), stop: (id) => blocks.push("stop" + id) } });
    pw.keepAwake(true, "正在算"); pw.keepAwake(true, "正在算");
    assert.equal(spawned.length, 1, "开一次就够"); assert.equal(spawned[0].cmd, "powershell.exe");
    const ps = spawned[0].args[spawned[0].args.length - 1];
    assert.match(ps, /PowerSetRequest\(\$h, 3\)/, "现代待机要「执行必需」"); assert.match(ps, new RegExp("Get-Process -Id " + process.pid), "软件没了它自己退出");
    assert.deepEqual(blocks, ["prevent-app-suspension"]);
    pw.keepAwake(false);
    assert.ok(spawned[0].p.killed); assert.deepEqual(blocks, ["prevent-app-suspension", "stop7"]);
    const on = await pw.lidKeepRunning(true, null);
    assert.ok(on.ok && on.saved === 1 && lid === 0, "合盖：插电时改成「不采取任何操作」，记下原来的（睡眠）");
    const off = await pw.lidKeepRunning(false, on.saved);
    assert.ok(off.ok && lid === 1, "关掉：改回原来的");
    assert.equal((await Power.create({ platform: "linux" }).lidKeepRunning(true)).ok, false);
    ok("防休眠：要算时开（PowerRequest 执行必需 + powerSaveBlocker，软件没了自动失效），不算时关；合盖继续算能开能改回去");
  }

  // ---------- 日志：按天落盘、搜、只看错误、导出 ----------
  {
    const d = path.join(tmp, "lg"); const lines = [];
    const lg = Logs.create({ dir: () => d, flushMs: 0, onLine: (l) => lines.push(l) });
    lg.add("领到任务：画 Q版", "info", "算力"); lg.add("显卡 90℃，凉一凉", "warn", "算力"); lg.add("下载失败：连不上", "error", "下载");
    lg.flush();
    const today = lg.read();
    assert.equal(today.total, 3); assert.match(today.lines[2], /错误 \[下载\] 下载失败/);
    assert.equal(lg.read({ level: "error" }).total, 1); assert.equal(lg.read({ level: "warn" }).total, 2); assert.equal(lg.read({ q: "显卡" }).total, 1);
    fs.writeFileSync(path.join(d, "logs", "2000-01-01.log"), "很老的\n");
    lg.clean();
    assert.ok(!fs.existsSync(path.join(d, "logs", "2000-01-01.log")), "超过 14 天的删掉");
    const b = lg.bundle(3, "诊断：版本 t");
    assert.match(fs.readFileSync(b, "utf8"), /诊断：版本 t[\s\S]*领到任务/);
    assert.equal(lines.length, 3);
    ok("日志：每天一个文件、按级别 / 关键字看、留 14 天、导出带诊断信息");
  }

  // ---------- 硬盘：各部分多大、清理（正在算的留着）----------
  {
    const b = path.join(tmp, "disk"), tasks = path.join(b, "tasks");
    for (const t of ["1", "2", "3"]) { fs.mkdirSync(path.join(tasks, t), { recursive: true }); fs.writeFileSync(path.join(tasks, t, "x.bin"), Buffer.alloc(1000)); }
    fs.mkdirSync(path.join(b, "env"), { recursive: true }); fs.writeFileSync(path.join(b, "env", "py"), Buffer.alloc(500));
    const dk = Disk.create({ base: () => b, parts: () => [{ id: "env", name: "环境", path: path.join(b, "env") }, { id: "tasks", name: "任务", path: tasks, cleanable: "old", keepDays: 0, keep: (f) => path.basename(f) === "2" }] });
    const r = await dk.report();
    assert.equal(r.parts.find((p) => p.id === "tasks").bytes, 3000); assert.equal(r.parts.find((p) => p.id === "env").bytes, 500); assert.ok(r.free > 0);
    await assert.rejects(dk.clean("env"), /不能删/);
    const c = await dk.clean("tasks");
    assert.equal(c.freed, 2000); assert.deepEqual(fs.readdirSync(tasks), ["2"], "正在算的那个留着");
    ok("硬盘：统计各部分占用和剩余空间；算完的任务文件能清（正在算的留着），环境这种不让删");
  }

  // ---------- 下载源：国内 / 国外 ----------
  {
    const fetchOf = (cnOk, ghOk, cnMs = 10, ghMs = 10) => async (u) => { const cn = /myqcloud|laolaokechengbiao/.test(u); if (cn ? !cnOk : !ghOk) throw new Error("连不上"); await sleep(cn ? cnMs : ghMs); return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; };
    let saved = null;
    const R = (f, pref = "auto") => Region.create({ fetch: f, get: () => saved, set: (v) => (saved = v), pref: () => pref });
    saved = null; assert.equal(await R(fetchOf(true, false)).detect(true), "cn", "GitHub 连不上：国内");
    saved = null; assert.equal(await R(fetchOf(false, true)).detect(true), "global", "国内存储连不上：国外");
    saved = null; assert.equal(await R(fetchOf(true, true, 10, 200)).detect(true), "cn", "GitHub 慢很多：国内");
    saved = null; assert.equal(await R(fetchOf(true, true, 300, 20)).detect(true), "global");
    assert.equal(R(fetchOf(true, true), "global").current(), "global", "手动定死");
    saved = { region: "cn", at: Date.now() };
    assert.deepEqual(R(fetchOf(true, true)).order({ cos: "c", gh: ["g1", "g2"], upstream: "u" }), ["c", "g1", "g2", "u"]);
    saved = { region: "global", at: Date.now() };
    assert.deepEqual(R(fetchOf(true, true)).order({ cos: "c", gh: ["g1"], upstream: "u" }), ["g1", "u", "c"]);
    ok("下载源：同时连国内存储和 GitHub，谁通谁快用谁（都一样看时区）；国内先 COS，国外先 GitHub；能手动定死");
  }

  // ---------- 调度中心 + 客户端：设置、拔电暂停、功耗上限、遥控、统计 ----------
  const app = Server.create({ data: path.join(tmp, "srv"), noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 5, server: url });
  let battery = false, gpu = { temp: 60, power: 50 };
  const notes = [], EV = [];
  let restarted = 0;
  const svc = createService({ user: path.join(tmp, "me"), version: "t", python: "python3", send: (ch, d) => EV.push({ ch, d }), detectRegion: false,
    idleSecs: async () => 1e9, onBattery: async () => battery, notify: (t, b) => notes.push(t + "：" + b), restart: () => restarted++, setAutostart: () => {},
    agentOpt: { tickMs: 100, hbMs: 200, leaseEveryMs: 100, renewMs: 200, gpuInfo: async () => gpu, gpuApps: async () => [] } });
  await svc.H.join(inv.link, "小红", "笔记本");
  let st = await svc.H.settings();
  assert.equal(st.autostart, true, "第一次用：默认开机自启");
  assert.ok(st.keepAwake && st.pauseOnBattery && !st.lid && st.region === "auto");
  await svc.H.setManual("on");
  await until(() => svc.agent().status().state === "idle", "开始了在等任务");
  await until(() => svc.power.status().awake, "在等任务：不让睡");
  battery = true;
  await until(() => /拔了电源/.test(svc.agent().status().why), "拔电");
  assert.ok(!svc.power.status().awake, "拔了电：让电脑照常睡");
  assert.ok(notes.some((n) => /拔了电源/.test(n)));
  battery = false;
  await until(() => svc.agent().status().state === "idle", "插上电接着算");
  await svc.H.setSettings({ maxPower: 100 });
  gpu = { temp: 60, power: 140 };
  await until(() => /功耗/.test(svc.agent().status().why), "功耗超了");
  gpu = { temp: 60, power: 60 };
  await until(() => svc.agent().status().state === "idle", "功耗降下来");
  await svc.H.setSettings({ vramCap: 4, netLimit: 0, pro: true, no_done: true });
  st = await svc.H.settings();
  assert.ok(st.vramCap === 4 && st.pro && st.no_done);
  ok("设置：默认开机自启、防休眠、拔电暂停；开始了在等任务也不让睡，拔电就停（插上接着算）、功耗超了歇一会儿");

  // 遥控：停止 → 开始 → 取日志
  const devId = app.core.db.prepare("select id from devices").get().id;
  await Tools.api(admin, "/api/admin/device/cmd", { id: devId, cmd: "stop" });
  await until(() => svc.agent().status().manual === "off", "遥控停止");
  await Tools.api(admin, "/api/admin/device/cmd", { id: devId, cmd: "start" });
  await until(() => svc.agent().status().manual === "on", "遥控开始");
  await Tools.api(admin, "/api/admin/device/cmd", { id: devId, cmd: "logs" });
  let dv;
  await until(async () => { dv = await Tools.api(admin, "/api/admin/device?id=" + devId); return dv.logs.length === 1; }, "交日志");
  const logTxt = await (await fetch(dv.logs[0].url)).text();
  assert.match(logTxt, /捞捞算力诊断信息[\s\S]*控制中心让这台电脑：停止/);
  assert.ok(!/"token"/.test(logTxt), "口令不放进日志");
  assert.ok(dv.commands.every((c) => c.state === "done" && c.ok));
  await Tools.api(admin, "/api/admin/device/cmd", { id: devId, cmd: "restart" });
  await until(() => restarted === 1, "遥控重启");
  await assert.rejects(Tools.api(admin, "/api/admin/device/cmd", { id: devId, cmd: "rm -rf" }), /不认识/);
  ok("控制中心遥控：停止、开始、交日志（带诊断信息、不带口令）、重启软件；乱写的命令不收");

  // 贡献统计：心跳算在线 / 在算
  const s = await Tools.api(admin, "/api/admin/stats?days=7");
  const row = s.rows.find((r) => r.deviceId === devId);
  assert.ok(row && row.day === s.today && row.onlineSecs > 0);
  const mine = await svc.H.me().then(() => svc.agent().api("/api/me/stats?days=2"));
  assert.equal(mine.rows[0].deviceId, devId);
  ok(`贡献统计：按天、按电脑记在线 ${row.onlineSecs} 秒、在算 ${row.busySecs} 秒、做完的任务；每台电脑能看自己的`);

  // 卡住检测：Python 半天没有输出就结束、交给别人
  {
    const recipe = path.join(tmp, "hang.py");
    fs.writeFileSync(recipe, "import time\nprint('开始', flush=True)\ntime.sleep(30)\n");
    await svc.H.setManual("off");
    await sleep(300);
    const wk = path.join(tmp, "wk");
    const inv2 = await Tools.api(admin, "/api/admin/invite", { maxUses: 1, server: url });
    const j = await Agent.join(inv2.link, "测试", { name: "卡住测试" });
    const ag = Agent.create({ server: url, token: j.token, pubkey: j.pubkey, workDir: wk, python: process.env.PYTHON || "python3", tickMs: 100, hbMs: 200, leaseEveryMs: 100, renewMs: 200, stallMin: 0.02, caps: { vram: 8 } });
    ag.setManual("on");
    fs.writeFileSync(path.join(tmp, "hj.json"), JSON.stringify({ jobs: [{ name: "卡住的任务", kind: "map", recipe: recipe, params: { count: 1 } }] }));
    await Tools.plan(admin, path.join(tmp, "hj.json"));
    ag.start();
    await until(() => ag.status().logs.some((l) => /像是卡住了/.test(l.msg)), "卡住检测", 30000);
    await ag.stop();
    const t = app.core.db.prepare("select state, lost, error from tasks where job_id=(select id from jobs where name='卡住的任务')").get();
    assert.equal(t.state, "queued", "交回去给别的电脑");
    ok("卡住检测：任务很久没有任何输出（日志、进度）就结束它，交给别的电脑接着算");
  }

  // 看门狗：主循环卡住就重开
  {
    const svc2 = createService({ user: path.join(tmp, "me2"), version: "t", python: "python3", send: () => {}, detectRegion: false, watchdogMs: 300, watchdogTick: 100,
      agentOpt: { tickMs: 100000, hbMs: 200, leaseEveryMs: 100, gpuInfo: async () => null, gpuApps: async () => [] } });
    const inv3 = await Tools.api(admin, "/api/admin/invite", { maxUses: 1, server: url });
    await svc2.H.join(inv3.link, "小刚", "台式机");
    const a1 = svc2.agent();
    await until(() => svc2.agent() && svc2.agent() !== a1, "看门狗重开", 5000);
    assert.ok(svc2.logs.read({ q: "卡住" }).total >= 1);
    await svc2.shutdown();
    ok("看门狗：后台主循环 5 分钟没转就自动重开（测试里缩短了）");
  }

  // 模型每一版的评测（包括没过的）
  app.core.db.prepare("insert into models(name,version,files,metrics,state,created,note) values('demo',1,'[]','{\"acc\":0.5}','released',1,'第一版'),('demo',2,'[]','{\"acc\":0.4}','rejected',2,'变差了'),('demo',3,'[]','{\"acc\":0.6}','released',3,'')").run();
  const h = await Tools.api(admin, "/api/admin/model/history?name=demo");
  assert.deepEqual(h[0].versions.map((v) => [v.version, v.metrics.acc, v.state]), [[1, 0.5, "released"], [2, 0.4, "rejected"], [3, 0.6, "released"]]);
  ok("模型每一版的评测成绩（没过的也记着），控制中心画成曲线");

  await svc.shutdown();
  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("运维：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
