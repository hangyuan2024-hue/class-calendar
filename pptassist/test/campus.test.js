// 模拟教务后端：数据互相对得上（没有排课冲突）、各种业务规则、多级审批、权限
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const C = require("../core/campus");
const ok = (m) => console.log("✓ " + m);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const NOW = new Date(2026, 10, 17, 10, 0);   // 2026-11-17 周二
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "campus-")), "campus.json");
const db = C.create({ file, now: () => NOW });
const T = db.tables(), I = db.identities();

// 1. 数据规模和一致性
const st = db.stats();
assert.ok(st.student === 360 && st.teacher >= 30 && st.room >= 30 && st.section > 100 && st.schedule > 80 && st.grade === st.enroll, JSON.stringify(st));
const cur = T.term.find((x) => x.current);
const seen = { t: new Set(), r: new Set(), c: new Set() };
for (const sc of T.schedule) {
  const s = T.section.find((x) => x.id === sc.section_id);
  for (const [k, v] of [["t", s.teacher_id], ["r", sc.room_id], ...s.class_ids.map((c) => ["c", c])]) { const key = `${v}|${sc.weekday}|${sc.start}`; assert.ok(!seen[k].has(key), "排课冲突：" + key); seen[k].add(key); }
  assert.ok(T.room.find((r) => r.id === sc.room_id).capacity >= s.capacity);
}
assert.ok(T.enroll.every((e) => T.student.some((s) => s.id === e.student_id) && T.section.some((s) => s.id === e.section_id)));
assert.equal(db.who(I.student).week, 10);
ok(`造出来的学校：${st.student} 个学生、${st.teacher} 位教师、${st.course} 门课、${st.section} 个教学班、${st.room} 间教室；排课没有教师 / 教室 / 班级冲突，外键都对得上；今天是第 10 周`);

// 2. 课表、成绩、考试
const tt = db.timetable(I.student);
assert.ok(tt.count >= 5 && tt.classes.every((c) => c.course && c.room && /^周/.test(c.weekday) && /^\d{4}-/.test(c.date)));
const g = db.grades(I.student);
assert.ok(g.published.length >= 5 && g.gpa > 0 && g.gpa <= 5 && g.pending.length >= 5 && g.published.every((x) => x.term !== cur.id));
assert.throws(() => db.grades(I.teacher, { section: "不存在的课" }), /只能看自己教学班/);
assert.ok(db.exams(I.student).exams.every((e) => e.date >= ymd(NOW)));
ok(`学生查课表（本周 ${tt.count} 次课）、成绩（上学期 ${g.published.length} 门已发布，绩点 ${g.gpa}；这学期的没发布不给看）、考试安排；教师只能看自己教学班的成绩`);

// 3. 请假：规则 + 多级审批
assert.throws(() => db.applyLeave(I.student, { from: "2026-11-10", to: "2026-11-10", reason: "x" }), /已经过去/);
assert.throws(() => db.applyLeave(I.student, { from: "2026-11-20", to: "2026-11-19", reason: "x" }), /不能早于/);
assert.throws(() => db.applyLeave(I.student, { from: "2026-11-20", to: "2026-11-20" }), /原因/);
assert.throws(() => db.applyLeave(I.teacher, { from: "2026-11-20", to: "2026-11-20", reason: "x" }), /只有学生/);
const l1 = db.applyLeave(I.student, { type: "事假", from: "2026-11-19", to: "2026-11-20", reason: "回家办事" });
assert.equal(l1.status, "待辅导员审批"); assert.equal(l1.flow, "辅导员"); assert.ok(l1.missed_classes.length >= 1);
assert.throws(() => db.applyLeave(I.student, { from: "2026-11-20", to: "2026-11-21", reason: "x" }), /时间重叠/);
assert.throws(() => db.approve(I.staff, { id: l1.id }), /要辅导员来批/);
assert.throws(() => db.approve({ role: "teacher", id: I.other }, { id: l1.id }), /要辅导员来批/);
assert.equal(db.pending(I.teacher).count, 1);
assert.equal(db.approve(I.teacher, { id: l1.id, ok: true }).status, "已批准");
const l2 = db.applyLeave(I.student, { type: "病假", from: "2026-11-23", to: "2026-12-02", reason: "手术" });
assert.equal(l2.flow, "辅导员 → 学院 → 教务处"); assert.match(l2.need, /医院证明/);
assert.equal(db.approve(I.teacher, { id: l2.id }).status, "待学院审批");
assert.equal(db.approve(I.staff, { id: l2.id }).status, "待教务处审批");
assert.equal(db.approve(I.staff, { id: l2.id, ok: false, comment: "证明不全" }).status, "已驳回");
assert.equal(db.myRequests(I.student).count, 2);
assert.throws(() => db.cancel(I.teacher, { id: l1.id }), /只能撤销自己/);
ok("请假：过去的日子、日期写反、没写原因、和已有的重叠都不让提交；1～3 天辅导员批，10 天要辅导员 → 学院 → 教务处；不该他批的人批不了；驳回、撤销");

// 4. 教师调课：自己有课 / 班级有课 / 教室被占都不行；批准以后课表跟着变
const tSecs = T.section.filter((s) => s.term_id === cur.id && s.teacher_id === I.teacher.id && T.schedule.some((x) => x.section_id === s.id));
if (tSecs.length) {
  const s = tSecs[0], sc = T.schedule.find((x) => x.section_id === s.id), cname = T.course.find((c) => c.id === s.course_id).name;
  assert.throws(() => db.applyAdjust(I.teacher, { course: cname, week: 10, weekday: sc.weekday, to_weekday: 3, to_start: 1, reason: "x" }), /明天以后|有别的课|自己有课/);
  assert.throws(() => db.applyAdjust(I.teacher, { course: cname, week: 12, weekday: sc.weekday, to_week: 12, to_weekday: sc.weekday, to_start: sc.start, reason: "开会" }), /自己有课|有别的课/);
  const a = db.applyAdjust(I.teacher, { course: cname, week: 12, weekday: sc.weekday, to_week: 12, to_weekday: 6, to_start: 3, reason: "出差开会" });
  assert.equal(a.status, "待教研室审批"); assert.match(a.to, /周六第 3-4 节/);
  assert.throws(() => db.applyAdjust(I.teacher, { course: cname, week: 12, weekday: sc.weekday, to_week: 12, to_weekday: 7, to_start: 3, reason: "x" }), /已经有一份/);
  const before = db.timetable(I.teacher, { week: 12 }).classes.filter((c) => c.section === s.id).map((c) => c.weekday);
  db.approve(I.staff, { id: a.id }); assert.equal(db.approve(I.staff, { id: a.id }).status, "已通过");
  const after = db.timetable(I.teacher, { week: 12 }).classes.filter((c) => c.section === s.id);
  assert.ok(after.some((c) => c.weekday === "周六" && c.note === "调课") && after.length === before.length);
  assert.ok(!db.freeRooms(I.teacher, { date: db.dateOf(12, 6), start: 3 }).rooms.some((r) => r.room === a.to.match(/节 (\S+)（/)[1]));
  ok("调课：调到自己有课 / 班上有课的时间不行，同一次课不能重复申请；教研室 → 教务处批完，课表里那次课挪到了周六，那间教室不再算空教室");
}
assert.throws(() => db.applyAdjust(I.student, { course: "x", reason: "x" }), /只有任课教师/);

// 5. 空教室、借教室
const fr = db.freeRooms(I.student, { date: "2026-11-19", start: 5, capacity: 100 });
assert.ok(fr.count > 0 && fr.rooms.every((r) => r.capacity >= 100));
const room = fr.rooms[0].room;
assert.throws(() => db.bookRoom(I.student, { room, date: "2026-11-17", start: 5, purpose: "班会" }), /提前 1 天/);
assert.throws(() => db.bookRoom(I.student, { room: "S1-101", date: "2026-11-19", start: 5, purpose: "班会" }), /不对外借用/);
const b = db.bookRoom(I.student, { room, date: "2026-11-19", start: 5, purpose: "班会" });
assert.equal(b.status, "待审批");
assert.throws(() => db.bookRoom(I.teacher, { room, date: "2026-11-19", start: 6, purpose: "讲座" }), /已经被借用/);
assert.ok(!db.freeRooms(I.student, { date: "2026-11-19", start: 5 }).rooms.some((r) => r.room === room));
assert.equal(db.approveNext(b.id).status, "已批准");
ok("空教室按容量查；借教室要提前一天、机房不外借、同一时间不能借两次；借出去的不再算空教室；「模拟审批」替该批的人批");

// 6. 选修课、证明、通知、撤销
const el = db.elective(I.student, { action: "list" });
const mineE = el.electives.filter((e) => e.selected);
for (const e of mineE) db.elective(I.student, { action: "drop", course: e.code });
const can = db.elective(I.student, { action: "list" }).electives.filter((e) => e.left > 0);
db.elective(I.student, { action: "select", course: can[0].course });
assert.throws(() => db.elective(I.student, { action: "select", course: can[0].code }), /已经选过/);
const cert = db.applyCert(I.student, { kind: "在读证明" });
assert.match(cert.text, /全日制在读学生/); assert.match(cert.verify_code, /^\d{8}$/);
assert.match(db.applyCert(I.student, { kind: "成绩单" }).text, /平均学分绩点/);
assert.equal(db.notices(I.student, { keyword: "请假" }).notices[0].title, "学生请假管理办法（修订）");
assert.throws(() => db.cancel(I.student, { id: cert.id }), /撤不了/);
ok("选修课：看名额、选、退、重复选不行；开在读证明 / 成绩单（带核验码）；按关键词查规定");

// 7. 存盘、重来；给智能体的工具
const db2 = C.create({ file, now: () => NOW });
assert.equal(db2.myRequests(I.student).count, db.myRequests(I.student).count);
assert.ok(db2.tables().audit.length >= 8);
const tools = db.tools(() => I.student);
assert.ok(tools.length >= 14 && tools.every((t) => t.name && t.desc && typeof t.run === "function" && typeof t.say === "function"));
assert.equal(tools.find((t) => t.name === "campus_whoami").run({}).role, "学生");
db.reset(); assert.equal(db.myRequests(I.student).count, 0);
const later = C.create({ file, now: () => add(NOW, 200) });
assert.ok(Math.abs(later.who(I.student).week - 10) <= 1, "换学期了重新造数据");
ok("申请存在本机，重开还在（带操作日志）；能一键恢复成刚造出来的样子；隔了半年自动换成新学期；给智能体的 " + tools.length + " 个工具");
console.log("模拟教务后端：全部通过");
