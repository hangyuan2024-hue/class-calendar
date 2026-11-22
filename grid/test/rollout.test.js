// 客户端新版本分批推（灰度）：先一台试 → 一半 → 全部；新版出错比旧版多就停推；管理员看过了可以接着推
//   客户端：下载前先问调度中心（不让换就不下、不装，状态里写为什么）；遥控「立刻更新」不问；老调度中心没有这个接口照旧更新
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const Core = require("../server/core");
const U = require("../app/updater");
const ok = (m) => console.log("✓", m);

(async () => {
  let T = 1e9;
  const c = Core.open(":memory:", { clock: () => T, rolloutMin: 60, rolloutWaitMin: 180 });
  c.addRecipe({ id: "r", name: "r", key: "recipes/r.py", sig: "x" });
  const job = c.createJob({ name: "活", kind: "map", recipe: "r", params: { count: 1 }, priority: 1 });
  const inv = c.invite({ maxUses: 9 });
  const D = ["甲", "乙", "丙", "丁"].map((n) => c.join({ code: inv.code, name: n, device: { name: n + "的电脑" } }));
  const dev = (i) => c.auth(D[i].token);
  const setVer = (i, v) => c.db.prepare("update devices set info=? where id=?").run(JSON.stringify({ version: v }), dev(i).id);
  const done = (i, n) => { for (let k = 0; k < n; k++) c.db.prepare("insert into tasks(job_id,kind,seq,state,device_id,finished) values(?,?,?,?,?,?)").run(job, "run", 100 + k, "done", dev(i).id, T); };
  const err = (i, n) => { for (let k = 0; k < n; k++) c.db.prepare("insert into events(ts,type,msg,device_id) values(?,?,?,?)").run(T, "error", "出错", dev(i).id); };
  [0, 1, 2, 3].forEach((i) => setVer(i, "0.1.100"));

  assert.ok(c.updateGate(dev(0), { version: "0.1.101" }).ok, "第一个来问的先试");
  const no = c.updateGate(dev(1), { version: "0.1.101" });
  assert.ok(!no.ok && /先在一台电脑上试/.test(no.why));
  setVer(0, "0.1.101"); T += 30 * 60e3; done(0, 3); done(1, 2); err(1, 1);
  assert.ok(!c.updateGate(dev(1), { version: "0.1.101" }).ok, "不到一小时：还不推");
  T += 31 * 60e3;
  const even = [0, 1, 2, 3].filter((i) => dev(i).id % 2 === 0), odd = [1, 2, 3].filter((i) => dev(i).id % 2 === 1);
  assert.ok(c.updateGate(dev(even.find((i) => i)), { version: "0.1.101" }).ok, "试了一小时、新版不比旧版出错多：推给一半");
  assert.ok(!c.updateGate(dev(odd[0]), { version: "0.1.101" }).ok, "另一半还要等");
  T += 181 * 60e3;   // 一半那一档一直没算几个任务：等满 3 小时没出错也往下推
  assert.ok(c.updateGate(dev(odd[0]), { version: "0.1.101" }).ok, "推给所有电脑");
  ok("分批推：第一个来问的先试，一小时后新版不比旧版出错多就推给一半，再没问题推给全部（证据不够最多等 3 小时）");

  // 新版出错多：停推；管理员看过了接着推
  assert.ok(c.updateGate(dev(0), { version: "0.1.102" }).ok);
  setVer(0, "0.1.102"); T += 61 * 60e3; err(0, 3); done(1, 5);
  const p = c.updateGate(dev(1), { version: "0.1.102" });
  assert.ok(!p.ok && p.stage === "paused" && /出错多/.test(p.why), JSON.stringify(p));
  assert.ok(c.db.prepare("select msg from events where type='update' order by id desc limit 1").get().msg.includes("先不推给别人"));
  const rb = c.updateGate(dev(0), { version: "0.1.102", current: "0.1.102" });
  assert.ok(!rb.ok && rb.rollback, "已经装上坏版本的那台：让它退回");
  assert.ok(!c.updateGate(dev(1), { version: "0.1.102", current: "0.1.100" }).rollback, "没装的不用退");
  ok("停推以后：已经装上坏版本的电脑自动退回上一版，没装的不动");
  c.setRollout("0.1.102", "all");
  assert.ok(c.updateGate(dev(1), { version: "0.1.102" }).ok);
  assert.equal(c.rollouts()[0].version, "0.1.102");
  ok("新版在试的电脑上出错比旧版多：停推、动态里说清楚；管理员看过了可以直接推给所有人");

  // ---------- 客户端 ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ro-"));
  const exe = crypto.randomBytes(1000);
  const info = { version: "0.1.103", size: exe.length, sha256: crypto.createHash("sha256").update(exe).digest("hex") };
  let gets = 0;
  const srv = http.createServer((q, r) => { if (q.url.startsWith("/v.json")) return r.end(JSON.stringify({ ...info, url: base + "/a.exe" })); gets++; r.end(exe); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let allow = { ok: false, why: "新版 0.1.103 先在一台电脑上试，没问题再推给你（大约一小时）" };
  const up = U.create({ dir: () => tmp, version: "0.1.101", sources: [base + "/v.json"], gate: async () => allow, install: async () => true });
  let s = await up.check();
  assert.equal(s.state, "held"); assert.match(s.waiting, /先在一台电脑上试/); assert.equal(gets, 0, "不让换就不下");
  allow = { ok: true };
  s = await up.check();
  assert.equal(s.state, "ready"); assert.equal(gets, 1);
  const up2 = U.create({ dir: () => path.join(tmp, "b"), version: "0.1.101", sources: [base + "/v.json"], gate: async () => { throw new Error("404 没有这个接口"); }, install: async () => true });
  assert.equal((await up2.check()).state, "ready", "老调度中心：照旧更新");
  let asked = 0;
  const up3 = U.create({ dir: () => path.join(tmp, "c"), version: "0.1.101", sources: [base + "/v.json"], gate: async () => { asked++; return { ok: false, why: "等" }; }, install: async () => true });
  assert.equal(await up3.now(), true); assert.equal(asked, 0, "遥控「立刻更新」不问");
  ok("客户端：不让换就不下载、状态里写为什么；让换了再下；老调度中心照旧更新；遥控「立刻更新」直接装");
  // 自己装着的是坏版本：用留着的上一版安装包退回去；没留就照实说
  const d4 = path.join(tmp, "d"), ud = path.join(d4, "update");
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, "LaolaoGrid-Setup-0.1.101.exe"), "old"); fs.writeFileSync(path.join(ud, "LaolaoGrid-Setup-0.1.101.exe.ok"), "0.1.101");
  let asked4 = null;
  const up4 = U.create({ dir: () => d4, version: "0.1.103", sources: [base + "/v.json"], gate: async (v, cur) => { asked4 = [v, cur]; return { ok: false, rollback: true, why: "新版 0.1.103 出错多：退回上一版" }; }, install: async () => true });
  s = await up4.check();
  assert.deepStrictEqual(asked4, ["0.1.103", "0.1.103"]);
  assert.equal(s.state, "ready"); assert.equal(s.latest, "0.1.101"); assert.ok(s.rollback && /LaolaoGrid-Setup-0\.1\.101\.exe$/.test(s.file));
  const up5 = U.create({ dir: () => path.join(tmp, "e"), version: "0.1.103", sources: [base + "/v.json"], gate: async () => ({ ok: false, rollback: true }), install: async () => true });
  s = await up5.check();
  assert.ok(s.state !== "ready" && /没留上一版/.test(s.error));
  ok("装着的是坏版本：用留着的上一版安装包自动退回；没留就照实说（去官网下上一版）");
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("分批推新版：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
