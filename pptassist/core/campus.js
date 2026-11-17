// 捞捞PPT助手 · 模拟教务后端（成品展示用，全部是编出来的假数据，不连任何真的学校系统）
//   照着高校教务系统的样子搭的：学期、院系、专业、行政班、学籍、教师、课程、教学班（教学任务）、排课、选课结果、
//   成绩、考试安排、教室、请假申请（多级审批）、调停课申请、教室借用、证明开具、通知公告、操作日志。
//   表和表之间用编号关联（学号、工号、课程代码、教学班号……），业务规则也照真的来：
//     · 请假：3 天以内辅导员批；超过 3 天加学院；超过 7 天再加教务处；和已有的请假、考试冲突要提示
//     · 调课：新时间上教师、教室、上课的班都不能有课；先教研室再教务处
//     · 选课：容量、时间冲突、学分上限；退选只能退选修
//     · 借教室：那个时间教室没课、没被借
//     · 成绩：学生只能看自己已经发布的；教师只能看自己教学班的
//   以后接真的教务系统：把这个文件换成调学校接口的同名函数就行，上面的智能体不用改。
"use strict";
const fs = require("fs");
const path = require("path");

const PERIODS = [null, "08:00", "08:50", "10:00", "10:50", "14:00", "14:50", "16:00", "16:50", "19:00", "19:50"];   // 第 1～10 节的上课时间
const WD = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim()); if (!m) throw new Error("日期要写成 2026-11-17 这样"); return new Date(+m[1], +m[2] - 1, +m[3]); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 造数据 ----------
const XING = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵";
const MING = ["子涵", "雨桐", "浩然", "欣怡", "梓轩", "思远", "一鸣", "晓彤", "嘉豪", "诗雨", "俊杰", "若曦", "宇航", "佳怡", "天佑", "梦瑶", "博文", "语嫣", "志强", "静怡", "明轩", "可馨", "睿", "婷", "磊", "敏", "涛", "倩", "鹏", "琳", "昊天", "紫萱", "建国", "秀英", "文博", "雅琪"];
const DEPTS = [
  { id: "01", name: "计算机与人工智能学院", majors: [["0101", "计算机科学与技术"], ["0102", "人工智能"]] },
  { id: "02", name: "电子信息工程学院", majors: [["0201", "电子信息工程"], ["0202", "通信工程"]] },
  { id: "03", name: "经济管理学院", majors: [["0301", "会计学"], ["0302", "工商管理"]] },
];
const COURSES = {
  "01": [["CS1001", "C语言程序设计", 4, "考试"], ["CS1002", "数据结构", 4, "考试"], ["CS2001", "操作系统", 3, "考试"], ["CS2002", "计算机网络", 3, "考试"], ["CS2003", "数据库原理", 3, "考试"], ["AI2001", "机器学习导论", 3, "考查"], ["AI2002", "Python程序设计", 2, "考查"]],
  "02": [["EE1001", "电路分析", 4, "考试"], ["EE1002", "模拟电子技术", 4, "考试"], ["EE2001", "信号与系统", 3, "考试"], ["EE2002", "数字信号处理", 3, "考试"], ["EE2003", "通信原理", 3, "考试"], ["EE2004", "单片机原理", 2, "考查"]],
  "03": [["EM1001", "管理学原理", 3, "考试"], ["EM1002", "微观经济学", 3, "考试"], ["EM2001", "基础会计", 4, "考试"], ["EM2002", "财务管理", 3, "考试"], ["EM2003", "市场营销", 2, "考查"], ["EM2004", "统计学", 3, "考试"]],
  pub: [["GB1001", "高等数学A", 4, "考试"], ["GB1002", "大学英语", 2, "考试"], ["GB1003", "大学物理", 3, "考试"], ["GB1004", "思想道德与法治", 2, "考查"], ["GB1005", "体育", 1, "考查"], ["GB1006", "线性代数", 3, "考试"]],
  elective: [["GX3001", "影视鉴赏", 2], ["GX3002", "心理健康与成长", 2], ["GX3003", "创新创业基础", 2], ["GX3004", "摄影基础", 2], ["GX3005", "人工智能通识", 2], ["GX3006", "中国传统文化", 2], ["GX3007", "音乐欣赏", 2], ["GX3008", "演讲与口才", 2]],
};

function build(seed, today) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const name = () => XING[Math.floor(R() * XING.length)] + pick(MING);
  // 学期：这学期从 9 周以前的那个周一开始（所以「今天」是第 10 周左右），一共 18 周
  const mon = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(mon, -9 * 7);
  const y = start.getFullYear(), autumn = start.getMonth() >= 6;
  const cur = autumn ? `${y}-${y + 1}-1` : `${y - 1}-${y}-2`;
  const prev = autumn ? `${y - 1}-${y}-2` : `${y - 1}-${y}-1`;
  const T = { term: [{ id: prev, name: prev.replace(/-(\d)$/, " 学年第 $1 学期"), start: ymd(addDays(start, -26 * 7)), weeks: 18, current: 0 }, { id: cur, name: cur.replace(/-(\d)$/, " 学年第 $1 学期"), start: ymd(start), weeks: 18, current: 1 }],
    dept: [], major: [], class: [], teacher: [], student: [], course: [], room: [], section: [], schedule: [], enroll: [], grade: [], exam: [], leave: [], adjust: [], booking: [], cert: [], notice: [], audit: [], seq: { leave: 0, adjust: 0, booking: 0, cert: 0, audit: 0 } };
  // 教室
  for (const [b, n, cap, type] of [["J1", 12, 60, "多媒体教室"], ["J2", 10, 120, "多媒体教室"], ["S1", 6, 50, "机房"], ["S2", 4, 40, "实验室"], ["J3", 6, 200, "阶梯教室"]]) for (let i = 0; i < n; i++) T.room.push({ id: `${b}-${1 + Math.floor(i / 4)}${pad(1 + (i % 4))}`, building: b, capacity: cap, type });
  // 院系、专业、课程、教师、行政班、学生
  let tno = 0;
  const teacher = (dept) => { const t = { id: "T" + (2008 + Math.floor(R() * 15)) + pad(++tno, 3), name: name(), dept_id: dept, title: pick(["讲师", "讲师", "副教授", "副教授", "教授", "助教"]) }; T.teacher.push(t); return t; };
  for (const [id, n, credit, exam] of COURSES.pub) T.course.push({ id, name: n, credit, hours: credit * 16, type: "必修", dept_id: "00", exam_type: exam });
  for (const [id, n, credit] of COURSES.elective) T.course.push({ id, name: n, credit, hours: credit * 16, type: "选修", dept_id: "00", exam_type: "考查" });
  T.dept.push({ id: "00", name: "公共基础教学部" });
  const pubT = Array.from({ length: 8 }, () => teacher("00"));
  for (const d of DEPTS) {
    T.dept.push({ id: d.id, name: d.name });
    const ts = Array.from({ length: 8 }, () => teacher(d.id));
    for (const [id, n, credit, exam] of COURSES[d.id]) T.course.push({ id, name: n, credit, hours: credit * 16, type: "必修", dept_id: d.id, exam_type: exam });
    for (const [mid, mname] of d.majors) {
      T.major.push({ id: mid, dept_id: d.id, name: mname, years: 4 });
      for (const grade of [y - (autumn ? 0 : 1) - 1, y - (autumn ? 0 : 1) - 2]) {   // 大二、大三各一个班
        const cid = `${grade}${mid}01`;
        T.class.push({ id: cid, major_id: mid, grade, name: `${mname}${String(grade).slice(2)}01班`, counselor_id: pick(ts).id });
        for (let i = 1; i <= 30; i++) T.student.push({ id: cid + pad(i), name: name(), gender: R() < 0.5 ? "男" : "女", class_id: cid, status: "在读", enroll_year: grade });
      }
    }
  }
  // 教学班 + 排课：教师、教室、上课的班在同一个时间都不能有两门课
  const busy = { t: new Set(), r: new Set(), c: new Set() };
  let sno = 0;
  function openSection(term, course, tch, classes, cap, slots, sched) {
    const s = { id: `${term.replace(/\D/g, "").slice(2)}${pad(++sno, 4)}`, term_id: term, course_id: course.id, teacher_id: tch.id, capacity: cap, class_ids: classes };
    T.section.push(s);
    if (!sched) return s;
    const rooms = T.room.filter((r) => r.capacity >= cap && r.type !== "实验室");
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < slots; tries++) {
      const wd = 1 + Math.floor(R() * 5), st = classes.length ? pick([1, 3, 5, 7]) : 9, room = pick(rooms);
      const kT = `${tch.id}|${wd}|${st}`, kR = `${room.id}|${wd}|${st}`, kC = classes.map((c) => `${c}|${wd}|${st}`);
      if (busy.t.has(kT) || busy.r.has(kR) || kC.some((k) => busy.c.has(k))) continue;
      busy.t.add(kT); busy.r.add(kR); kC.forEach((k) => busy.c.add(k));
      T.schedule.push({ id: T.schedule.length + 1, section_id: s.id, weekday: wd, start: st, span: 2, room_id: room.id, weeks: "1-16" });
      placed++;
    }
    return s;
  }
  const byId = (t, id) => T[t].find((x) => x.id === id);
  for (const term of [prev, cur]) {
    const isCur = term === cur;
    for (const c of T.class) {
      const dept = byId("major", c.major_id).dept_id;
      const own = COURSES[dept], idx = (c.grade + (isCur ? 1 : 0)) % 2;
      const list = [...own.filter((_, i) => i % 2 === idx).slice(0, 3), ...COURSES.pub.filter((_, i) => i % 2 === (isCur ? 0 : 1)).slice(0, 3)];
      for (const [cid] of list) {
        const course = byId("course", cid);
        const tch = pick(T.teacher.filter((t) => t.dept_id === course.dept_id));
        const s = openSection(term, course, tch, [c.id], 30, course.credit >= 4 ? 2 : 1, isCur);
        for (const stu of T.student.filter((x) => x.class_id === c.id)) T.enroll.push({ student_id: stu.id, section_id: s.id, kind: "必修" });
      }
    }
    if (isCur) for (const [cid] of COURSES.elective) { const s = openSection(term, byId("course", cid), pick(pubT), [], 60, 1, true); const n = 20 + Math.floor(R() * 38); for (const stu of T.student.slice().sort(() => R() - 0.5).slice(0, n)) T.enroll.push({ student_id: stu.id, section_id: s.id, kind: "选修" }); }
  }
  // 成绩：上学期的都发布了；这学期只有平时成绩，还没发布
  for (const e of T.enroll) {
    const s = byId("section", e.section_id), isCur = s.term_id === cur;
    const base = 55 + R() * 40, usual = Math.round(Math.min(100, base + R() * 12));
    if (isCur) { T.grade.push({ student_id: e.student_id, section_id: s.id, usual, final: null, total: null, point: null, status: "正常", published: 0 }); continue; }
    const fin = Math.round(Math.max(20, Math.min(100, base + (R() - 0.5) * 24))), total = Math.round(usual * 0.4 + fin * 0.6);
    T.grade.push({ student_id: e.student_id, section_id: s.id, usual, final: fin, total, point: total >= 60 ? Math.round((total - 50)) / 10 : 0, status: "正常", published: 1 });
  }
  // 考试安排：考试课在第 17、18 周；有的课下周有期中考
  for (const s of T.section.filter((x) => x.term_id === cur)) {
    const c = byId("course", s.course_id); if (c.exam_type !== "考试") continue;
    const sc = T.schedule.find((x) => x.section_id === s.id); if (!sc) continue;
    T.exam.push({ id: T.exam.length + 1, section_id: s.id, kind: "期末", date: ymd(addDays(start, (16 + Math.floor(R() * 2)) * 7 + Math.floor(R() * 5))), start: pick(["09:00", "14:00"]), minutes: 120, room_id: sc.room_id });
    if (R() < 0.35) T.exam.push({ id: T.exam.length + 1, section_id: s.id, kind: "期中", date: ymd(addDays(mon, 7 + sc.weekday - 1)), start: PERIODS[sc.start], minutes: 90, room_id: sc.room_id });
  }
  T.notice = [
    { id: 1, title: "关于本学期期末考试安排的通知", dept: "教务处", date: ymd(addDays(today, -3)), body: "期末考试安排在第 17、18 周，具体时间地点请在教务系统「考试安排」中查询。因病因事不能参加考试的同学，须在考前办理缓考手续。" },
    { id: 2, title: "下学期通识选修课选课通知", dept: "教务处", date: ymd(addDays(today, -6)), body: "下学期通识选修课选课分两轮进行，每人每学期选修课不超过 2 门、总学分不超过 30 学分。本学期选修课退选截止到第 12 周周五。" },
    { id: 3, title: "学生请假管理办法（修订）", dept: "学生工作处", date: ymd(addDays(today, -20)), body: "请假 3 天以内由辅导员审批；3 天以上、7 天以内须经学院审批；7 天以上须报教务处备案审批。病假须附医院证明。假满须销假。" },
    { id: 4, title: "关于教室借用的说明", dept: "教务处", date: ymd(addDays(today, -30)), body: "学生社团、班级活动借用教室，须至少提前 1 天在系统中申请；机房、实验室不对外借用。" },
    { id: 5, title: "四六级考试报名通知", dept: "教务处", date: ymd(addDays(today, -1)), body: "全国大学英语四、六级考试报名已经开始，请在规定时间内完成报名和缴费。" },
  ];
  T.meta = { seed, built: ymd(today), school: "捞捞学院（演示用，数据都是编的）" };
  return T;
}

// ---------- 后端 ----------
function create(opt = {}) {
  const now = opt.now || (() => new Date());
  const file = opt.file || null;
  let T = null;
  const save = () => { if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(T)); } };
  function load() {
    if (T) return T;
    if (file) { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && j.meta && j.student) T = j; } catch (e) {} }
    // 换学期了（造数据那天离今天太远）：重新造一份，不然「今天」落在学期外面
    if (T && Math.abs(parseYmd(T.meta.built) - now()) > 40 * 86400e3) T = null;
    if (!T) { T = build(opt.seed || 20261117, now()); save(); }
    return T;
  }
  const reset = () => { T = build(opt.seed || 20261117, now()); save(); return true; };
  const one = (t, id) => load()[t].find((x) => x.id === id);
  const curTerm = () => load().term.find((x) => x.current);
  const termStart = () => parseYmd(curTerm().start);
  const weekOf = (d) => Math.floor((d - termStart()) / (7 * 86400e3)) + 1;
  const wdOf = (d) => ((d.getDay() + 6) % 7) + 1;
  const dateOf = (week, wd) => addDays(termStart(), (week - 1) * 7 + wd - 1);
  const inWeeks = (sc, week) => { const [a, b] = sc.weeks.split("-").map(Number); return week >= a && week <= b; };
  const log = (actor, action, detail) => { const t = load(); t.audit.push({ id: ++t.seq.audit, time: new Date(now()).toISOString(), actor: actor.id, role: actor.role, action, detail }); if (t.audit.length > 500) t.audit.shift(); };
  const courseOf = (sec) => one("course", sec.course_id);
  const secLabel = (sec) => `${courseOf(sec).name}（${one("teacher", sec.teacher_id).name}）`;
  const slotText = (sc) => `${WD[sc.weekday]}第 ${sc.start}-${sc.start + sc.span - 1} 节（${PERIODS[sc.start]} 上课）${sc.room_id}`;

  // 身份：学生 / 教师（同时是某个班的辅导员）/ 教务员
  function identities() {
    const t = load(), stu = t.student[0], cls = one("class", stu.class_id), tch = one("teacher", cls.counselor_id);
    const mine = t.section.find((s) => s.term_id === curTerm().id && s.teacher_id !== tch.id && t.schedule.some((x) => x.section_id === s.id));
    return { student: { role: "student", id: stu.id, name: stu.name, note: `${cls.name}的学生` }, teacher: { role: "teacher", id: tch.id, name: tch.name, note: `${one("dept", tch.dept_id).name}教师、${cls.name}辅导员` },
      staff: { role: "staff", id: "A0001", name: "教务员小捞", note: "教务处工作人员" }, other: mine ? one("teacher", mine.teacher_id).id : tch.id };
  }
  function who(actor) {
    const t = load(), d = now(), wk = weekOf(d);
    const base = { school: t.meta.school, term: curTerm().name, today: ymd(d), weekday: WD[wdOf(d)], week: wk };
    if (actor.role === "student") { const s = one("student", actor.id), c = one("class", s.class_id), m = one("major", c.major_id); return { ...base, role: "学生", id: s.id, name: s.name, class: c.name, major: m.name, dept: one("dept", m.dept_id).name, counselor: one("teacher", c.counselor_id).name, status: s.status }; }
    if (actor.role === "teacher") { const x = one("teacher", actor.id); return { ...base, role: "教师", id: x.id, name: x.name, title: x.title, dept: one("dept", x.dept_id).name, counselor_of: t.class.filter((c) => c.counselor_id === x.id).map((c) => c.name) }; }
    return { ...base, role: "教务员", id: actor.id, name: "教务员小捞", dept: "教务处" };
  }
  // 某个人这学期的教学班
  function sectionsOf(actor) {
    const t = load(), term = curTerm().id;
    if (actor.role === "teacher") return t.section.filter((s) => s.term_id === term && s.teacher_id === actor.id);
    if (actor.role === "student") { const ids = new Set(t.enroll.filter((e) => e.student_id === actor.id).map((e) => e.section_id)); return t.section.filter((s) => s.term_id === term && ids.has(s.id)); }
    return [];
  }
  // 课表（week 不写就是本周；day 写 1～7 只看那一天）。已经批准的调课算进去
  function timetable(actor, { week, day } = {}) {
    const t = load(), wk = +week || weekOf(now());
    const secs = sectionsOf(actor), out = [];
    for (const s of secs) for (const sc of t.schedule.filter((x) => x.section_id === s.id && inWeeks(x, wk))) {
      const adj = t.adjust.find((a) => a.status === "已通过" && a.schedule_id === sc.id && a.from_week === wk);
      if (adj) continue;   // 这一次停了，或者调到别的时间了（调过去的在下面加）
      out.push({ weekday: sc.weekday, start: sc.start, span: sc.span, time: PERIODS[sc.start], course: courseOf(s).name, teacher: one("teacher", s.teacher_id).name, room: sc.room_id, section: s.id });
    }
    for (const a of t.adjust.filter((x) => x.status === "已通过" && x.kind === "调课" && x.to_week === wk)) { const s = one("section", a.section_id); if (secs.includes(s)) out.push({ weekday: a.to_weekday, start: a.to_start, span: 2, time: PERIODS[a.to_start], course: courseOf(s).name, teacher: one("teacher", s.teacher_id).name, room: a.to_room, section: s.id, note: "调课" }); }
    const rows = out.filter((x) => !day || x.weekday === +day).sort((a, b) => a.weekday - b.weekday || a.start - b.start).map((x) => ({ ...x, date: ymd(dateOf(wk, x.weekday)), weekday: WD[x.weekday] }));
    return { week: wk, count: rows.length, classes: rows };
  }
  // 成绩
  function grades(actor, { term, section } = {}) {
    const t = load();
    if (actor.role === "student") {
      const rows = t.grade.filter((g) => g.student_id === actor.id).map((g) => ({ g, s: one("section", g.section_id) })).filter((x) => (term ? x.s.term_id === term : true));
      const pub = rows.filter((x) => x.g.published);
      const cr = (x) => courseOf(x.s).credit;
      const sumC = pub.reduce((a, x) => a + cr(x), 0);
      return { published: pub.map((x) => ({ term: x.s.term_id, course: courseOf(x.s).name, credit: cr(x), usual: x.g.usual, final: x.g.final, total: x.g.total, point: x.g.point, pass: x.g.total >= 60 })),
        gpa: sumC ? Math.round((pub.reduce((a, x) => a + x.g.point * cr(x), 0) / sumC) * 100) / 100 : null, credits: pub.filter((x) => x.g.total >= 60).reduce((a, x) => a + cr(x), 0), failed: pub.filter((x) => x.g.total < 60).map((x) => courseOf(x.s).name),
        pending: rows.filter((x) => !x.g.published).map((x) => ({ course: courseOf(x.s).name, note: "这学期的课，期末成绩还没发布" })) };
    }
    if (actor.role === "teacher") {
      const mine = sectionsOf(actor); const s = section ? mine.find((x) => x.id === String(section) || courseOf(x).name.includes(String(section))) : mine[0];
      if (!s) throw new Error("只能看自己教学班的成绩：这学期您教的是 " + (mine.map(secLabel).join("、") || "（没有教学任务）"));
      const gs = t.grade.filter((g) => g.section_id === s.id);
      return { section: s.id, course: courseOf(s).name, students: gs.length, usual_avg: Math.round(gs.reduce((a, g) => a + g.usual, 0) / Math.max(1, gs.length)), lowest: gs.slice().sort((a, b) => a.usual - b.usual).slice(0, 5).map((g) => ({ id: g.student_id, name: one("student", g.student_id).name, usual: g.usual })), note: "期末成绩还没录入" };
    }
    throw new Error("教务员查成绩请到成绩管理模块（演示里没做）");
  }
  function exams(actor) {
    const t = load(), ids = new Set(sectionsOf(actor).map((s) => s.id)), td = ymd(now());
    const rows = t.exam.filter((e) => ids.has(e.section_id) && e.date >= td).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ course: courseOf(one("section", e.section_id)).name, kind: e.kind, date: e.date, weekday: WD[wdOf(parseYmd(e.date))], start: e.start, minutes: e.minutes, room: e.room_id }));
    return { count: rows.length, exams: rows };
  }
  // 某一天某几节，哪些地方有课 / 被借了
  function taken(date, start, span) {
    const t = load(), d = parseYmd(date), wk = weekOf(d), wd = wdOf(d), hit = (s2, n2) => s2 < start + span && start < s2 + n2;
    const rooms = new Set(), teachers = new Set(), classes = new Set();
    for (const sc of t.schedule) {
      if (sc.weekday !== wd || !inWeeks(sc, wk) || !hit(sc.start, sc.span)) continue;
      if (t.adjust.some((a) => a.status === "已通过" && a.schedule_id === sc.id && a.from_week === wk)) continue;
      const s = one("section", sc.section_id); rooms.add(sc.room_id); teachers.add(s.teacher_id); s.class_ids.forEach((c) => classes.add(c));
    }
    for (const a of t.adjust) if (["已通过", "待教研室审批", "待教务处审批"].includes(a.status) && a.kind === "调课" && a.to_week === wk && a.to_weekday === wd && hit(a.to_start, 2)) { const s = one("section", a.section_id); rooms.add(a.to_room); teachers.add(s.teacher_id); s.class_ids.forEach((c) => classes.add(c)); }
    for (const b of t.booking) if (["待审批", "已批准"].includes(b.status) && b.date === date && hit(b.start, b.span)) rooms.add(b.room_id);
    return { rooms, teachers, classes, week: wk, weekday: wd };
  }
  function freeRooms(actor, { date, start, span = 2, capacity = 0, type } = {}) {
    date = date || ymd(now()); start = +start; span = +span || 2;
    if (!(start >= 1 && start + span - 1 <= 10)) throw new Error("节次是第 1～10 节（1-2 节上午第一大节，9-10 节晚上）");
    const tk = taken(date, start, span);
    const rows = load().room.filter((r) => !tk.rooms.has(r.id) && r.capacity >= (+capacity || 0) && (!type || r.type.includes(type)));
    return { date, weekday: WD[tk.weekday], week: tk.week, periods: `第 ${start}-${start + span - 1} 节`, count: rows.length, rooms: rows.slice(0, 12).map((r) => ({ room: r.id, capacity: r.capacity, type: r.type })) };
  }
  // ---- 请假 ----
  function applyLeave(actor, { type = "事假", from, to, reason, proof } = {}) {
    if (actor.role !== "student") throw new Error("只有学生能提交请假申请");
    const t = load(), a = parseYmd(from), b = parseYmd(to || from);
    if (b < a) throw new Error("结束日期不能早于开始日期");
    if (ymd(b) < ymd(now())) throw new Error("不能给已经过去的日子请假（补假请找辅导员线下办理）");
    if (!["事假", "病假", "公假"].includes(type)) throw new Error("请假类型只有：事假、病假、公假");
    if (!String(reason || "").trim()) throw new Error("要写请假原因");
    const days = Math.round((b - a) / 86400e3) + 1;
    if (days > 30) throw new Error("一次请假不能超过 30 天（更长请办理休学）");
    const clash = t.leave.find((l) => l.student_id === actor.id && !["已驳回", "已撤销"].includes(l.status) && l.from <= ymd(b) && ymd(a) <= l.to);
    if (clash) throw new Error(`和已有的请假 ${clash.id}（${clash.from} 到 ${clash.to}，${clash.status}）时间重叠`);
    // 请假期间要缺哪些课、有没有考试
    const miss = [], secs = sectionsOf(actor);
    for (let d = new Date(a); d <= b; d = addDays(d, 1)) { const r = timetable(actor, { week: weekOf(d), day: wdOf(d) }); for (const c of r.classes) miss.push(`${ymd(d)} ${c.weekday}第 ${c.start}-${c.start + c.span - 1} 节 ${c.course}`); }
    const ex = t.exam.filter((e) => secs.some((s) => s.id === e.section_id) && e.date >= ymd(a) && e.date <= ymd(b)).map((e) => `${e.date} ${courseOf(one("section", e.section_id)).name}${e.kind}考试`);
    const steps = ["辅导员", ...(days > 3 ? ["学院"] : []), ...(days > 7 ? ["教务处"] : [])];
    const l = { id: "QJ" + ymd(now()).replace(/-/g, "") + pad(++t.seq.leave, 3), student_id: actor.id, type, from: ymd(a), to: ymd(b), days, reason: String(reason).slice(0, 200), proof: !!proof, steps, step: 0, status: `待${steps[0]}审批`, approvals: [], created: ymd(now()), missed: miss.length };
    t.leave.push(l); log(actor, "提交请假", l.id); save();
    return { id: l.id, status: l.status, days, flow: steps.join(" → "), missed_classes: miss.slice(0, 12), ...(ex.length ? { exams_in_leave: ex, warn: "请假期间有考试：不能参加的话要另外办缓考手续" } : {}), ...(type === "病假" && !proof ? { need: "病假要补交医院证明，辅导员审批时会看" } : {}) };
  }
  // ---- 调课 / 停课（教师）----
  function applyAdjust(actor, { course, week, weekday, to_week, to_weekday, to_start, room, reason, kind = "调课" } = {}) {
    if (actor.role !== "teacher") throw new Error("只有任课教师能申请调停课");
    const t = load(), mine = sectionsOf(actor);
    const s = mine.find((x) => x.id === String(course) || courseOf(x).name.includes(String(course || "")));
    if (!s || !course) throw new Error("这学期您教的课是：" + (mine.map((x) => courseOf(x).name).join("、") || "（没有）") + "。要调哪一门？");
    week = +week || weekOf(now());
    const scs = t.schedule.filter((x) => x.section_id === s.id);
    const sc = scs.find((x) => x.weekday === +weekday) || (scs.length === 1 ? scs[0] : null);
    if (!sc) throw new Error(`「${courseOf(s).name}」每周上课时间：${scs.map(slotText).join("；")}。要调哪一次（周几）？`);
    if (ymd(dateOf(week, sc.weekday)) <= ymd(now())) throw new Error("要调的那次课必须在明天以后（至少提前 1 天申请）");
    if (t.adjust.some((a) => a.schedule_id === sc.id && a.from_week === week && !["已驳回", "已撤销"].includes(a.status))) throw new Error("这次课已经有一份调停课申请了");
    if (!String(reason || "").trim()) throw new Error("要写调停课原因");
    const a = { id: "TK" + ymd(now()).replace(/-/g, "") + pad(++t.seq.adjust, 3), kind: kind === "停课" ? "停课" : "调课", teacher_id: actor.id, section_id: s.id, schedule_id: sc.id, from_week: week, from_weekday: sc.weekday, from_start: sc.start, reason: String(reason).slice(0, 200), steps: ["教研室", "教务处"], step: 0, status: "待教研室审批", approvals: [], created: ymd(now()) };
    if (a.kind === "调课") {
      to_week = +to_week || week; to_weekday = +to_weekday; to_start = +to_start;
      if (!(to_weekday >= 1 && to_weekday <= 7) || ![1, 3, 5, 7, 9].includes(to_start)) throw new Error("要说清楚调到周几、第几节开始（1、3、5、7、9 节开始的大节）");
      const date = ymd(dateOf(to_week, to_weekday));
      if (date <= ymd(now())) throw new Error("调到的时间必须在明天以后");
      const tk = taken(date, to_start, 2);
      if (tk.teachers.has(actor.id)) throw new Error(`${date} ${WD[to_weekday]}第 ${to_start}-${to_start + 1} 节您自己有课`);
      const cc = s.class_ids.filter((c) => tk.classes.has(c)); if (cc.length) throw new Error(`${date} 第 ${to_start}-${to_start + 1} 节 ${cc.map((c) => one("class", c).name).join("、")} 有别的课，学生上不了`);
      const need = t.enroll.filter((e) => e.section_id === s.id).length;
      let r = room ? one("room", String(room).toUpperCase()) : null;
      if (room && !r) throw new Error("没有这个教室：" + room);
      if (r && (tk.rooms.has(r.id) || r.capacity < need)) throw new Error(`${r.id} 那个时间${tk.rooms.has(r.id) ? "有课或被借用了" : `坐不下（${r.capacity} 座，上课 ${need} 人）`}`);
      if (!r) r = t.room.find((x) => !tk.rooms.has(x.id) && x.capacity >= need && x.type === one("room", sc.room_id).type) || t.room.find((x) => !tk.rooms.has(x.id) && x.capacity >= need);
      if (!r) throw new Error("那个时间没有空教室");
      Object.assign(a, { to_week, to_weekday, to_start, to_room: r.id });
    }
    t.adjust.push(a); log(actor, "提交" + a.kind, a.id); save();
    return { id: a.id, kind: a.kind, status: a.status, course: courseOf(s).name, from: `第 ${week} 周${WD[sc.weekday]}第 ${sc.start}-${sc.start + 1} 节 ${sc.room_id}`, ...(a.kind === "调课" ? { to: `第 ${a.to_week} 周${WD[a.to_weekday]}第 ${a.to_start}-${a.to_start + 1} 节 ${a.to_room}（${ymd(dateOf(a.to_week, a.to_weekday))}）` } : {}), flow: "教研室 → 教务处", students: t.enroll.filter((e) => e.section_id === s.id).length };
  }
  // ---- 借教室 ----
  function bookRoom(actor, { room, date, start, span = 2, purpose } = {}) {
    const t = load(); const r = one("room", String(room || "").toUpperCase());
    if (!r) throw new Error("没有这个教室（教室编号像 J1-101；可以先查空教室）");
    if (["机房", "实验室"].includes(r.type)) throw new Error(`${r.id} 是${r.type}，不对外借用`);
    start = +start; span = +span || 2;
    if (!(start >= 1 && start + span - 1 <= 10)) throw new Error("节次是第 1～10 节");
    if (!date || date <= ymd(now())) throw new Error("借教室至少提前 1 天申请");
    if (!String(purpose || "").trim()) throw new Error("要写借用用途");
    if (taken(date, start, span).rooms.has(r.id)) throw new Error(`${date} 第 ${start}-${start + span - 1} 节 ${r.id} 有课或已经被借用了：换个时间，或者先查空教室`);
    const b = { id: "JY" + ymd(now()).replace(/-/g, "") + pad(++t.seq.booking, 3), applicant_id: actor.id, role: actor.role, room_id: r.id, date, start, span, purpose: String(purpose).slice(0, 100), status: "待审批", steps: ["教务处"], step: 0, approvals: [], created: ymd(now()) };
    t.booking.push(b); log(actor, "借教室", b.id); save();
    return { id: b.id, status: b.status, room: r.id, capacity: r.capacity, date, periods: `第 ${start}-${start + span - 1} 节（${PERIODS[start]} 开始）`, flow: "教务处" };
  }
  // ---- 证明 ----
  function applyCert(actor, { kind = "在读证明" } = {}) {
    if (actor.role !== "student") throw new Error("只有学生能申请开证明");
    if (!["在读证明", "成绩单"].includes(kind)) throw new Error("能开的证明：在读证明、成绩单");
    const t = load(), w = who(actor);
    if (w.status !== "在读") throw new Error("学籍状态不是在读，开不了");
    const c = { id: "ZM" + ymd(now()).replace(/-/g, "") + pad(++t.seq.cert, 3), student_id: actor.id, kind, status: "已出具", code: Math.abs(Math.imul(t.seq.cert * 2654435761, 97) % 1e8).toString().padStart(8, "0"), created: ymd(now()) };
    t.cert.push(c); log(actor, "开证明", c.id); save();
    const g = kind === "成绩单" ? grades(actor) : null;
    return { id: c.id, kind, status: c.status, verify_code: c.code, text: kind === "在读证明" ? `兹证明 ${w.name}（学号 ${w.id}）系我校${w.dept}${w.major}专业${w.class}全日制在读学生。特此证明。` : `${w.name}（学号 ${w.id}）已修课程 ${g.published.length} 门，获得学分 ${g.credits}，平均学分绩点 ${g.gpa}。`, note: "电子版已生成，盖章纸质版到教务处窗口领取（演示）" };
  }
  // ---- 选修课 ----
  function elective(actor, { action = "list", course } = {}) {
    if (actor.role !== "student") throw new Error("只有学生能选课");
    const t = load(), term = curTerm().id;
    const secs = t.section.filter((s) => s.term_id === term && courseOf(s).type === "选修");
    const mine = new Set(t.enroll.filter((e) => e.student_id === actor.id).map((e) => e.section_id));
    const info = (s) => { const sc = t.schedule.find((x) => x.section_id === s.id); return { course: courseOf(s).name, code: s.course_id, credit: courseOf(s).credit, teacher: one("teacher", s.teacher_id).name, time: sc ? slotText(sc) : "", left: s.capacity - t.enroll.filter((e) => e.section_id === s.id).length, selected: mine.has(s.id) }; };
    if (action === "list") return { count: secs.length, electives: secs.map(info) };
    const s = secs.find((x) => x.course_id === String(course).toUpperCase() || courseOf(x).name.includes(String(course || "\u0000")));
    if (!s) throw new Error("没有这门选修课：" + (course || "") + "。先看看能选哪些");
    if (action === "drop") {
      if (!mine.has(s.id)) throw new Error(`你没选「${courseOf(s).name}」`);
      if (weekOf(now()) > 12) throw new Error("退选截止到第 12 周，已经过了");
      t.enroll = t.enroll.filter((e) => !(e.student_id === actor.id && e.section_id === s.id)); t.grade = t.grade.filter((g) => !(g.student_id === actor.id && g.section_id === s.id));
      log(actor, "退选", s.id); save(); return { ok: true, dropped: courseOf(s).name };
    }
    if (action !== "select") throw new Error("action 只能是 list、select、drop");
    if (mine.has(s.id)) throw new Error(`「${courseOf(s).name}」已经选过了`);
    if (info(s).left <= 0) throw new Error(`「${courseOf(s).name}」人满了（容量 ${s.capacity}）`);
    const myE = secs.filter((x) => mine.has(x.id));
    if (myE.length >= 2) throw new Error(`每学期选修课最多 2 门，你已经选了：${myE.map((x) => courseOf(x).name).join("、")}`);
    const credits = sectionsOf(actor).reduce((a, x) => a + courseOf(x).credit, 0);
    if (credits + courseOf(s).credit > 30) throw new Error(`选了就超过学分上限了（已有 ${credits} 学分，上限 30）`);
    const sc = t.schedule.find((x) => x.section_id === s.id);
    const clash = sc && sectionsOf(actor).flatMap((x) => t.schedule.filter((y) => y.section_id === x.id).map((y) => [x, y])).find(([, y]) => y.weekday === sc.weekday && y.start < sc.start + sc.span && sc.start < y.start + y.span);
    if (clash) throw new Error(`和「${courseOf(clash[0]).name}」（${slotText(clash[1])}）时间冲突`);
    t.enroll.push({ student_id: actor.id, section_id: s.id, kind: "选修" }); t.grade.push({ student_id: actor.id, section_id: s.id, usual: 0, final: null, total: null, point: null, status: "正常", published: 0 });
    log(actor, "选课", s.id); save();
    return { ok: true, selected: courseOf(s).name, time: sc ? slotText(sc) : "", credits: credits + courseOf(s).credit };
  }
  function notices(actor, { keyword } = {}) { const k = String(keyword || "").trim(); const rows = load().notice.filter((n) => !k || (n.title + n.body).includes(k)).sort((a, b) => b.date.localeCompare(a.date)); return { count: rows.length, notices: rows.map((n) => ({ title: n.title, dept: n.dept, date: n.date, body: n.body })) }; }
  // ---- 我的申请 / 待我审批 ----
  const KINDS = { leave: "请假", adjust: "调停课", booking: "借教室", cert: "证明" };
  const findReq = (id) => { const t = load(); for (const k of Object.keys(KINDS)) { const r = t[k].find((x) => x.id === String(id || "").toUpperCase()); if (r) return [k, r]; } return [null, null]; };
  const ownerOf = (k, r) => (k === "leave" || k === "cert" ? r.student_id : k === "adjust" ? r.teacher_id : r.applicant_id);
  const brief = (k, r) => ({ id: r.id, kind: KINDS[k], status: r.status, created: r.created,
    summary: k === "leave" ? `${one("student", r.student_id).name} ${r.type} ${r.from} 到 ${r.to}（${r.days} 天）：${r.reason}` : k === "adjust" ? `${one("teacher", r.teacher_id).name}「${courseOf(one("section", r.section_id)).name}」第 ${r.from_week} 周${WD[r.from_weekday]}${r.kind}${r.kind === "调课" ? ` → 第 ${r.to_week} 周${WD[r.to_weekday]}第 ${r.to_start} 节 ${r.to_room}` : ""}：${r.reason}` : k === "booking" ? `${r.room_id} ${r.date} 第 ${r.start}-${r.start + r.span - 1} 节：${r.purpose}` : `${r.kind}（核验码 ${r.code}）`,
    ...(r.approvals && r.approvals.length ? { approvals: r.approvals.map((a) => `${a.step}${a.ok ? "同意" : "驳回"}${a.comment ? "：" + a.comment : ""}`) } : {}) });
  function myRequests(actor, { kind } = {}) { const t = load(), out = []; for (const k of Object.keys(KINDS)) if (!kind || KINDS[k].includes(kind) || k === kind) for (const r of t[k]) if (ownerOf(k, r) === actor.id) out.push(brief(k, r)); return { count: out.length, requests: out.reverse() }; }
  // 这一步该谁批：辅导员 = 那个班的辅导员；学院 / 教研室 / 教务处 = 教务员（演示里合成一个人）
  function canApprove(actor, k, r) {
    if (!r.steps || r.step >= r.steps.length || !/^待/.test(r.status)) return false;
    const st = r.steps[r.step];
    if (st === "辅导员") return actor.role === "teacher" && one("class", one("student", r.student_id).class_id).counselor_id === actor.id;
    return actor.role === "staff";
  }
  function pending(actor) { const t = load(), out = []; for (const k of Object.keys(KINDS)) for (const r of t[k]) if (canApprove(actor, k, r)) out.push(brief(k, r)); return { count: out.length, requests: out }; }
  function approve(actor, { id, ok = true, comment } = {}) {
    const [k, r] = findReq(id); if (!r) throw new Error("没有这个申请：" + id);
    if (!canApprove(actor, k, r)) throw new Error(/^待/.test(r.status) ? `这一步要${r.steps[r.step]}来批，您没有权限` : `这个申请现在是「${r.status}」，不用再批了`);
    const pass = ok !== false && ok !== "false";
    r.approvals.push({ step: r.steps[r.step], by: actor.id, ok: pass, comment: String(comment || "").slice(0, 100), time: ymd(now()) });
    if (!pass) r.status = "已驳回"; else { r.step++; r.status = r.step >= r.steps.length ? (k === "booking" || k === "leave" ? "已批准" : "已通过") : `待${r.steps[r.step]}审批`; }
    log(actor, pass ? "审批同意" : "审批驳回", r.id); save();
    return brief(k, r);
  }
  function cancel(actor, { id } = {}) {
    const [k, r] = findReq(id); if (!r) throw new Error("没有这个申请：" + id);
    if (ownerOf(k, r) !== actor.id) throw new Error("只能撤销自己的申请");
    if (k === "cert") throw new Error("证明已经出具，撤不了");
    if (["已驳回", "已撤销"].includes(r.status)) throw new Error(`这个申请已经是「${r.status}」了`);
    if (k === "leave" && r.status === "已批准" && r.from <= ymd(now())) throw new Error("假期已经开始了：要提前回来请办销假");
    r.status = "已撤销"; log(actor, "撤销申请", r.id); save();
    return brief(k, r);
  }
  // 演示用：替该批的那个人把这一步批了（界面上的「模拟审批」）
  function approveNext(id, ok = true) { const [k, r] = findReq(id); if (!r) throw new Error("没有这个申请"); const I = identities(); const who2 = [I.teacher, I.staff, { role: "teacher", id: r.student_id ? one("class", one("student", r.student_id).class_id).counselor_id : "" }].find((a) => canApprove(a, k, r)); if (!who2) throw new Error("这个申请不用再批了"); return approve(who2, { id, ok, comment: "（模拟审批）" }); }

  // ---------- 给智能体用的工具 ----------
  function tools(actorOf) {
    const A = () => actorOf();
    const S = (o) => ({ type: "string", description: o }), I = (o) => ({ type: "integer", description: o });
    return [
      { name: "campus_whoami", desc: "看现在登录的是谁（学生 / 教师 / 教务员）、今天几号、第几周、哪个学期。办教务的事之前先看一眼", params: {}, say: () => "看一下现在是谁、今天第几周", run: () => who(A()) },
      { name: "get_timetable", desc: "查课表。week 是第几周（不写就是本周），day 是周几（1～7，不写就是整周）。「明天有什么课」要先用 campus_whoami 知道今天周几", params: { week: I("第几周"), day: I("周几，1～7") }, say: (a) => `查${a.week ? `第 ${a.week} 周` : "本周"}${a.day ? WD[a.day] || "" : ""}的课表`, run: (a) => timetable(A(), a) },
      { name: "get_grades", desc: "查成绩。学生：自己已经发布的成绩、绩点、不及格的课；教师：自己某个教学班的平时成绩（section 写课程名）", params: { section: S("教师查哪门课") }, say: () => "查成绩", run: (a) => grades(A(), a) },
      { name: "get_exams", desc: "查接下来的考试安排（期中、期末：哪天、几点、哪个教室）", params: {}, say: () => "查考试安排", run: () => exams(A()) },
      { name: "find_free_rooms", desc: "查空教室：date 日期（2026-11-18 这样）、start 从第几节开始、span 几节（默认 2）、capacity 至少多少座、type 教室类型（多媒体教室 / 阶梯教室）", params: { date: S("日期 YYYY-MM-DD"), start: I("第几节开始，1～10"), span: I("几节"), capacity: I("至少多少座"), type: S("教室类型") }, req: ["date", "start"], say: (a) => `查 ${a.date} 第 ${a.start} 节开始的空教室`, run: (a) => freeRooms(A(), a) },
      { name: "apply_leave", desc: "学生提交请假申请。type：事假 / 病假 / 公假；from、to：开始和结束日期（只请一天就写一样的）；reason：原因。提交之前要和学生确认日期和原因", params: { type: S("事假 / 病假 / 公假"), from: S("开始日期 YYYY-MM-DD"), to: S("结束日期 YYYY-MM-DD"), reason: S("请假原因") }, req: ["from", "to", "reason"], changes: true, say: (a) => `提交${a.type || "事假"}申请（${a.from} 到 ${a.to}）`, run: (a) => applyLeave(A(), a) },
      { name: "apply_adjust", desc: "教师申请调课或停课。course 课程名；week、weekday：原来哪一周、周几的那次课；kind 写 调课 或 停课；调课还要 to_week、to_weekday、to_start（调到第几周、周几、第几节开始）；room 可以不写（自动找空教室）；reason 原因", params: { course: S("课程名"), week: I("原来第几周"), weekday: I("原来周几"), kind: S("调课 / 停课"), to_week: I("调到第几周"), to_weekday: I("调到周几"), to_start: I("调到第几节开始：1、3、5、7、9"), room: S("教室，可以不写"), reason: S("原因") }, req: ["course", "reason"], changes: true, say: (a) => `提交「${a.course}」${a.kind || "调课"}申请`, run: (a) => applyAdjust(A(), a) },
      { name: "book_room", desc: "申请借用教室（班会、社团活动）。room 教室编号、date 日期、start 第几节开始、span 几节、purpose 用途。不知道哪个教室空着就先 find_free_rooms", params: { room: S("教室编号"), date: S("日期 YYYY-MM-DD"), start: I("第几节开始"), span: I("几节"), purpose: S("用途") }, req: ["room", "date", "start", "purpose"], changes: true, say: (a) => `申请借用 ${a.room}（${a.date}）`, run: (a) => bookRoom(A(), a) },
      { name: "apply_cert", desc: "学生申请开证明。kind：在读证明 / 成绩单", params: { kind: S("在读证明 / 成绩单") }, changes: true, say: (a) => `开${a.kind || "在读证明"}`, run: (a) => applyCert(A(), a) },
      { name: "elective", desc: "选修课。action：list 看能选哪些（还剩几个名额）、select 选、drop 退选；course 写课程名或课程代码", params: { action: S("list / select / drop"), course: S("课程名或代码") }, req: ["action"], changes: true, say: (a) => (a.action === "select" ? `选「${a.course}」` : a.action === "drop" ? `退选「${a.course}」` : "看能选的选修课"), run: (a) => elective(A(), a) },
      { name: "my_requests", desc: "看我提交过的申请（请假、调停课、借教室、证明）现在到哪一步了", params: { kind: S("只看哪一类，可以不写") }, say: () => "看我的申请进度", run: (a) => myRequests(A(), a) },
      { name: "cancel_request", desc: "撤销我自己提交的申请，id 是申请编号（像 QJ20261117001）", params: { id: S("申请编号") }, req: ["id"], changes: true, say: (a) => `撤销申请 ${a.id}`, run: (a) => cancel(A(), a) },
      { name: "pending_approvals", desc: "辅导员 / 教务员：看等我审批的申请", params: {}, say: () => "看等我审批的申请", run: () => pending(A()) },
      { name: "approve_request", desc: "辅导员 / 教务员：审批一份申请。id 申请编号；ok 写 true 同意、false 驳回；comment 意见", params: { id: S("申请编号"), ok: { type: "boolean", description: "同意 true / 驳回 false" }, comment: S("审批意见") }, req: ["id", "ok"], changes: true, say: (a) => `${a.ok === false ? "驳回" : "同意"}申请 ${a.id}`, run: (a) => approve(A(), a) },
      { name: "search_notices", desc: "查教务通知和规定（请假规定、选课规定、考试安排、借教室的规定……）。keyword 关键词，不写就是最近的通知", params: { keyword: S("关键词") }, say: (a) => `查通知${a.keyword ? "：" + a.keyword : ""}`, run: (a) => notices(A(), a) },
    ];
  }
  const stats = () => { const t = load(); return Object.fromEntries(["dept", "major", "class", "teacher", "student", "course", "room", "section", "schedule", "enroll", "grade", "exam", "leave", "adjust", "booking", "cert", "notice", "audit"].map((k) => [k, t[k].length])); };
  return { load, reset, identities, who, timetable, grades, exams, freeRooms, applyLeave, applyAdjust, bookRoom, applyCert, elective, notices, myRequests, pending, approve, cancel, approveNext, tools, stats, weekOf: (d) => weekOf(d || now()), dateOf: (w, d) => ymd(dateOf(w, d)), tables: () => load() };
}

module.exports = { create, PERIODS, WD };
