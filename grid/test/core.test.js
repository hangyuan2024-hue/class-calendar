// 调度中心核心：租约过期转给别人、接力、DiLoCo 合并、审核投票、人工任务、积分；COS 预签名
"use strict";
process.removeAllListeners("warning");
const assert = require("assert");
const Core = require("../server/core");
const Store = require("../server/store");

let T = 1_000_000;
const clock = () => T;
const c = Core.open(":memory:", { clock, leaseMs: 1000 });
const ok = (m) => console.log("✓", m);

// AWS 文档里的预签名例子（examplebucket/test.txt，2013-05-24）
{
  const u = Store.presign({ endpoint: "https://s3.amazonaws.com", region: "us-east-1", bucket: "examplebucket", keyId: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", method: "GET", key: "test.txt", ttl: 86400, now: new Date("2013-05-24T00:00:00Z") });
  assert.ok(u.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"), u);
  ok("COS / S3 预签名和 AWS 文档的例子一致");
  assert.ok(!Store.okKey("../x") && !Store.okKey("a//b") && Store.okKey("jobs/1/2/a.npz"));
  ok("文件名检查：不能跳出目录");
}

// 邀请、加入
assert.throws(() => c.join({ code: "NOPE", name: "张三" }), /邀请码不对/);
const inv = c.invite({ maxUses: 3 });
const a = c.join({ code: inv.code, name: "张三", device: { name: "家里台式机" } });
const b = c.join({ code: inv.code, name: "李四", device: { name: "游戏本" } });
const a2 = c.join({ code: inv.code, name: "张三", device: { name: "笔记本" } });
assert.equal(a.member.id, a2.member.id);
assert.throws(() => c.join({ code: inv.code, name: "王五" }), /用过了/);
const exp = c.invite({ hours: 1 }); T += 2 * 3600e3;
assert.throws(() => c.join({ code: exp.code, name: "王五" }), /过期/);
const A = () => c.auth(a.token), B = () => c.auth(b.token);
assert.ok(A() && B() && !c.auth("dev_bad"));
ok("邀请码：能用几次、过期、同一个人多台电脑算一个成员");

c.addRecipe({ id: "r1", name: "接力", key: "recipes/r1.py", sig: "x" });

// 接力：一台停了（租约过期），下一台从最新存档接着算
const relay = c.createJob({ name: "接力训练", stage: "阶段 2", kind: "relay", recipe: "r1", params: { totalSteps: 100, segSteps: 50 } });
let L = c.lease(A(), {});
assert.equal(L.task.input.from, 0); assert.equal(L.resume, null);
assert.equal(c.lease(B(), {}), null, "接力一次只有一台在算");
c.checkpoint(A(), { task: L.task.id, step: 30, key: "jobs/1/1/c30" });
assert.deepEqual(c.renew(A(), { task: L.task.id, progress: 0.6, metrics: [{ step: 30, loss: 0.5 }] }).ok, true);
T += 1500;  // A 断电了：没续约
let L2 = c.lease(B(), {});
assert.equal(L2.task.id, L.task.id); assert.equal(L2.resume.step, 30); assert.equal(L2.resume.key, "jobs/1/1/c30");
assert.ok(c.renew(A(), { task: L.task.id }).cancel, "A 回来了也不能再交这个任务");
assert.throws(() => c.checkpoint(A(), { task: L.task.id, step: 40, key: "k" }));
assert.equal(c.finish(A(), { task: L.task.id, result: { ckpt: "zzz" } }).ok, false);
c.finish(B(), { task: L2.task.id, result: { ckpt: "jobs/1/1/c50" } });
let L3 = c.lease(A(), {});
assert.equal(L3.task.input.from, 50); assert.equal(L3.resume.step, 50);
c.finish(A(), { task: L3.task.id, result: { ckpt: "jobs/1/2/c100", loss: 0.01 } });
let d = c.jobDetail(relay);
assert.equal(d.state, "done"); assert.equal(d.done, 100); assert.ok(d.curves.loss.length === 1);
ok("接力：断电的那台的任务转给下一台，从第 30 步的存档接着算；回来的旧电脑交不了；分段接着排");

// 电脑要用了（release）：不算失败次数
const m1 = c.createJob({ name: "生成", kind: "map", recipe: "r1", params: { count: 3 }, priority: 5, req: { vram: 8 } });
assert.equal(c.lease(A(), { vram: 6 }), null, "显存不够不给");
L = c.lease(A(), { vram: 8 });
c.fail(A(), { task: L.task.id, release: true, error: "要打游戏" });
L = c.lease(B(), { vram: 8 });
assert.equal(L.task.seq, 0); assert.equal(c.db.prepare("select errors from tasks where id=?").get(L.task.id).errors, 0);
// 出错 5 次就放一边（seq 0 已经失败 1 次；另外两个任务也会轮着试）
c.fail(B(), { task: L.task.id, error: "boom" });
for (let i = 0; i < 20; i++) { const x = c.lease(B(), { vram: 8 }); if (!x) break; if (x.task.seq === 0) c.fail(B(), { task: x.task.id, error: "boom" }); else c.finish(B(), { task: x.task.id }); if (c.db.prepare("select state from tasks where job_id=? and seq=0").get(m1).state === "failed") break; }
assert.equal(c.db.prepare("select state from tasks where job_id=? and seq=0").get(m1).state, "failed");
assert.equal(c.lease(B(), { vram: 8 }), null, "失败的不再派");
c.retry(m1);
ok("老师要用电脑：交给别人，不算失败；一个任务老出错就先放一边");

// 管理员暂停
c.setJob(m1, { state: "paused" });
assert.equal(c.lease(A(), { vram: 8 }), null);
c.setJob(m1, { state: "active" });
L = c.lease(A(), { vram: 8 });
c.setJob(m1, { state: "paused" });
assert.match(c.renew(A(), { task: L.task.id }).why, /暂停/);
c.setJob(m1, { state: "active" });
c.finish(A(), { task: L.task.id, reviews: [{ kind: "ab", a: "jobs/2/x/a.png", b: "jobs/2/x/b.png", question: "哪个更可爱？", need: 2 }], outputs: [{ name: "a.png", key: "jobs/2/x/a.png" }] });
ok("管理员暂停：不再派，正在算的收到「停下」");

// 审核：两票同意就定；自己不会看到投过的
const C = c.join({ code: c.invite({}).code, name: "王五", device: { name: "办公室" } });
let r = c.reviewNext(A());
assert.ok(r && r.kind === "ab");
c.vote(A(), { review: r.id, choice: "a" });
assert.equal(c.reviewNext(A()), null);
assert.throws(() => c.vote(B(), { review: r.id, choice: "zzz" }), /选项/);
c.vote(B(), { review: r.id, choice: "b" });
assert.equal(c.review(r.id).state, "open", "一比一，还没定");
c.vote(c.auth(C.token), { review: r.id, choice: "a" });
assert.equal(c.review(r.id).state, "done");
assert.equal(JSON.parse(c.review(r.id).result).choice, "a");
ok("人工审核：大家都能投，够票数而且过半才定；平票继续等");

// DiLoCo：一轮 3 份，掉线一份，到时间用 2 份合并
c.addRecipe({ id: "r2", name: "dl", key: "recipes/r2.py", sig: "x" });
const dl = c.createJob({ name: "一起训", kind: "diloco", recipe: "r2", params: { rounds: 2, width: 3, innerSteps: 10, minDone: 2, roundSecs: 60 }, priority: 9 });
const p1 = c.lease(A(), {}), p2 = c.lease(B(), {}), p3 = c.lease(c.auth(C.token), {});
assert.deepEqual([p1, p2, p3].map((x) => x.task.input.shard), [0, 1, 2]);
assert.equal(p1.resume, null);
c.finish(A(), { task: p1.task.id, result: { delta: "d0" } });
c.finish(B(), { task: p2.task.id, result: { delta: "d1" } });
assert.equal(c.lease(A(), { vram: 8 }), null, "还在等第 3 份（没有别的活）");
T += 61000;  // C 掉线，到时间了
c.sweep();
const mg = c.lease(B(), {});
assert.equal(mg.task.kind, "merge"); assert.deepEqual(mg.task.input.parts, ["d0", "d1"]);
assert.ok(c.renew(c.auth(C.token), { task: p3.task.id }).cancel, "掉线那份作废了");
c.finish(B(), { task: mg.task.id, result: { global: "g1", loss: 0.2 } });
const q = c.lease(c.auth(C.token), {});
assert.equal(q.task.round, 1); assert.equal(q.resume.key, "g1");
ok("DiLoCo：一轮收齐（或到时间、够最少份数）就合并；掉线的那份作废，回来直接做下一轮");

// 人工任务：录表情
const rec = c.createJob({ name: "录表情", kind: "record", params: { items: [{ lines: ["第一句"] }, { lines: ["第二句"] }] } });
const h1 = c.humanNext(A(), rec);
assert.equal(c.humanNext(A(), rec).task.id, h1.task.id, "没录完再点还是这一段");
const h2 = c.humanNext(B(), rec);
assert.notEqual(h2.task.id, h1.task.id);
c.humanDone(A(), { task: h1.task.id, outputs: [{ name: "p.json", key: "jobs/x/p.json" }], result: { secs: 120 } });
c.humanDone(B(), { task: h2.task.id, result: { secs: 60 } });
assert.equal(c.jobDetail(rec).state, "done");
ok("录表情：一段一段领，自己没录完的还给自己");

const o = c.overview(true);
assert.ok(o.devices.length === 4 && o.stages.length === 1 && o.board[0].points > 0);
assert.ok(o.events.some((e) => /掉线/.test(e.msg)));
ok("控制中心：总体进度、各阶段、电脑、贡献榜、动态（「掉线了，交给下一台」）");
console.log("调度中心：全部通过");
