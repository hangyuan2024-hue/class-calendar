// node test/doc.test.js —— 6.3 文档 / 表格导入、晚自习。安卓 CoreTest.kt 用同样的例子。
const assert = require("assert"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const P = require("../parse.js"), D = require("../docx-text.js"), I = require("../island-core.js");
const ok = (s) => console.log("✓ " + s);
(async () => {
  // 1. 表格：按表头认列，格子里的「结 业」拼回去，一行一件事
  const t = "表2 面授课程教学安排\n专题 主讲内容 主讲人 授课地点 授课时间\n开班式 党课党史学习教育开班仪式 科教分子 活动中心 10月18日 19:30-21:30\n结 业 习近平新时代中国特色社会主义思想 科教分子 活动中心 10月31日 19:30-21:00\n四、培训纪律要求";
  const r = P.parse(t, "2026-10-18");
  assert.deepStrictEqual(r.items.map((x) => [x.msg_type, x.event_time, x.subject, x.location]), [
    ["活动", "2026-10-18 19:30", "开班式：党课党史学习教育开班仪式", "活动中心"],
    ["活动", "2026-10-31 19:30", "结业：习近平新时代中国特色社会主义思想", "活动中心"]]);
  ok("表格：认表头、时间从右边认、地点对上、「结 业」拼回去");
  // 2. Word 文档：表格每一行一行字
  const txt = await D.read(fs.readFileSync(path.join(__dirname, "sample-table.docx")), (b) => zlib.inflateRawSync(b));
  assert.ok(txt.includes("开班式 党课党史学习教育开班仪式 科教分子 活动中心 10月18日 19:30-21:30"), txt);
  assert.strictEqual(P.parse(txt, "2026-10-18").items.filter((x) => x.via === "table").length, 2);
  await assert.rejects(D.read(Buffer.from("%PDF-1.4"), null), /PDF/);
  await assert.rejects(D.read(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), null), /\.doc/);
  ok("Word 文档：正文一段一行、表格一行一行，PDF / 老 .doc 给出提示");
  // 3. 晚自习：选中的几天当成最后一节课
  const ev = { on: true, name: "晚自习", days: [0, 1, 2, 3, 4], t0: "18:30", t1: "21:00", location: "教二 305" };
  assert.strictEqual(I.evening(ev, "2026-10-19").length, 1);          // 周一
  assert.strictEqual(I.evening(ev, "2026-10-18").length, 0);          // 周日
  assert.strictEqual(I.evening({ ...ev, on: false }, "2026-10-19").length, 0);
  const ranked = I.rank([], I.withEvening([], ev, "2026-10-19").map((c) => ({ ...c, day: "2026-10-19" })), new Date(2026, 9, 19, 19, 0));
  assert.strictEqual(ranked[0].level, "now");
  ok("晚自习：选中的那几天到点算「上课中」");
  // 4. 晚自习跟着调休走：放假没有；周六上周三的课 → 周六也有；停课写了「晚自习」那天没有
  const adj = [{ date: "2026-10-19", type: "off" }, { date: "2026-10-24", type: "swap", from: "2026-10-21" }, { date: "2026-10-22", type: "cancel", name: "晚自习" }];
  assert.strictEqual(I.evening(ev, "2026-10-19", adj).length, 0);
  assert.strictEqual(I.evening(ev, "2026-10-24", adj).length, 1);
  assert.strictEqual(I.evening(ev, "2026-10-22", adj).length, 0);
  assert.strictEqual(I.evening(ev, "2026-10-23", adj).length, 1);
  ok("晚自习跟着调课 / 调休：放假、换课、停课");
  // 5. 晚自习默认「催我写作业」：教练照样推荐、作业排前面；设成「别打扰」就进上课模式
  const C = require("../coach-core.js"), at = new Date(2026, 9, 20, 19, 0);
  const items = [{ key: "a", title: "背单词", type: "个人", day: "2026-10-21" }, { key: "h", title: "离散数学", type: "作业", day: "2026-10-22" }];
  const sug = (e) => C.suggest({ now: at, ranked: I.rank(items, I.withEvening([], e, "2026-10-20").map((c) => ({ ...c, day: "2026-10-20" })), at), model: C.combine([]), log: [], rnd: 0.9 });
  const s1 = sug(ev); assert.strictEqual(s1.mode, "go"); assert.strictEqual(s1.top.key, "h"); assert.ok(s1.say.includes("晚自习"), s1.say);
  assert.strictEqual(sug({ ...ev, study: false }).mode, "class");
  assert.ok(C.deck({ now: at, ranked: I.rank(items, I.withEvening([], ev, "2026-10-20").map((c) => ({ ...c, day: "2026-10-20" })), at) }).cards.length > 0);
  ok("晚自习默认催写作业（作业排前面、刷任务照样能刷），设成「别打扰」就不打扰");
  console.log("文档导入 / 晚自习：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
