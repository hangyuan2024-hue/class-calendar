// 发布门槛：逐题比、有把握才发（plans/qa.json、chat.json 的 publish.metrics + qa_train.py 的 paired）
//   100 道题的总分天然上下差 5 分左右：只看总分差几分，运气好的没变好的也会发、运气差的变好了也会被拦下
"use strict";
const assert = require("assert");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const Core = require("../server/core");
const Cycle = require("../server/cycle");
const ok = (m) => console.log("✓", m);
const PY = process.env.PYTHON || "python3";

// qa_train.py 的 paired()：拿出来单独跑
const src = fs.readFileSync(path.join(__dirname, "..", "recipes", "qa_train.py"), "utf8").replace(/\r\n/g, "\n");
const fn = /\ndef paired\([\s\S]*?\n\n\n/.exec(src)[0];
const paired = (a, b) => JSON.parse(execFileSync(PY, ["-c", fn + `\nimport json\nprint(json.dumps(paired(${JSON.stringify(a)}, ${JSON.stringify(b)})))`]).toString());
const bits = (n, ones) => Array.from({ length: n }, (_, i) => (ones(i) ? "1" : "0")).join("");
{
  const a = bits(300, (i) => i % 2 === 0);              // 旧的对一半
  const same = paired(a, a);
  assert.deepStrictEqual(same, [0, 0]);
  const better = paired(a, bits(300, (i) => i % 2 === 0 || i % 10 === 1));   // 30 道从错变对、没有从对变错
  assert.ok(better[0] === 0.1 && better[1] > 0.06, JSON.stringify(better));
  const noisy = paired(bits(100, (i) => i % 2 === 0), bits(100, (i) => (i % 2 === 0 && i % 20 !== 0) || i % 20 === 1 || i % 20 === 3));   // 变对 10、变错 5：平均涨 5 分
  assert.ok(noisy[0] === 0.05 && noisy[1] < 0, "100 道题涨 5 分：说不准（下限是负的）" + JSON.stringify(noisy));
  ok(`逐题比：一样 → 0；300 道里 30 道从错变对 → 涨 10 分、有把握至少涨 ${(better[1] * 100).toFixed(1)} 分；100 道里变对 10 变错 5 → 平均涨 5 分但下限 ${(noisy[1] * 100).toFixed(1)}（说不准）`);
}

// 门槛：用答题大脑的发布规则判几种情况
{
  const c = Core.open(":memory:", { clock: () => 1e6 });
  const cy = Cycle.attach(c, { clock: () => 1e6 });
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plans", "qa.json"), "utf8")).publish;
  const cur = { metrics: JSON.stringify({ acc: 0.70, zh_rate: 0.95, gain_lo: 0.02, cur_lo: 0, cur_gain: 0.03 }) };
  const cand = (x) => ({ acc: 0.72, base_acc: 0.6, zh_rate: 0.95, gain_lo: 0.05, cur_lo: -0.01, cur_gain: 0.02, zero: 0, ...x });
  assert.ok(cy.better(spec, null, cand({})).ok, "第一版");
  assert.ok(cy.better(spec, cur, cand({})).ok, "比现在的平均涨了、有把握不会差 2 分以上 → 发");
  assert.ok(!cy.better(spec, cur, cand({ cur_gain: 0.03, cur_lo: -0.05 })).ok, "平均涨了，但说不准（下限 -5 分）→ 不发");
  assert.ok(!cy.better(spec, cur, cand({ cur_gain: -0.01, cur_lo: -0.015 })).ok, "比现在的平均差了 → 不发");
  assert.ok(!cy.better(spec, cur, cand({ cur_gain: 0, cur_lo: 0 })).ok, "和现在的一样 → 不发");
  assert.ok(!cy.better(spec, cur, cand({ gain_lo: -0.04 })).ok, "比原版都说不准好 → 不发");
  assert.ok(!cy.better(spec, cur, cand({ zh_rate: 0.9 })).ok, "用中文讲的比例掉了 → 不发");
  assert.ok(!cy.better(spec, cur, cand({ acc: 0.5 })).ok, "总分比原版低太多 → 不发");
  ok("发布门槛：比现在的平均涨了、而且有把握不会差 2 分以上才发；说不准、变差、一样、中文变少、比原版差太多都不发");
}
// 派训练看真正空着的显存（req.needFree）：别的程序占着就先不派给这台
{
  const c = Core.open(":memory:", { clock: () => 1e6, leaseMs: 60000 });
  c.addRecipe({ id: "r", name: "r", key: "recipes/r.py", sig: "x" });
  const jt = c.createJob({ name: "训练答题大脑", kind: "map", recipe: "r", params: { count: 1 }, req: { vram: 7.5, needFree: 5.5 }, priority: 9 });
  const jd = c.createJob({ name: "做数学题", kind: "map", recipe: "r", params: { count: 1 }, req: { vram: 4 }, priority: 5 });
  const inv = c.invite({ maxUses: 5 });
  const A = c.join({ code: inv.code, name: "甲", device: { name: "8G 笔记本" } }), B = c.join({ code: inv.code, name: "乙", device: { name: "老客户端" } });
  assert.equal(c.lease(c.auth(A.token), { vram: 8, vramFree: 3.1 }).job.id, jd, "只空着 3.1G：先不派训练，派别的");
  assert.equal(c.lease(c.auth(B.token), { vram: 8 }).job.id, jt, "老客户端不报空着多少：照旧派");
  ok("派训练看真正空着的显存：只空着 3.1G 的先不派训练（派别的活），不报的老客户端照旧");
}
console.log("发布门槛：全部通过");
