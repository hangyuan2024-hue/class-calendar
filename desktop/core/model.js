// 捞捞课程表 电脑版 · 数据整理（界面和主进程共用：主进程用来算提醒，界面用来显示）
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CCModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  // 「现在」：和网页版一样一律按北京时间（东八区）算，并用服务器时间校准（clockOff 由同步时的 sync_ping 填）。
  // 返回的 Date 的年月日时分 = 此刻北京时间的年月日时分（事项时间都按「北京钟面」写的）。
  let clockOff = 0;
  const setClock = (ms) => { clockOff = Number(ms) || 0; };
  const shiftMs = () => (new Date().getTimezoneOffset() + 480) * 60000;
  const nowMs = () => Date.now() + clockOff + shiftMs();          // 北京钟面的时刻
  const now = () => new Date(nowMs());
  const realMs = (t) => t - clockOff - shiftMs();                  // 北京钟面 → 本机真实时刻（定时器、系统通知用）
  const TYPES = ["作业", "通知", "会议", "活动", "个人", "考核"];

  function parseTime(t) {
    const m = String(t || "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    return m ? { day: m[1], time: m[2] || "" } : null;
  }

  // 班级事项 + 我的事项 → 统一格式
  function allItems(s) {
    const marks = s.marks || {};
    const cls = (s.items || []).map((r) => {
      const key = "c" + r.id, mk = marks[key] || {}, p = parseTime(r.event_time);
      return { key, id: r.id, mine: false, type: TYPES.includes(r.msg_type) ? r.msg_type : (r.msg_type || "通知"), title: r.subject || r.summary || r.msg_type || "（无标题）",
        summary: r.subject ? r.summary || "" : "", day: p ? p.day : "", time: p ? p.time : "", location: r.location || "", prepare: r.prepare || "",
        original: r.original || "", publish: r.publish_date || "", confirm: !!r.need_confirm, done: !!mk.done, hidden: !!mk.hidden, note: mk.note || "",
        gid: r.group_id || null, by: r.created_by || null, editor: r.editor || "", updated: r.updated_at || "", raw: r };
    });
    const own = (s.mine || []).filter((r) => r && r.id).map((r) => {
      const p = parseTime(r.event_time);
      // kind = "作业"：自己记的作业（和网页版一样，会出现在作业页）；from：改的是哪条班级事项（「编辑（仅自己）」）
      return { key: r.id, id: r.id, mine: true, type: r.kind === "作业" ? "作业" : "个人", kind: r.kind === "作业" ? "作业" : "", from: r.from || "", keep: r.keep || "",
        title: r.subject || "（无标题）", summary: "", day: p ? p.day : "", time: p ? p.time : "",
        location: r.location || "", prepare: "", original: "", publish: "", confirm: false, done: !!r.done, hidden: false, note: r.note || "", local: !!r.local };
    });
    // 课内学习里有截止日期的考核（界面从网站的课内学习模块拿到后交给主进程）；完成、备注、隐藏记在完成标记里
    const ext = (s.extraItems || []).filter((x) => x && /^kn\d+$/.test(x.key)).map((x) => { const mk = marks[x.key] || {};
      return { key: x.key, id: x.key, study: true, studyId: x.studyId, course: x.course || "", mine: false, type: "考核", title: x.title || "考核", summary: x.summary || "", day: x.day || "", time: x.time || "",
        location: "", prepare: "", original: "", publish: "", confirm: false, done: !!mk.done, hidden: !!mk.hidden, note: mk.note || "", gid: null }; });
    return cls.concat(own, ext);
  }
  const sortItems = (list) => list.slice().sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999") || (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));

  // 距离今天几天（负数是过去）
  const dayDiff = (day, now0) => Math.round((fromKey(day) - fromKey(dayKey(now0 || now()))) / 86400000);
  function relDay(day, now) {
    if (!day) return "没定日子";
    const n = dayDiff(day, now);
    if (n === 0) return "今天"; if (n === 1) return "明天"; if (n === 2) return "后天"; if (n === -1) return "昨天";
    const d = fromKey(day);
    if (n > 0 && n < 7) return "周" + WEEK[d.getDay()];
    if (n < 0) return `${-n} 天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // ---------- 课程表 ----------
  const DEFAULT_TIMES = ["08:00-08:45", "08:55-09:40", "10:00-10:45", "10:55-11:40", "14:00-14:45", "14:55-15:40", "16:00-16:45", "16:55-17:40",
    "19:00-19:45", "19:55-20:40", "20:50-21:35", "21:45-22:30"];
  function periodTimes(meta) {
    const t = (meta && Array.isArray(meta.times) ? meta.times : []).slice();
    const n = Math.max(t.length, 12);
    const out = [];
    for (let i = 0; i < n; i++) out.push(/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t[i] || "") ? t[i] : DEFAULT_TIMES[i] || "");
    return out;
  }
  // 第几周（没设置第 1 周时返回 null）
  const MAX_WEEK = 20;
  function weekOf(meta, date) {
    if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(meta.week1 || "")) return null;
    const n = Math.floor((fromKey(dayKey(date)) - fromKey(mondayKey(meta.week1))) / 86400000);
    return n < 0 ? 0 : Math.floor(n / 7) + 1;
  }
  const weekday0 = (date) => (date.getDay() + 6) % 7;   // 0 = 周一
  // 课表里原本这一天的课（不管调课）
  function baseOn(c, date) {
    const meta = (c && c.meta) || {}, list = (c && c.courses) || [], wk = weekOf(meta, date), times = periodTimes(meta);
    if (wk != null && (wk < 1 || wk > MAX_WEEK)) return [];
    const d0 = weekday0(date);
    return list.filter((x) => +x.day === d0 && (wk == null || !Array.isArray(x.wl) || !x.wl.length || x.wl.includes(wk)))
      .map((x) => ({ ...x, week: wk, tStart: (times[x.start - 1] || "").split("-")[0] || "", tEnd: (times[(x.end || x.start) - 1] || "").split("-")[1] || "", color: colorFor(x.name) }));
  }
  // ---------- 调课 / 调休（和网页版 courses.js、服务器 courses_on 同一套规则） ----------
  //   swap：date 这天按 from 那天的课上；off：date 这天放假 / 停课；cancel：date 这天某门课不上（可指定 start 节）；add：加一节课
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function cleanAdj(a) {
    if (!Array.isArray(a)) return [];
    const out = [];
    for (const x of a) {
      if (!x || !DATE_RE.test(x.date || "") || !["swap", "off", "cancel", "add"].includes(x.type)) continue;
      if (x.type === "swap" && (!DATE_RE.test(x.from || "") || x.from === x.date)) continue;
      if ((x.type === "add" || x.type === "cancel") && !String(x.name || "").trim()) continue;
      const st = Math.max(1, Math.min(16, +x.start || 0)), en = Math.max(st, Math.min(16, +x.end || st));
      out.push({ id: String(x.id || Math.random().toString(36).slice(2, 10)).slice(0, 40), date: x.date, type: x.type,
        ...(x.type === "swap" ? { from: x.from } : {}), ...(x.type === "add" || x.type === "cancel" ? { name: String(x.name).trim().slice(0, 60) } : {}),
        ...(x.type === "add" ? { start: st, end: en, location: String(x.location || "").slice(0, 60), teacher: String(x.teacher || "").slice(0, 40) } : {}),
        ...(x.type === "cancel" && +x.start ? { start: st } : {}), note: String(x.note || "").slice(0, 60) });
      if (out.length >= 200) break;
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  const adjOf = (c) => cleanAdj(((c && c.meta) || {}).adj);
  function adjOn(c, k) { return adjOf(c).filter((a) => a.date === k); }
  function coursesOn(c, date) {
    const k = dayKey(date), on = adjOn(c, k), times = periodTimes((c && c.meta) || {});
    let list;
    if (on.some((a) => a.type === "off")) list = [];
    else { const sw = on.find((a) => a.type === "swap"); list = sw ? baseOn(c, fromKey(sw.from)).map((x) => ({ ...x, _from: sw.from })) : baseOn(c, date); }
    for (const a of on) if (a.type === "cancel") list = list.filter((x) => !(x.name === a.name && (!a.start || +a.start === +x.start)));
    const wk = weekOf((c && c.meta) || {}, date);
    for (const a of on) if (a.type === "add") list.push({ id: "adj_" + a.id, name: a.name, day: weekday0(date), start: a.start, end: a.end, location: a.location || "", teacher: a.teacher || "", week: wk, _add: true,
      tStart: (times[a.start - 1] || "").split("-")[0] || "", tEnd: (times[a.end - 1] || "").split("-")[1] || "", color: colorFor(a.name) });
    return list.sort((a, b) => a.start - b.start);
  }
  const mdw = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}月${d.getDate()}日（周${WEEK[d.getDay()]}）`; };
  // 这一天的调整说明：「放假」「上 10月8日（周三）的课」「停 1 节，加 1 节」
  function dayNote(c, k) {
    const on = adjOn(c, k); if (!on.length) return "";
    if (on.some((a) => a.type === "off")) return on.find((a) => a.type === "off").note || "放假 / 停课";
    const sw = on.find((a) => a.type === "swap"), parts = [];
    if (sw) parts.push(`上 ${mdw(sw.from)} 的课`);
    const nc = on.filter((a) => a.type === "cancel").length, na = on.filter((a) => a.type === "add").length;
    if (nc) parts.push(`停 ${nc} 节`); if (na) parts.push(`加 ${na} 节`);
    return parts.join("，");
  }
  const adjText = (a) => a.type === "swap" ? `上 ${mdw(a.from)} 的课` : a.type === "off" ? `放假 / 停课${a.note ? "：" + a.note : ""}`
    : a.type === "cancel" ? `「${a.name}」${a.start ? "第" + a.start + "节" : ""}不上` : `加课「${a.name}」第${a.start}${a.end > a.start ? "-" + a.end : ""}节${a.location ? " · " + a.location : ""}`;
  const PALETTE = ["#4f8cff", "#ff7a59", "#22b07d", "#a259ff", "#ffb020", "#14b8c4", "#ef5da8", "#6b7cff", "#e8590c", "#2f9e44"];
  function colorFor(name) { let h = 0; for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
  // 周次写法：1-16、1-15单、2-16双、1-3,5-8（空的 = 1-16 周），和网页课程表的规则一样
  function parseWeeks(str) {
    const set = new Set(), s = typeof str === "string" ? str.trim() : "";
    if (!s) { for (let z = 1; z <= 16; z++) set.add(z); return set; }
    const pm = s.match(/^(\d+)\s*[-–—~至]\s*(\d+)\s*[（(]?\s*(单|双)\s*[）)]?\s*周?$/);
    if (pm) { for (let i = +pm[1]; i <= +pm[2] && i <= 30; i++) if ((pm[3] === "单") === (i % 2 === 1)) set.add(i); return set; }
    for (const part of s.replace(/周/g, "").split(/[,，、;；\s]+/)) {
      const r = part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
      if (r) { let [x, y] = [+r[1], +r[2]]; if (x > y) [x, y] = [y, x]; for (let k = x; k <= y && k <= 30; k++) set.add(k); }
      else if (/^\d+$/.test(part) && +part >= 1 && +part <= 30) set.add(+part);
    }
    return set;
  }
  function weeksText(ws) {
    const a = [...ws].filter((x) => x >= 1 && x <= 30).sort((x, y) => x - y);
    if (!a.length) return "";
    if (a.length >= 3 && a.every((x, i) => i === 0 || x - a[i - 1] === 2)) return `${a[0]}-${a[a.length - 1]}${a[0] % 2 ? "单" : "双"}`;
    const runs = []; let st = a[0];
    for (let i = 1; i <= a.length; i++) if (a[i] !== a[i - 1] + 1) { runs.push(st === a[i - 1] ? `${st}` : `${st}-${a[i - 1]}`); st = a[i]; }
    return runs.join(",");
  }
  const mondayKey = (k) => { const d = fromKey(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dayKey(d); };
  const toMin = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ""); return m ? +m[1] * 60 + +m[2] : null; };

  return { pad, dayKey, fromKey, addDays, WEEK, TYPES, parseTime, allItems, sortItems, dayDiff, relDay, periodTimes, weekOf, weekday0, coursesOn, baseOn, colorFor, toMin, DEFAULT_TIMES, parseWeeks, weeksText, mondayKey,
    MAX_WEEK, cleanAdj, adjOf, adjOn, dayNote, adjText, mdw, setClock, now, nowMs, realMs, getClock: () => clockOff };
});
