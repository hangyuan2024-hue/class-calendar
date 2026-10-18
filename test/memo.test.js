// node test/memo.test.js —— 备忘录规则（清单、重复、置顶、搜索）。安卓 CoreTest.kt 用同样的例子。
const assert = require("assert");
const M = require("../memo-core.js");
const ok = (s) => console.log("✓ " + s);

// 1. 重复：排到今天之后的下一次
{
  assert.strictEqual(M.nextDay("2026-10-16", "day"), "2026-10-17");
  assert.strictEqual(M.nextDay("2026-10-16", "weekday"), "2026-10-19");    // 周五 → 下周一
  assert.strictEqual(M.nextDay("2026-10-16", "week"), "2026-10-23");
  assert.strictEqual(M.nextDay("2026-01-31", "month"), "2026-02-28");      // 没有 31 号就月底
  assert.strictEqual(M.nextDay("2028-02-29", "year"), "2029-02-28");
  const r = { id: "p1", subject: "背单词", event_time: "2026-10-12 07:30", rep: "day", list: [{ t: "A", d: true }], reps: 2 };
  const p = M.complete(r, "2026-10-18");
  assert.deepStrictEqual(p, { event_time: "2026-10-19 07:30", done: false, reps: 3, list: [{ t: "A", d: false }] });
  assert.strictEqual(M.complete({ event_time: "2026-10-25", rep: "week" }, "2026-10-18").event_time, "2026-11-01");   // 提前做完：只往后排一次
  assert.strictEqual(M.complete({ event_time: "", rep: "day" }, "2026-10-18"), null);
  assert.strictEqual(M.complete({ event_time: "2026-10-18" }, "2026-10-18"), null);
  assert.strictEqual(M.repName("weekday"), "工作日");
  ok("重复：每天 / 工作日 / 每周 / 每月 / 每年，勾完成排到下一次、清单重置");
}
// 2. 清单
{
  const l = M.listFromText("□ 牛奶\n✓ 面包\n- 鸡蛋\n\n[x] 苹果\n1. 香蕉", [{ t: "鸡蛋", d: true }]);
  assert.deepStrictEqual(l, [{ t: "牛奶", d: false }, { t: "面包", d: true }, { t: "鸡蛋", d: true }, { t: "苹果", d: true }, { t: "香蕉", d: false }]);
  assert.strictEqual(M.listToText(l.slice(0, 2)), "牛奶\n✓ 面包");
  assert.deepStrictEqual(M.listStat({ list: l }), { n: 5, d: 3, all: false, text: "3/5" });
  assert.strictEqual(M.toggleItem({ list: l }, 0)[0].d, true);
  assert.ok(M.looksLikeList("□ a\n□ b\n□ c"));
  assert.ok(!M.looksLikeList("今天去开会\n记得带电脑"));
  ok("清单：每行一项、认手机备忘录的 □ ✓ - 1. 标记、保留原来的勾、进度 3/5");
}
// 3. 搜索
{
  const r = { subject: "社团例会", note: "带电脑和充电器", location: "A201", list: [{ t: "打印签到表" }] };
  assert.ok(M.match(r, "例会"));
  assert.ok(M.match(r, "签到 A201"));
  assert.ok(M.match(r, "a201"));
  assert.ok(!M.match(r, "例会 体育馆"));
  assert.ok(!M.match(r, "  "));
  assert.strictEqual(M.snippet(r, "充电"), "带电脑和充电器");
  ok("搜索：标题、备注、清单、地点都能搜，多个词都要出现");
}
// 4. 置顶
{
  assert.deepStrictEqual(M.pinned([{ id: 1, pin: true }, { id: 2 }, { id: 3, pin: true, done: true }]).map((x) => x.id), [1]);
  ok("置顶：做完的不再占着最上面");
}
console.log("备忘录：全部通过");
