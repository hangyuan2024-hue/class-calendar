// 捞捞教练（coach-core.js）：和安卓 Coach.kt 用同样的例子
const assert = require("assert");
const C = require("../coach-core.js");
const now = new Date(2026, 9, 17, 19, 0);           // 周六 19:00
const T = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();
const ok = (s) => console.log("✓ " + s);

// 1. 可信度
{
  const log = [
    { t: T(17, 10), e: "done", k: "a", y: "作业", d: T(17, 22) },
    { t: T(17, 11), e: "done", k: "b", y: "作业" }, { t: T(17, 11, 5), e: "undo", k: "b" },       // 勾了又取消
    { t: T(17, 12, 0), e: "done", k: "c1" }, { t: T(17, 12, 0) + 10000, e: "done", k: "c2" }, { t: T(17, 12, 0) + 20000, e: "done", k: "c3" }, { t: T(17, 12, 0) + 30000, e: "done", k: "c4" }, { t: T(17, 12, 0) + 40000, e: "done", k: "c5" },
    { t: T(17, 14), e: "pomo", m: 25 },
    { t: T(17, 15), e: "done", k: "old", d: T(5, 12) },                                      // 过期 12 天才勾
  ];
  const cr = C.credible(log), w = (k) => cr.find((r) => r.k === k).w;
  assert.strictEqual(w("a"), 1); assert.strictEqual(w("b"), 0);
  assert.deepStrictEqual(["c1", "c2", "c3", "c4", "c5"].map(w), [1, 1, 0.3, 0.3, 0.3]);
  assert.strictEqual(w("old"), 0.5);
  assert.strictEqual(cr.find((r) => r.y === "pomo").w, 1);
  const m = C.learn(log, now);
  assert.strictEqual(m.day["2026-10-17"], 5.4);          // 1 + 0 + (1+1+0.3×3) + 番茄 1 + 0.5
  assert.ok(m.sus >= 4);
  assert.deepStrictEqual(m.lead, [12]);
  ok("可信度：取消的不算、连着勾的打折、过期很久的算一半、番茄钟算数");
}
// 2. 连续天数、小目标
{
  const day = {}; for (let i = 1; i <= 6; i++) day[`2026-10-${String(17 - i).padStart(2, "0")}`] = [2, 3, 4, 3, 5, 2][i - 1];
  const m = C.combine([{ v: 1, h: Array(24).fill(0), w: Array(7).fill(0), day, lead: [], sty: {}, sus: 0, n: 19 }]);
  const st = C.streak(m, now);
  assert.strictEqual(st.days, 6); assert.strictEqual(st.atRisk, true);
  const g = C.goal(m, now);
  assert.strictEqual(g.cap, 3); assert.strictEqual(g.target, 4);
  ok("连续 6 天、晚上还没做 → 提醒快断了；小目标 = 中位数 3 × 1.1 → 4");
}
// 3. 推荐
{
  const ranked = [
    { kind: "item", key: "hw", title: "高数作业", type: "作业", level: "urgent", score: 60, reason: "还剩 3 小时" },
    { kind: "item", key: "words", title: "背单词", type: "个人", level: "soon", score: 30, reason: "还剩 2 天" },
    { kind: "item", key: "meet", title: "班会", type: "会议", level: "soon", score: 80, reason: "2 天后开始" },
    { kind: "item", key: "conf", title: "26年换届暨总结表彰大会", type: "个人", time: "12:30", location: "中快三楼", level: "soon", score: 90, reason: "1 天后开始" },
    { kind: "item", key: "talk", title: "讲座", type: "活动", time: "19:20", level: "soon", score: 85, reason: "1 天后开始" },
  ];
  const m = C.combine([]);
  const s = C.suggest({ now, ranked, model: m, log: [], rnd: 0.9 });
  assert.strictEqual(s.mode, "go"); assert.strictEqual(s.top.key, "hw"); assert.ok(s.top.step.includes("番茄"));
  const s2 = C.suggest({ now, ranked, model: m, log: [], skip: { hw: now.getTime() + 3600000 }, rnd: 0.9 });
  assert.strictEqual(s2.top.key, "words");
  assert.ok(!s.alts.some((a) => a.key === "meet" || a.key === "conf" || a.key === "talk"));
  const onlyMeet = C.suggest({ now, ranked: ranked.slice(2), model: m, log: [], rnd: 0.9 });
  assert.strictEqual(onlyMeet.mode, "free");   // 只剩会议 / 讲座：不推荐它们，改成番茄复习
  assert.ok(C.doable({ kind: "item", title: "讲座报名", type: "通知", time: "12:00" }));
  assert.ok(C.doable({ kind: "item", title: "答辩PPT", type: "个人", time: "20:00" }));
  assert.ok(!C.doable({ kind: "item", title: "牙医", type: "个人", time: "09:30" }));
  const night = C.suggest({ now: new Date(2026, 9, 17, 23, 30), ranked: [ranked[1]], model: m, log: [], rnd: 0.9 });
  assert.strictEqual(night.mode, "sleep");
  const tired = C.suggest({ now, ranked: [ranked[1]], model: m, log: [{ t: now.getTime() - 3000000, e: "pomo", m: 50 }, { t: now.getTime() - 1500000, e: "pomo", m: 25 }], rnd: 0.9 });
  assert.strictEqual(tired.mode, "rest");
  const cls = C.suggest({ now, ranked: [{ kind: "course", key: "c", title: "线代", level: "now", score: 96, reason: "正在上课" }].concat(ranked), model: m, log: [], rnd: 0.9 });
  assert.strictEqual(cls.mode, "class");
  const busy = C.suggest({ now, ranked: [{ kind: "item", key: "zx", title: "晚自习", type: "通知", time: "18:30", level: "now", score: 125, reason: "进行中" }].concat(ranked), model: m, log: [], rnd: 0.9 });
  assert.strictEqual(busy.mode, "class"); assert.ok(busy.say.includes("晚自习"));
  assert.strictEqual(C.deck({ now, ranked: [{ kind: "item", key: "zx", title: "党课", type: "活动", time: "19:00", level: "now", score: 125 }] }).end, "class");
  ok("6.3 正在上晚自习、开会、参加活动：不催作业，刷任务也不开");
  ok("推荐：最急的先做、换一个、会议讲座不推荐、深夜劝睡、专注太久劝休息、上课时不打扰");
}
// 4. 说法会学：哪种提示被接受得多就多用
{
  const m = C.combine([{ v: 1, h: Array(24).fill(0), w: Array(7).fill(0), day: {}, lead: [], sty: { step: [10, 1], deadline: [10, 8] }, sus: 0, n: 0 }]);
  assert.strictEqual(C.pickStyle(m, ["step", "deadline"], 0.9), "deadline");
  ok("提示风格：被接受得多的说法优先");
}
// 5. 提醒时间
{
  const h = Array(24).fill(0); h[15] = 10; h[20] = 8;
  const day = { "2026-10-16": 3, "2026-10-15": 3 };
  const m = C.combine([{ v: 1, h, w: Array(7).fill(0), day, lead: [], sty: {}, sus: 0, n: 21 }]);
  const morning = new Date(2026, 9, 18, 9, 0);                // 周日上午
  const ns = C.nudges({ now: morning, model: m, ranked: [{ kind: "item", key: "a", title: "英语作文", level: "soon", score: 20 }], courses: [] });
  assert.deepStrictEqual(ns.map((x) => x.kind), ["best", "weekly"]);   // 18 号还没断（17 号没记录 → 连续 0 天）
  assert.strictEqual(new Date(ns[0].at).getHours(), 15);
  ok("提醒：挑你状态最好的钟点、周日晚上复盘，一天最多 3 条");
}
// 6. 每周复盘
{
  const day = { "2026-10-12": 2, "2026-10-13": 3, "2026-10-14": 4, "2026-10-15": 2, "2026-10-16": 3, "2026-10-05": 1, "2026-10-06": 2 };
  const m = C.combine([{ v: 1, h: Array(24).fill(0), w: Array(7).fill(0), day, lead: [1, 2, 1], sty: {}, sus: 5, n: 17 }]);
  const r = C.weekly(m, now);
  assert.strictEqual(r.thisWeek.done, 14); assert.strictEqual(r.lastWeek.done, 3); assert.strictEqual(r.thisWeek.days, 5);
  assert.ok(r.highlights[0].includes("多完成了 11 件"));
  assert.ok(r.next.some((x) => x.includes("提前一天")));
  assert.ok(r.next.some((x) => x.includes("一口气")));
  ok("每周复盘：对比上周、坚持天数、作业拖延、假完成提醒");
}
// 7. 刷任务
{
  const ranked = [
    { kind: "item", key: "a", title: "数学作业", type: "作业", level: "soon", score: 90 },
    { kind: "item", key: "b", title: "英语单词", type: "个人", level: "later", score: 50 },
    { kind: "item", key: "c", title: "物理小测", type: "个人", exam: true, level: "later", score: 40 },
    { kind: "item", key: "z", title: "过期的", level: "past", score: 99 },
    { kind: "item", key: "m", title: "表彰大会", type: "个人", time: "12:30", level: "soon", score: 95 },
  ];
  const d = C.deck({ now, ranked, skip: { b: now.getTime() + 1000 } });
  const ks = d.cards.map((c) => c.kind + (c.min || "") + (c.key || "")).join(",");
  assert.strictEqual(ks, "start2a,work5a,work10a,checka,start2c,work5c,work10c,checkc,break3,start2review,review5review,review10review,end");
  assert.strictEqual(d.work, 51);
  assert.ok(d.cards[0].step.includes("第一题"));
  assert.ok(d.cards[4].step.includes("3 个重点"));
  assert.strictEqual(C.deck({ now: new Date(2026, 9, 17, 23, 30), ranked }).end, "sleep");
  assert.strictEqual(C.deck({ now, ranked: [{ kind: "course", level: "now", title: "语文", key: "k" }] }).end, "class");
  assert.strictEqual(C.awayCredit(5 * 60000, 2 * 60000), 2 * 60000);
  assert.strictEqual(C.awayCredit(31 * 60000, 2 * 60000), -1);
  const cr = C.credible([{ t: T(17, 9), e: "flow", m: 5 }, { t: T(17, 9, 10), e: "flow", m: 1 }]);
  assert.deepStrictEqual(cr.map((r) => r.w), [0.2, 0]);
  ok("刷任务：先 2 分钟开头、过期和换掉的不出现、25 分钟后插休息、50 分钟一轮、深夜和上课不刷");
}
// 8. 随机掉落
{
  const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
  let r = C.roll(null, 2, now, seq([0.99, 0.5, 0]));             // 今天第一张：必掉；0.5 → 普通；第 0 个
  assert.strictEqual(r.got.id, "star"); assert.ok(r.first); assert.strictEqual(r.bag.dn, 1);
  r = C.roll(r.bag, 5, now, seq([0.5]));                          // 第二张 5 分钟：概率 0.4，0.5 没中
  assert.strictEqual(r.got, null);
  r = C.roll(r.bag, 10, now, seq([0.1, 0.5, 0]));                 // 10 分钟 0.8：中；普通的第 0 个 → 重复，给 1 片碎片
  assert.ok(r.dup); assert.strictEqual(r.bag.sh, 1); assert.strictEqual(r.bag.own.star, 2);
  r = C.roll(r.bag, 10, now, seq([0.1, 0.01, 0.99]));              // 传说
  assert.strictEqual(r.got.r, 3); assert.strictEqual(r.bag.pity, 0);
  let b = r.bag; b.pity = 7;
  r = C.roll(b, 10, now, seq([0.1, 0.9, 0]));                      // 保底：连着 8 次普通 → 稀有
  assert.strictEqual(r.got.r, 1);
  b = C.bag({ v: 1, own: {}, sh: 0, day: "2026-10-17", dn: 10 }, now);
  assert.ok(C.roll(b, 10, now, seq([0])).cap);                     // 一天最多掉 10 个
  assert.strictEqual(C.bag({ v: 1, day: "2026-10-16", dn: 10 }, now).dn, 0);   // 第二天重新算
  assert.strictEqual(C.roll(null, 1, now, seq([0])).got, null);    // 不到 2 分钟不掉
  let rd = C.redeem({ v: 1, own: {}, sh: 12 }, "fox", now);
  assert.ok(rd.ok); assert.strictEqual(rd.bag.sh, 2);
  assert.ok(!C.redeem(rd.bag, "crown", now).ok);
  const mg = C.mergeBag({ v: 1, own: { star: 1 }, sh: 3 }, [{ own: { star: 4, fox: 1 } }], now);
  assert.deepStrictEqual([mg.own.star, mg.own.fox, mg.sh, C.owned(mg)], [4, 1, 3, 2]);
  assert.strictEqual(C.LOOT.length, 34);
  assert.strictEqual(C.roomLine({ now: 7, today_min: 230, streak: 3 }), "班里现在 7 人在专注 · 今天全班 230 分钟 · 班级连续 3 天");
  ok("随机掉落：第一张必掉、越久越容易掉、保底、每天上限、重复给碎片、碎片兑换、多设备合并");
}
console.log("捞捞教练：全部通过");

// 6.3 island-core：「X 点之前完成」是截止不是开始；「最该先做」不挑已经结束的会
{
  const I = require("../island-core.js");
  const at = (h, mi) => new Date(2026, 9, 18, h, mi);
  assert.strictEqual(I.startInfo({ type: "通知", day: "2026-10-18", time: "18:30", summary: "今天晚上需要上晚自习，并且在6:30之前完成钉钉位置签到" }, at(18, 40)), null);
  assert.strictEqual(I.startInfo({ type: "会议", day: "2026-10-18", time: "18:30", summary: "班会" }, at(18, 40)).st, "now");
  const g = I.greet({ now: at(22, 6), name: "杭远", items: [
    { key: "m", title: "中快三楼开展换届大会", type: "个人", day: "2026-10-18", time: "20:50" },
    { key: "h", title: "离散数学", type: "作业", day: "2026-10-20", time: "" }], courses: [] });
  assert.ok(!g.includes("换届大会") && g.includes("离散数学"), g);
  console.log("✓ 6.3「6:30之前签到」不显示进行中；「最该先做」不挑已经开完的会");
}
