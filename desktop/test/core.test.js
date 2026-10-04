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

  // AI 背景资料
  const ctx = assistant.context(snap, new Date());
  assert.ok(/高等数学/.test(ctx) && /高数习题/.test(ctx) && /班会/.test(ctx)); ok("AI 背景里有课表和作业（" + ctx.split("\n").length + " 行）");
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
