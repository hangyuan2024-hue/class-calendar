// 6.8 闲时自学：拿本班发布过的事项自己考自己，学完以后准确率要涨，而且不能把本来对的带偏
const assert = require("assert");
const P = require("../parse.js"), T = require("../lao-train.js");
const ok = (m) => console.log("✓ " + m);

// 本班的说法：地点叫「创客空间」「三食堂二楼」，「单片机」是「单片机原理」，第3-4节是 10:00，「素拓」算活动
const pubs = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
const recs = [];
const add = (text, pub, it) => recs.push({ original: "班长：" + text, publish_date: pub, summary: text, prepare: "", ...it });
pubs.forEach((p, i) => {
  const d = (n) => { const x = new Date(p + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  add(`明天第3-4节单片机实验课在创客空间上${i ? "，带好开发板" : ""}`, p, { msg_type: "通知", subject: "单片机原理", event_time: d(1) + " 10:00", location: "创客空间" });
  add(`周三晚上7点三食堂二楼素拓${["活动", "", "，记得穿运动服", "", "，签到", ""][i]}`, p, { msg_type: "活动", subject: "素拓", event_time: d(2) + " 19:00", location: "三食堂二楼" });
  add(`单片机第${i + 2}次作业后天交`, p, { msg_type: "作业", subject: "单片机原理", event_time: d(2), location: "" });
  add(`周五下午创客空间值班表第${i + 1}周排好了，按表来`, p, { msg_type: "通知", subject: "创客空间值班", event_time: d(4), location: "创客空间" });
});
const samples = T.corpus(recs, [], (o) => o.replace(/^[^：:]{1,8}[：:]/, ""));
assert.ok(samples.length >= 18, "同样的原文合成一道题");

const m = P.createModel();
const j = T.job(P, m, samples, { testShare: 34 });
let guard = 0; while (!j.step(50) && guard++ < 2000);
const r = j.report();
console.log("  自学报告：", JSON.stringify({ ...r, before: r.before.toFixed(3), after: r.after.toFixed(3) }));
assert.ok(r.test >= 3 && r.train >= 6, "留出考卷");
assert.ok(r.after > r.before, "学完以后考卷准确率要涨");
assert.ok(r.learned > 0);
ok(`闲时自学：考卷准确率 ${(r.before * 100).toFixed(0)}% → ${(r.after * 100).toFixed(0)}%，学了 ${r.learned} 条`);

// 新消息（没见过的原文）也受益：地名、课程叫法、节次时间
const x = P.parse("下周一第3-4节单片机在创客空间上", "2026-10-19", { model: m }).items[0];
assert.strictEqual(x.location, "创客空间");
assert.strictEqual(x.event_time, "2026-10-26 10:00");
assert.strictEqual(x.subject, "单片机原理");
ok("学到的地名、课程叫法、节次时间用在没见过的新消息上");

// 存起来、换个模型装回去，效果一样
const saved = { rows: j.rows(), cfg: r.cfg };
const m2 = P.createModel(); T.replay(m2, JSON.parse(JSON.stringify(saved)));
const y = P.parse("下周一第3-4节单片机在创客空间上", "2026-10-19", { model: m2 }).items[0];
assert.deepStrictEqual([y.location, y.event_time, y.subject], [x.location, x.event_time, x.subject]);
ok("自学结果能存下来，下次打开直接装回去");

// 本来规则就对的通知，学完以后还是对的（不带偏）
const plain = "明天下午2点在教三201开班会，记得带学生证";
const a = P.parse(plain, "2026-10-18").items[0], b = P.parse(plain, "2026-10-18", { model: m }).items[0];
assert.deepStrictEqual([b.msg_type, b.event_time, b.location, b.subject], [a.msg_type, a.event_time, a.location, a.subject]);
ok("不把规则本来就对的带偏");

// 什么时候学：后台 / 没人操作 / 夜里
const noon = new Date(2026, 9, 19, 12, 0).getTime(), night = new Date(2026, 9, 19, 23, 30).getTime();
assert.ok(!T.isQuiet(noon - 5000, noon, false));
assert.ok(T.isQuiet(noon - 30000, noon, true));
assert.ok(T.isQuiet(noon - 130000, noon, false));
assert.ok(T.isQuiet(night - 40000, night, false));
assert.ok(T.due(null, 10) && !T.due({ at: noon, samples: 10 }, 11, noon + 60000) && T.due({ at: noon, samples: 10 }, 30, noon + 11 * 60000));
ok("只在后台、没人操作或夜里学；题库没怎么变就不重复学");

// 打分：标题相似就算对、多整理出来的扣分
const g = T.grade({ items: [{ msg_type: "通知", subject: "期中教学检查：填写表格", event_time: "2026-10-19 10:00", location: "" }] },
  { items: [{ msg_type: "通知", subject: "期中教学检查：填写在线电子表格", event_time: "2026-10-19 10:00", location: "" }] });
assert.strictEqual(g.score, 1);
ok("打分规则");
