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
  // 6.4 群消息里的停课 / 不上晚自习 / 换课 → 课表调整建议（2026-10-18 是周日）
  const A = (t, o) => P.adjustments(t, "2026-10-18", { eveningName: "晚自习", courseNames: ["高等数学"], ...(o || {}) }).map((a) => [a.type, a.date, a.name || a.from || ""]);
  assert.deepStrictEqual(A("下周一和周二晚上都不上晚自习，下周一没课班级去参加讲座，下周二晚上有计算机专业认知教育，各班班长负责好考勤"),
    [["cancel", "2026-10-19", "晚自习"], ["cancel", "2026-10-20", "晚自习"]]);
  assert.deepStrictEqual(A("10月20日至22日停课").map((x) => x[1]), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepStrictEqual(A("明天放假"), [["off", "2026-10-19", ""]]);
  assert.deepStrictEqual(A("周三的高等数学不上了"), [["cancel", "2026-10-21", "高等数学"]]);
  assert.deepStrictEqual(A("下周六上周三的课")[0].slice(0, 2), ["swap", "2026-10-24"]);
  assert.deepStrictEqual(A("没课的同学去参加讲座，今晚晚自习照常"), []);
  ok("群消息：不上晚自习、停课、放假、调课都认成课表调整；「没课的班级」「照常」不误删");
  // 6.5 早自习：和晚自习同一套（调休、停课、催作业），排在当天最前面；群消息里能分清停的是哪个
  const mo = { on: true, days: [0, 1, 2, 3, 4], t0: "07:20", t1: "07:55" }, ev2 = { on: true, days: [0, 1, 2, 3, 4], t0: "18:30", t1: "21:00" };
  const both = I.withEvening([{ name: "高等数学", t0: "08:00", t1: "09:35" }], ev2, "2026-10-19", [], mo);
  assert.deepStrictEqual(both.map((c) => c.name), ["高等数学", "早自习", "晚自习"]);
  assert.ok(both[1].morning && both[1].evening && both[1].study && !both[2].morning);
  assert.deepStrictEqual(I.withEvening([], ev2, "2026-10-19", [{ type: "cancel", date: "2026-10-19", name: "早自习" }], mo).map((c) => c.name), ["晚自习"]);
  assert.strictEqual(I.morning(mo, "2026-10-24", [{ type: "swap", date: "2026-10-24", from: "2026-10-21" }]).length, 1, "周六上周三的课：早自习也上");
  assert.strictEqual(I.morning(mo, "2026-10-20", [{ type: "off", date: "2026-10-20" }]).length, 0);
  const B = (t) => P.adjustments(t, "2026-10-18", { eveningName: "晚自习", morningName: "早自习" }).map((a) => [a.date, a.name]);
  assert.deepStrictEqual(B("明天不上早自习，晚自习照常"), [["2026-10-19", "早自习"]]);
  assert.deepStrictEqual(B("下周一早自习取消，晚自习也取消"), [["2026-10-19", "早自习"], ["2026-10-19", "晚自习"]]);
  const at2 = new Date(2026, 9, 19, 7, 30);
  const its2 = [{ _key: "h", msg_type: "作业", subject: "英语作文", event_time: "2026-10-19 23:59" }];
  const cs = C.suggest({ now: at2, ranked: I.rank(its2, both.map((c) => ({ ...c, day: "2026-10-19" })), at2) });
  assert.notStrictEqual(cs.mode, "class", "早自习（催我写作业）不算上课");
  ok("早自习：排在最前、跟着调休 / 停课、群消息分得清早晚自习、教练照样催作业");
  // 6.6 一句话里好几件事、干扰信息多：标题像样、日期对、地点完整、去掉「收到请回复」和署名；总结一句一件
  const msgs = ["下周一和周二晚上都不上晚自习，下周一没课班级去参加讲座，下周二晚上有计算机专业认知教育，各班班长负责好考勤，提前到场，领导们会参会。大家组织好学生",
    "@全体成员 明天下午2点在教三201开班会，记得带学生证；另外周五前把实验报告交给学委，逾期不收！！收到请回复",
    "【通知】各位同学：本周四（10月22日）上午9:00-11:00 体测，地点东操场，穿运动鞋；体测结束后10月23日之前在学习通完成心理健康问卷。辅导员 王老师"].join("\n");
  const pr = P.parse(msgs, "2026-10-18").items, byS = (s) => pr.find((x) => x.subject === s);
  assert.deepStrictEqual(pr.map((x) => x.subject), ["讲座", "计算机专业认知教育", "班会", "交实验报告", "体测", "心理健康问卷填写"]);
  assert.strictEqual(byS("计算机专业认知教育").msg_type, "活动");
  assert.strictEqual(byS("体测").event_time, "2026-10-22 09:00", "括号里的具体日期优先；周日说的「本周四」是接下来那个周四");
  assert.strictEqual(byS("体测").location, "东操场");
  assert.ok(!/收到请回复|王老师|@/.test(pr.map((x) => x.summary).join("")), "去掉收到请回复、署名、@");
  const dg = P.digest(pr, "2026-10-18");
  assert.ok(/一共 6 件事/.test(dg.text) && dg.lines[0] === "明天：讲座" && dg.lines.includes("10月23日（周五）前：交实验报告"));
  assert.ok(/最该先做的是「离散数学作业」/.test(I.greet({ now: new Date(2026, 9, 19, 14, 41), items: [{ key: "a", title: "讲座", type: "通知", day: "2026-10-19", time: "19:20" }, { key: "b", title: "离散数学作业", type: "作业", day: "2026-10-21" }], courses: [] })));
  assert.ok(!/最该先做的是「讲座」/.test(I.greet({ now: new Date(2026, 9, 19, 14, 41), items: [{ key: "a", title: "讲座", type: "通知", day: "2026-10-19", time: "19:20" }], courses: [] })));
  ok("群消息整理：一句多事、干扰多也能拆对，标题像样、括号日期优先、去掉收到请回复和署名；总结一句一件；讲座不说「最该先做」");
  // 6.7 只说了钟点没说日子：就是发消息这天（提醒核实）；「场务就可以来了」→「场务到场」
  const cw = P.parse("场务12:05就可以来了 有课的下课抓紧时间来", "2026-10-19").items;
  assert.deepStrictEqual(cw.map((x) => [x.event_time, x.subject, x.need_confirm]), [["2026-10-19 12:05", "场务到场", true]]);
  assert.strictEqual(P.parse("这个题12点之前能做完吗", "2026-10-19").items.length, 0, "随口问的不算");
  ok("只说钟点的通知：算发消息当天、标题「场务到场」");
  console.log("文档导入 / 晚自习：全部通过");
})().catch((e) => { console.error("✗", e); process.exit(1); });
