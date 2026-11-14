// 自动更新：查新版本、后台下载、核对 sha256；等没人用电脑、手上的任务算完才装（超时交给别的电脑）；录表情时不装
"use strict";
const assert = require("assert");
const http = require("http");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const U = require("../app/updater");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  assert.ok(U.newer("0.1.12", "0.1.9") && !U.newer("0.1.9", "0.1.12") && !U.newer("0.1.9", "0.1.9") && U.newer("1.0.0", "0.9.99"));
  ok("版本号按数字比（0.1.12 比 0.1.9 新）");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-upd-"));
  const exe = crypto.randomBytes(300000);
  let info = { version: "0.1.20", size: exe.length, sha256: crypto.createHash("sha256").update(exe).digest("hex") };
  let cnHits = 0;
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith("/v.json")) { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify(info)); }
    if (q.url.startsWith("/cn.exe")) { cnHits++; r.statusCode = 500; return r.end(); }   // 国内的坏了：换 GitHub 的
    if (q.url.startsWith("/gh.exe")) { r.setHeader("content-length", exe.length); return r.end(exe); }
    r.statusCode = 404; r.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  info = { ...info, cn: base + "/cn.exe", url: base + "/gh.exe" };

  let idle = 0, hidden = false, rec = false, task = { id: 1 }, drained = null, stopped = 0, installed = null;
  const agent = { drain: (v) => (drained = v), current: () => task, stop: async () => { stopped++; task = null; } };
  const ev = [];
  const up = U.create({ dir: () => tmp, version: "0.1.5", sources: ["http://127.0.0.1:1/x", base + "/v.json"], agent: () => agent, idleSecs: async () => idle, windowHidden: () => hidden, recording: () => rec, install: async (f) => (installed = f), onEvent: (e) => ev.push(e.state), maxWaitMin: 0.02 });

  let s = await up.check();
  assert.equal(s.state, "ready"); assert.equal(fs.readFileSync(s.file).length, exe.length); assert.equal(cnHits, 1);
  assert.ok(ev.includes("downloading"));
  ok("查到新版 0.1.20：第一个地址不通换第二个；国内存储下不动换 GitHub；下好、核对过 sha256");

  assert.equal(await up.maybeApply(false), false); assert.equal(drained, null);
  ok("有人在用电脑：不装，也不影响干活");
  idle = 600; rec = true;
  assert.equal(await up.maybeApply(false), false);
  ok("在录表情：不装");
  rec = false;
  assert.equal(await up.maybeApply(false), false); assert.equal(drained, null, "等更新也照常领任务"); assert.equal(installed, null);
  ok("没人用电脑、但手上有任务：接着算（不停、照常领任务），算完再装");
  task = null;
  assert.equal(await up.maybeApply(false), true); assert.equal(installed, s.file); assert.equal(stopped, 0);
  assert.equal(up.status().state, "installing");
  ok("手上的算完了：静默安装、自己重新打开");
  assert.ok(fs.existsSync(s.file + ".ok"));
  assert.equal(U.create({ dir: () => tmp, version: "0.1.5" }).pending().version, "0.1.20", "下好没装的，开机 / 退出时先装");
  assert.equal(U.create({ dir: () => tmp, version: "0.1.20" }).pending(), null);

  // 有人一直在用电脑：下好超过 6 小时，手上没任务时先提醒 1 分钟，再装
  const notes = [];
  const up2 = U.create({ dir: () => tmp, version: "0.1.5", sources: [base + "/v.json"], agent: () => agent, idleSecs: async () => 0, windowHidden: () => false, install: async (f) => (installed = "2:" + f), overdueH: 0.00001, notify: (t) => notes.push(t) });
  task = null; drained = null; installed = null;
  await up2.check();
  await sleep(100);
  assert.equal(await up2.maybeApply(false), false); assert.equal(notes.length, 1); assert.match(up2.status().waiting, /1 分钟后/);
  ok("有人一直在用：下好 6 小时还没装上，就提前 1 分钟提醒，再装");
  // 控制中心遥控「立刻更新」：手上的交给别的电脑接着算
  task = { id: 3 };
  assert.equal(await up2.now(), true); assert.equal(stopped, 1); assert.ok(String(installed).startsWith("2:"));
  ok("「立刻更新」：手上的任务交给别的电脑从存档接着算，马上装");

  // 坏的安装包不装
  info = { ...info, version: "0.1.21", sha256: "0".repeat(64) };
  const up3 = U.create({ dir: () => tmp, version: "0.1.5", sources: [base + "/v.json"], install: async () => {} });
  s = await up3.check();
  assert.equal(s.state, "idle"); assert.match(s.error, /不完整/);
  assert.ok(!fs.readdirSync(path.join(tmp, "update")).some((f) => f.includes("0.1.21")));
  ok("下载的安装包和 sha256 对不上：删掉不装，过一会儿重新下");
  info = { ...info, version: "0.1.5" };
  s = await U.create({ dir: () => tmp, version: "0.1.5", sources: [base + "/v.json"], install: async () => {} }).check();
  assert.equal(s.state, "idle");
  ok("已经是最新版：什么也不做");

  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log("自动更新：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
