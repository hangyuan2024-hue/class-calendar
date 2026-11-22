// 训练等久了自动升优先级（每等一小时 +1，最多 +10）；一直开着的造数据任务不升；报错自动归类、已知问题自动处理；每天一份简报
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const Core = require("../server/core");
const ok = (m) => console.log("✓", m);

let T = Date.UTC(2026, 10, 22, 2, 0);   // 北京时间 10 点
const c = Core.open(":memory:", { clock: () => T });
c.addRecipe({ id: "r", name: "r", key: "recipes/r.py", sig: "x" });
const inv = c.invite({ maxUses: 9 });
const D = c.join({ code: inv.code, name: "甲", device: { name: "甲的电脑" } });
const dev = () => c.auth(D.token);
const gen = c.createJob({ name: "造数据", kind: "map", recipe: "r", params: { count: 50, sig: "abc", runId: 1 }, priority: 9 });
const train = c.createJob({ name: "训练", kind: "map", recipe: "r", params: { count: 1, runId: 2 }, priority: 5 });
const pick = () => { const l = c.lease(dev(), {}); const name = c.db.prepare("select name from jobs where id=?").get(l.job.id).name; c.fail(dev(), { task: l.task.id, error: "要用电脑了", release: true }); return name; };
assert.equal(pick(), "造数据", "刚开始：优先级高的造数据先做");
T += 3 * 3600e3;
assert.equal(pick(), "造数据", "等了 3 小时：5+3 < 9");
T += 2 * 3600e3;
assert.equal(pick(), "训练", "等了 5 小时：5+5 > 9，训练先做");
ok("训练等久了自动升优先级（每小时 +1）：等了 5 小时排到一直开着的造数据前面；造数据任务不跟着升");

// 报错归类
const K = (m) => c.classifyError(m).kind;
assert.equal(K("CUDA out of memory. Tried to allocate"), "vram"); assert.equal(K("RuntimeError: CUDA error: an illegal memory access"), "gpu");
assert.equal(K("urlopen error timed out"), "net"); assert.equal(K("OSError: [Errno 28] No space left on device"), "disk");
assert.equal(K("配方被系统结束（0xC000013A）"), "killed"); assert.equal(K("这台电脑的客户端太旧，挂不上底座永久层"), "old"); assert.equal(K("ZeroDivisionError"), "other");
const j2 = c.createJob({ name: "做题", kind: "map", recipe: "r", params: { count: 1 }, priority: 99 });
let l = c.lease(dev(), {});
assert.equal(l.job.id, j2);
c.fail(dev(), { task: l.task.id, error: "RuntimeError: CUDA out of memory" });
let t = c.db.prepare("select * from tasks where id=?").get(l.task.id);
assert.equal(t.state, "queued"); assert.equal(t.errors, 0, "已知问题：不算失败次数");
assert.ok(c.db.prepare("select msg from events where type='error' order by id desc").get().msg.startsWith("【显存不够·已知问题，自动处理】"));
l = c.lease(dev(), {});
c.fail(dev(), { task: l.task.id, error: "ZeroDivisionError: division by zero" });
assert.equal(c.db.prepare("select errors from tasks where id=?").get(l.task.id).errors, 1, "不认得的错照常算");
ok("报错自动归类（显存、显卡、网络、磁盘、被系统结束、客户端太旧……）；已知问题交给别的电脑、不算失败；不认得的照常算");

// 简报
T = Date.UTC(2026, 10, 23, 1, 0);   // 第二天北京时间 9 点
const b = c.dailyBrief();
assert.ok(b && /【每日简报】/.test(c.db.prepare("select msg from events where type='brief'").get().msg));
assert.ok(b.errors.some((e) => e.kind === "vram" && e.n === 1) && b.errors.some((e) => e.kind === "other"), JSON.stringify(b.errors));
assert.ok(/出错：/.test(b.text) && /显存不够 1 次/.test(b.text), b.text);
assert.equal(c.dailyBrief(), null, "一天只发一份");
T += 86400e3;
assert.ok(c.dailyBrief(), "第二天再发");
ok("每天早上 8 点以后发一份简报到动态：在线几台、算完多少、各类出错几次几台电脑、发布了什么、新版推得怎么样；一天一份");
console.log("自动升优先级、报错归类、每日简报：全部通过");
