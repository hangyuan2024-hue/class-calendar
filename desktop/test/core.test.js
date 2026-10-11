// 电脑版核心逻辑测试：node test/core.test.js
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { Api } = require("../core/api"), { Store } = require("../core/store"), remind = require("../core/remind"), assistant = require("../core/assistant"), M = require("../core/model");
const { createMock } = require("./mock-server");
const ok = (name) => console.log("✓", name);

(async () => {
  const today = M.dayKey(new Date()), tmr = M.dayKey(M.addDays(new Date(), 1));
  const mock = createMock({ items: [
    { id: 11, msg_type: "作业", subject: "高数习题 3.2", event_time: today + " 23:59", location: "" },
    { id: 12, msg_type: "会议", subject: "班会", event_time: tmr + " 15:00", location: "B302" },
  ], courses: { courses: [{ id: "a", name: "高等数学", day: M.weekday0(new Date()), start: 1, end: 2, wl: [], location: "A204", teacher: "张老师" }], meta: { times: ["08:00-08:45", "08:55-09:40"] } } });
  const url = await mock.listen();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const mkStore = (name) => {
    let sess = null;
    const api = new Api({ url, key: "anon", store: { load: () => sess, save: (s) => (sess = s) } });
    return new Store({ api, file: path.join(tmp, name + ".json") }).load();
  };

  // 登录
  const A = mkStore("a");
  await assert.rejects(A.login("hangyuan", "wrong"), /账号或密码错误/); ok("密码错时提示「账号或密码错误」");
  await A.login("HangYuan", "12345678");
  assert.strictEqual(A.snapshot().me.display_name, "杭远"); assert.strictEqual(A.snapshot().items.length, 2); assert.strictEqual(A.snapshot().courses.courses.length, 1); ok("登录后拿到个人信息、班级事项、课程表");

  // 我的事项 → 云端
  const rec = A.upsertMine({ subject: "买牙膏", event_time: tmr + " 18:00", location: "超市" });
  A.setDone("c11", true);
  A.setMark("c12", { note: "带笔记本" });
  await A.flush();
  assert.ok(mock.S.kv.find((x) => x.ns === "personal_events_v1" && x.k === rec.id)); assert.ok(mock.S.kv.find((x) => x.ns === "personal_marks_v1" && x.k === "c11" && x.v.done)); assert.ok(mock.S.kv.find((x) => x.ns === "done_log_v1" && x.k === "c11"));
  await new Promise((r) => setTimeout(r, 50)); assert.ok(mock.S.growth.find((g) => g.r === "11" && !g.undo)); ok("我的事项、完成、备注都传到云端；完成作业会记成长");

  // 另一台设备（比如网页版）拉下来
  const B = mkStore("b"); await B.login("hangyuan", "12345678");
  const bs = B.snapshot();
  assert.ok(bs.mine.find((x) => x.subject === "买牙膏")); assert.ok(bs.marks.c11.done); assert.strictEqual(bs.marks.c12.note, "带笔记本"); ok("另一台设备登录后，同步过来一样的数据");

  // 两边改同一条：以后改的为准；删除也同步
  B.upsertMine({ ...bs.mine[0], subject: "买牙膏和牙刷" }); await B.flush();
  await A.refresh(); assert.strictEqual(A.snapshot().mine[0].subject, "买牙膏和牙刷"); ok("别的设备改了，这边刷新后跟着变");
  A.deleteMine(rec.id); await A.flush(); await B.refresh(); assert.strictEqual(B.snapshot().mine.length, 0); ok("删除也会同步，不会被旧设备复活");

  // 拖拽改日期
  const r2 = A.upsertMine({ subject: "跑步", event_time: today + " 07:30" }); A.moveMine(r2.id, tmr);
  assert.strictEqual(A.snapshot().mine.find((x) => x.id === r2.id).event_time, tmr + " 07:30"); ok("拖到别的日子：日期变了，时间保留");

  // 断网：先存在本机，联网后再传
  mock.srv.close(); await new Promise((r) => setTimeout(r, 50));
  A.upsertMine({ subject: "断网时记的" });
  await A.refresh(); assert.strictEqual(A.snapshot().status.online, false); assert.ok(A.snapshot().pending >= 1); ok("断网时照常能记，标记成待上传");
  const A2 = mkStore("a"); assert.ok(A2.snapshot().mine.find((x) => x.subject === "断网时记的")); ok("关掉重开，本机数据还在");

  // 提醒
  const now = new Date(); now.setHours(23, 40, 0, 0);
  const snap = { ...A.snapshot(), settings: { ...A.snapshot().settings, remindBefore: 30 } };
  snap.marks = {}; const r = remind.due(snap, now, new Set());
  assert.ok(r.find((x) => x.kind === "item" && /高数习题/.test(x.title))); ok("作业截止前 30 分钟弹提醒：" + r.find((x) => x.kind === "item").title);
  const c8 = new Date(); c8.setHours(7, 52, 0, 0); const rc = remind.due(snap, c8, new Set());
  assert.ok(rc.find((x) => x.kind === "course")); ok("上课前 10 分钟提醒：" + rc.find((x) => x.kind === "course").title);
  const e20 = new Date(); e20.setHours(20, 1, 0, 0); const re = remind.due(snap, e20, new Set());
  assert.ok(re.find((x) => x.kind === "evening")); ok("晚上 8 点汇总明天：" + re.find((x) => x.kind === "evening").body);
  assert.strictEqual(remind.due(snap, e20, new Set(re.map((x) => x.id))).length, 0); ok("同一条提醒不会重复弹");

  // ====== 2.1 新加：和网页版 10 月新功能对齐 ======
  // 网页版新的数据类型、电脑版不认识的数据：都不丢
  mock.srv.listen(new URL(url).port, "127.0.0.1"); await new Promise((r) => setTimeout(r, 80));
  const C = mkStore("c"); await C.login("hangyuan", "12345678");
  mock.S.kv.push({ ns: "quad_todos_v1", k: "q1", v: { id: "q1", text: "旧待办" }, t: Date.now(), rev: ++mock.S.rev });
  mock.S.kv.push({ ns: "home_layout_v1", k: "_", v: { home: [{ id: "agenda" }] }, t: Date.now(), rev: ++mock.S.rev });
  mock.S.kv.push({ ns: "future_kind_v9", k: "x", v: { hello: 1 }, t: Date.now(), rev: ++mock.S.rev });
  await C.pull();
  assert.strictEqual(C.snapshot().kv.quad_todos_v1[0].text, "旧待办"); assert.ok(C.snapshot().kv.home_layout_v1.home);
  assert.deepStrictEqual(C.data.raw.future_kind_v9.x.v, { hello: 1 }); ok("网页版新加的数据类型能同步；还不认识的也原样保存，不会再丢");

  // 实时同步：别的设备改了，问一次就拉下来；顺便校准时钟
  const D = mkStore("d"); await D.login("hangyuan", "12345678");
  D.upsertMine({ subject: "D 记的" }); await D.flush();
  await C.ping(); assert.ok(C.snapshot().mine.find((x) => x.subject === "D 记的")); ok("实时同步：别的设备记的事，几秒内就过来了");
  mock.S.csig = 2; await C.ping(); await new Promise((r) => setTimeout(r, 50)); const n0 = mock.S.ctxN || 0;
  mock.S.csig = 3; await C.ping(); await new Promise((r) => setTimeout(r, 80)); assert.ok((mock.S.ctxN || 0) > n0); ok("老师改了班级事项：马上重新拿");

  // 课程表：保存时带上调课 / 调休，告诉别的设备课表变了
  mock.S.courses = { courses: [{ id: "a", name: "高等数学", day: 2, start: 1, end: 2, wl: [], location: "A204" }], meta: { week1: "2026-09-14", times: ["08:00-08:45", "08:55-09:40"], adj: [{ id: "j1", date: "2026-10-11", type: "swap", from: "2026-10-08" }] }, updated_at: "2026-10-10T00:00:00Z" };
  await C.loadCourses();
  await C.saveCourses(C.data.courses.courses.concat({ name: "体育", day: 4, start: 1, end: 2 }));
  assert.strictEqual(mock.S.courses.meta.adj.length, 1); ok("电脑上改课程表，不会冲掉网页版记的调课 / 调休");
  assert.ok(C.snapshot().kv.course_rev_v1 && C.snapshot().kv.course_rev_v1.at); await C.flush();
  const before = D.data.courses.courses.length; await D.pull(); await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(D.data.courses.courses.length, before + 1); ok("课表改了，别的设备跟着拿新课表");
  // 调课规则（和网页版同一套）
  const cs = { courses: [{ name: "高数", day: 3, start: 1, end: 2 }, { name: "英语", day: 3, start: 3, end: 4 }, { name: "体育", day: 4, start: 5, end: 6 }],
    meta: { week1: "2026-09-14", times: M.DEFAULT_TIMES, adj: [{ date: "2026-10-11", type: "swap", from: "2026-10-08" }, { date: "2026-10-08", type: "off" }, { date: "2026-10-15", type: "cancel", name: "英语" }, { date: "2026-10-15", type: "add", name: "补课", start: 9, end: 10 }] } };
  assert.deepStrictEqual(M.coursesOn(cs, M.fromKey("2026-10-11")).map((c) => c.name), ["高数", "英语"]);
  assert.strictEqual(M.coursesOn(cs, M.fromKey("2026-10-08")).length, 0);
  assert.deepStrictEqual(M.coursesOn(cs, M.fromKey("2026-10-15")).map((c) => c.name), ["高数", "补课"]);
  assert.strictEqual(M.dayNote(cs, "2026-10-11"), "上 10月8日（周四） 的课"); ok("调休换课、放假、停课、加课都按网页版的规则算");

  // 自己记的作业、「编辑（仅自己）」
  const hw = C.upsertMine({ subject: "自己的作业", kind: "作业", event_time: today });
  assert.strictEqual(M.allItems(C.snapshot()).find((x) => x.key === hw.id).type, "作业"); ok("自己记的作业算作业（作业页能看到）");
  C.data.items = mock.S.items.slice();
  const ov = C.overrideClassItem("c12", { subject: "班会（我改成 16 点）", event_time: tmr + " 16:00" });
  assert.ok(C.snapshot().marks.c12.hidden); assert.strictEqual(ov.from, "c12");
  C.deleteMine(ov.id); assert.ok(!(C.snapshot().marks.c12 || {}).hidden); ok("「编辑（仅自己）」：原来那条替我隐藏；删掉我的版本就恢复");

  // 过期 2 周自动删除（第一次先多留 3 天）
  const old = C.upsertMine({ subject: "很久以前", event_time: "2026-01-01" });
  C.data.flags.autodelGrace = false; C.cleanMine(); assert.ok(C.data.ns.personal_events_v1.find((x) => x.id === old.id).keep); ok("第一次用自动删除：已经过期的先多留 3 天");
  C.data.ns.personal_events_v1.find((x) => x.id === old.id).keep = "2026-01-02"; C.cleanMine(); await new Promise((r) => setTimeout(r, 50));
  assert.ok(!C.data.ns.personal_events_v1.find((x) => x.id === old.id)); assert.ok(mock.S.fileDel.includes(old.id)); ok("自己记的事过期 2 周自动删除，附件一起删");
  await C.loadExtras(); assert.strictEqual(C.snapshot().extras.files.c11, 2); ok("拿到每条事项的附件数量");

  // 注册
  const E = mkStore("e");
  await assert.rejects(E.signup("hangyuan", "12345678", { name: "x" }), /已经被注册/);
  assert.strictEqual(await E.api.anonRpc("account_available", { acct: "newbie" }), true);
  await E.signup("newbie", "abcdefgh", { name: "新同学", gender: "f", org: { type: "university", name: "某大学" } });
  assert.strictEqual(mock.S.users["u-2"].meta.org_name, "某大学"); ok("电脑上也能注册（含学校 / 单位），注册完直接登录");

  // AI 背景资料
  const ctx = assistant.context(snap, new Date());
  assert.ok(/高等数学/.test(ctx) && /高数习题/.test(ctx) && /班会/.test(ctx)); ok("AI 背景里有课表和作业（" + ctx.split("\n").length + " 行）");
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
