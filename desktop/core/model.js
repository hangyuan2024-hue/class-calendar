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
  const TYPES = ["作业", "通知", "会议", "活动", "个人"];

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
      return { key: r.id, id: r.id, mine: true, type: "个人", title: r.subject || "（无标题）", summary: "", day: p ? p.day : "", time: p ? p.time : "",
        location: r.location || "", prepare: "", original: "", publish: "", confirm: false, done: !!r.done, hidden: false, note: r.note || "" };
    });
    return cls.concat(own);
  }
  const sortItems = (list) => list.slice().sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999") || (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));

  // 距离今天几天（负数是过去）
  const dayDiff = (day, now) => Math.round((fromKey(day) - fromKey(dayKey(now || new Date()))) / 86400000);
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
  function weekOf(meta, date) {
    if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(meta.week1 || "")) return null;
    const n = Math.floor((fromKey(dayKey(date)) - fromKey(meta.week1)) / 86400000);
    return n < 0 ? 0 : Math.floor(n / 7) + 1;
  }
  const weekday0 = (date) => (date.getDay() + 6) % 7;   // 0 = 周一
  function coursesOn(c, date) {
    const meta = (c && c.meta) || {}, list = (c && c.courses) || [], wk = weekOf(meta, date), times = periodTimes(meta);
    const d0 = weekday0(date);
    return list.filter((x) => x.day === d0 && (wk == null || !Array.isArray(x.wl) || !x.wl.length || x.wl.includes(wk)))
      .map((x) => ({ ...x, tStart: (times[x.start - 1] || "").split("-")[0] || "", tEnd: (times[(x.end || x.start) - 1] || "").split("-")[1] || "", color: colorFor(x.name) }))
      .sort((a, b) => a.start - b.start);
  }
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

  return { pad, dayKey, fromKey, addDays, WEEK, TYPES, parseTime, allItems, sortItems, dayDiff, relDay, periodTimes, weekOf, weekday0, coursesOn, colorFor, toMin, DEFAULT_TIMES, parseWeeks, weeksText, mondayKey };
});
