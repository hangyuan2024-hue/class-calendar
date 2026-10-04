// 测试用：在普通浏览器里假装是电脑版的主进程（window.cc），用来检查界面和截图
(function () {
  const M = () => window.CCModel;
  const listeners = {};
  const emit = (ev, d) => (listeners[ev] || []).forEach((f) => setTimeout(() => f(d), 0));
  const day = (n, t) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${t ? " " + t : ""}`; };
  const LOGGED = !location.hash.includes("login");
  const S = {
    loggedIn: LOGGED, version: "1.0.12",
    me: { id: "u1", display_name: "小明", account: "hangyuan", role: "student" }, perms: [],
    classes: [{ id: "c-1", name: "计科2601班", status: "approved", is_teacher: false }, { id: "c-2", name: "ACM 兴趣小组", status: "approved", is_teacher: false }], cid: "c-1",
    items: [
      { id: 101, msg_type: "作业", subject: "数据结构 实验三：二叉树遍历", summary: "完成前序、中序、后序遍历的递归和非递归实现，提交实验报告", event_time: day(1, "23:59"), location: "学习通", prepare: "实验报告模板", original: "【数据结构】各位同学，实验三截止时间是明晚23:59，请在学习通提交代码和报告。", publish_date: day(-2), need_confirm: false },
      { id: 102, msg_type: "通知", subject: "体测安排", summary: "本周四下午体育馆集合，带学生证", event_time: day(0, "14:30"), location: "体育馆", prepare: "学生证、运动鞋", original: "", publish_date: day(-3), need_confirm: true },
      { id: 103, msg_type: "作业", subject: "高等数学 习题 3.2", summary: "第 1、3、5、7 题，写在作业本上", event_time: day(2, "08:00"), location: "", prepare: "", original: "", publish_date: day(-1), need_confirm: false },
      { id: 104, msg_type: "会议", subject: "班会：国庆返校安全教育", summary: "全体同学参加", event_time: day(3, "19:00"), location: "教3-201", prepare: "", original: "", publish_date: day(-1), need_confirm: false },
      { id: 105, msg_type: "活动", subject: "校园歌手大赛报名", summary: "报名截止前交到团支书", event_time: day(6), location: "", prepare: "", original: "", publish_date: day(-4), need_confirm: false },
      { id: 106, msg_type: "作业", subject: "大学英语 Unit 3 作文", summary: "120 词以上，主题 My Hometown", event_time: day(-1, "22:00"), location: "批改网", prepare: "", original: "", publish_date: day(-6), need_confirm: false },
      { id: 107, msg_type: "通知", subject: "图书馆闭馆通知", summary: "周六图书馆设备检修闭馆一天", event_time: day(9), location: "图书馆", prepare: "", original: "", publish_date: day(-1), need_confirm: false },
      { id: 108, msg_type: "作业", subject: "线性代数 第二章测验", summary: "课上随堂测验", event_time: day(8, "10:00"), location: "教2-305", prepare: "计算器", original: "", publish_date: day(-1), need_confirm: false },
      { id: 109, msg_type: "作业", subject: "Python 程序设计 作业4", summary: "爬取天气数据并画图", event_time: day(13, "23:59"), location: "", prepare: "", original: "", publish_date: day(0), need_confirm: false },
    ],
    wall: { cid: "c-1", posts: [
      { id: 3, author_name: "王老师", author_role: "teacher", title: "期中考试安排", body: "期中考试定在第 9 周，具体时间和考场稍后通知，大家提前复习。", is_notice: true, pinned_at: new Date().toISOString(), created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: 2, author_name: "李同学", author_role: "student", title: "", body: "有人知道数据结构实验三的非递归后序遍历怎么写吗？卡住了😭", is_notice: false, created_at: new Date(Date.now() - 3600000 * 3).toISOString() },
      { id: 1, author_name: "张班长", author_role: "admin", title: "班费收支", body: "本月班费支出：打印资料 36 元，班会零食 120 元，余额 842 元。", is_notice: false, created_at: new Date(Date.now() - 86400000 * 5).toISOString() },
    ] },
    courses: { meta: { week1: (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 28); return day(Math.round((d - new Date()) / 86400000)); })() }, courses: [
      { id: 1, name: "高等数学", day: 0, start: 1, end: 2, location: "教2-101", teacher: "陈老师" },
      { id: 2, name: "大学英语", day: 0, start: 3, end: 4, location: "外语楼 305", teacher: "Lisa" },
      { id: 3, name: "数据结构", day: 1, start: 1, end: 2, location: "教3-402", teacher: "王老师" },
      { id: 4, name: "大学物理", day: 1, start: 5, end: 6, location: "理科楼 201", teacher: "赵老师" },
      { id: 5, name: "线性代数", day: 2, start: 3, end: 4, location: "教2-305", teacher: "孙老师" },
      { id: 6, name: "高等数学", day: 2, start: 5, end: 6, location: "教2-101", teacher: "陈老师" },
      { id: 7, name: "数据结构", day: 3, start: 3, end: 4, location: "实验楼 B302", teacher: "王老师" },
      { id: 8, name: "体育", day: 3, start: 5, end: 6, location: "体育馆", teacher: "" },
      { id: 9, name: "思想道德与法治", day: 4, start: 1, end: 2, location: "教1-大阶梯", teacher: "刘老师" },
      { id: 10, name: "Python 程序设计", day: 4, start: 5, end: 7, location: "机房 A3", teacher: "周老师" },
      { id: 11, name: "计算机导论", day: 0, start: 9, end: 10, location: "教3-201", teacher: "吴老师" },
      { id: 12, name: "大学物理", day: 3, start: 1, end: 2, location: "理科楼 201", teacher: "赵老师" },
    ] },
    mine: [
      { id: "p1", subject: "去快递站拿快递", event_time: day(0, "17:30"), location: "南门", note: "", done: false },
      { id: "p2", subject: "复习高数第三章", event_time: day(1), location: "", note: "重点：洛必达法则", done: false },
      { id: "p3", subject: "给妈妈打电话", event_time: day(0, "21:00"), location: "", note: "", done: true },
      { id: "p4", subject: "买台灯", event_time: "", location: "", note: "", done: false },
    ],
    marks: { c106: { note: "已经写了一半" } }, doneLog: { p3: day(0), c99: day(-1), c98: day(-2) },
    pomo: { [day(0)]: 50, [day(-1)]: 75, [day(-2)]: 25, [day(-4)]: 100, [day(-5)]: 45, [day(-8)]: 60 },
    settings: { remindBefore: 30, courseRemind: 10, eveningDigest: true, closeToTray: true, autoStart: false, theme: "system", hotkey: "CommandOrControl+Alt+Space", pomoFocus: 25, pomoBreak: 5 },
    status: { syncing: false, online: true, error: "", lastOk: Date.now() }, lastRefresh: Date.now(), pending: 0,
    ai: { status: location.hash.includes("aiready") ? "ready" : "idle", ready: location.hash.includes("aiready"), got: 0, total: 0, error: "", model: "通义千问 Qwen2.5 1.5B" },
  };
  const pomo = { running: false, phase: "focus", left: 0, total: 0, task: "" };
  const push = () => emit("state", JSON.parse(JSON.stringify(S)));
  window.__calls = [];
  const H = {
    state: () => JSON.parse(JSON.stringify(S)),
    login: (a, p) => { if (p !== "123456") throw new Error("账号或密码不对"); S.loggedIn = true; return JSON.parse(JSON.stringify(S)); },
    logout: () => { S.loggedIn = false; push(); },
    refresh: () => { S.status.syncing = true; push(); setTimeout(() => { S.status.syncing = false; S.lastRefresh = Date.now(); push(); }, 300); },
    "mine:upsert": (it) => { const id = it.id || "p" + Date.now(); const i = S.mine.findIndex((x) => x.id === id); const rec = { done: false, ...(i >= 0 ? S.mine[i] : {}), ...it, id }; if (i >= 0) S.mine[i] = rec; else S.mine.push(rec); push(); return rec; },
    "mine:delete": (id) => { S.mine = S.mine.filter((x) => x.id !== id); push(); return true; },
    done: (k, d) => { if (/^c\d+$/.test(k)) { S.marks[k] = { ...(S.marks[k] || {}), done: d }; } else { const it = S.mine.find((x) => x.id === k); if (it) it.done = d; } if (d) S.doneLog[k] = day(0); else delete S.doneLog[k]; push(); },
    mark: (k, p) => { S.marks[k] = { ...(S.marks[k] || {}), ...p }; push(); },
    move: (id, d) => { const it = S.mine.find((x) => x.id === id); const t = (String(it.event_time).match(/\d{2}:\d{2}/) || [""])[0]; it.event_time = d + (t ? " " + t : ""); push(); return true; },
    "class:switch": (c) => { S.cid = c; push(); },
    "wall:post": (t, b, n) => { S.wall.posts.unshift({ id: Date.now(), author_name: "小明", author_role: "student", title: t, body: b, is_notice: n, created_at: new Date().toISOString() }); push(); },
    settings: (p) => { Object.assign(S.settings, p); push(); return S.settings; },
    "quick:parse": (t) => window.CCParse.parse(t, new Date()),
    "quick:add": (t) => { const p = window.CCParse.parse(t, new Date()); if (!p.subject) throw new Error("写一下要做什么"); return H["mine:upsert"]({ subject: p.subject, event_time: p.date ? p.date + (p.time ? " " + p.time : "") : "", location: p.location }); },
    "quick:hide": () => {}, "open:main": () => {}, "open:external": () => {}, "mini:toggle": () => {},
    "pomo:start": (min, task) => { Object.assign(pomo, { running: true, phase: "focus", total: min * 60, left: min * 60 - 437, task }); emit("pomo", { ...pomo }); },
    "pomo:stop": () => { pomo.running = false; emit("pomo", { ...pomo }); },
    "pomo:state": () => ({ ...pomo }),
    "ai:prepare": () => { S.ai = { ...S.ai, status: "downloading", got: 412 * 1048576, total: 1117 * 1048576 }; emit("ai-state", S.ai); return S.ai; },
    "ai:cancel": () => { S.ai = { ...S.ai, status: "idle" }; emit("ai-state", S.ai); },
    "ai:chat": (id, hist) => new Promise((res) => {
      const text = "明天（周四）你有 3 节课：\n- **08:00–09:40 大学物理** @理科楼 201（赵老师）\n- **10:00–11:40 数据结构** @实验楼 B302（王老师）\n- **14:00–15:40 体育** @体育馆\n\n另外别忘了 **数据结构实验三** 明晚 23:59 截止，还没完成哦。记得带运动鞋 👟";
      let i = 0; const t = setInterval(() => { i += 6; emit("ai-token", { id, text: text.slice(0, i) }); if (i >= text.length) { clearInterval(t); res(text); } }, 30);
    }),
    "ai:stop": () => {}, "export:ics": () => 9,
  };
  window.cc = {
    call: async (ch, ...a) => { window.__calls.push([ch, ...a]); if (!H[ch]) throw new Error("不支持：" + ch); return H[ch](...a); },
    on: (ev, fn) => (listeners[ev] ||= []).push(fn),
    platform: "win32",
  };
  window.__S = S; window.__emit = emit; window.__push = push;
})();
