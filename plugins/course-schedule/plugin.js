// 课程表插件：组员开发的独立页面 app.html 由 api.mountApp 嵌入；
// 另外把课程同步到日历（读取 app.html 存在本机的 personal_course_schedule_* 数据）。
CalendarApp.register({
  id: "course-schedule",
  init(api) {
    const { esc, keyOf } = api.util;
    const MAX_WEEK = 20;
    const DEFAULT_WEEK1 = "2026-09-14"; // 与 app.html 里 semesterStartDate() 一致
    const PERIODS = {
      winter: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:00-14:50",
               "15:00-15:50", "16:10-17:00", "17:10-18:00", "19:10-20:00", "20:10-21:00"],
      summer: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20",
               "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30"],
    };
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return localStorage.getItem(k) ?? d; } };

    // 与 app.html 相同的周次解析规则
    function parseWeeks(str) {
      const set = {}; const s = typeof str === "string" ? str.trim() : "";
      if (!s) { for (let z = 1; z <= MAX_WEEK; z++) set[z] = true; return set; }
      const pm = s.match(/^(\d+)\s*[-–—~至]\s*(\d+)\s*[（(]?\s*(单|双)\s*[）)]?$/);
      if (pm) {
        for (let i = +pm[1]; i <= +pm[2]; i++) if ((pm[3] === "单") === (i % 2 === 1)) set[i] = true;
        return set;
      }
      for (const part of s.split(/[,，、;；\s]+/)) {
        const r = part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
        if (r) { let [x, y] = [+r[1], +r[2]]; if (x > y) [x, y] = [y, x]; for (let k = x; k <= y; k++) set[k] = true; }
        else if (/^\d+$/.test(part)) set[+part] = true;
      }
      return set;
    }
    const hue = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

    // 往日历里加课程
    api.addEventSource((startKey, endKey) => {
      const first = api.storage.get("week1", DEFAULT_WEEK1);
      if (!first || !api.storage.get("sync", true)) return [];
      const courses = read("personal_course_schedule_courses_v1", []);
      if (!Array.isArray(courses) || !courses.length) return [];
      // 用户没手动切换过时，按 app.html 的 defaultTimeMode()：5~10 月夏秋季，其余冬春季
      const saved = localStorage.getItem("personal_course_schedule_time_mode_v1");
      const m = new Date().getMonth() + 1;
      // 「拍照导入」认出的上课时间（截图时间）
      const custom = read("personal_course_schedule_custom_times_v1", null);
      const customOk = Array.isArray(custom) && custom.length >= 4 && custom.every((t) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t));
      const mode = saved === "summer" || saved === "winter" || (saved === "custom" && customOk) ? saved : (m >= 5 && m <= 10 ? "summer" : "winter");
      const times = mode === "custom" ? custom : PERIODS[mode];
      const w1 = new Date(first + "T00:00:00");
      const adj = read("personal_course_schedule_adjust_v1", []);
      const DN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
      const md = (k) => { const x = new Date(k + "T00:00:00"); return `${x.getMonth() + 1}月${x.getDate()}日${DN[(x.getDay() + 6) % 7]}`; };
      // 课表里原本这天的课
      const base = (k) => {
        const d = new Date(k + "T00:00:00"), week = Math.floor(Math.round((d - w1) / 86400000) / 7) + 1, day = (d.getDay() + 6) % 7;
        if (week < 1 || week > MAX_WEEK) return [];
        return courses.filter((c) => Number(c.day) === day && parseWeeks(c.weeks)[week]).map((c) => ({ ...c, week }));
      };
      const out = [];
      for (let d = new Date(startKey + "T00:00:00"); keyOf(d) <= endKey; d.setDate(d.getDate() + 1)) {
        const k = keyOf(d), on = Array.isArray(adj) ? adj.filter((a) => a && a.date === k) : [];
        const off = on.find((a) => a.type === "off"), sw = on.find((a) => a.type === "swap");
        let list = off ? [] : sw ? base(sw.from).map((c) => ({ ...c, _from: sw.from })) : base(k);
        for (const a of on) if (a.type === "cancel") list = list.filter((c) => !(c.name === a.name && (!a.start || +a.start === +c.start)));
        for (const a of on) if (a.type === "add") list.push({ id: "adj_" + a.id, name: a.name, start: +a.start, end: +a.end || +a.start, location: a.location, teacher: a.teacher, _add: true });
        // 调课 / 放假：日历上写一行说明
        if (off) out.push({ id: `adj_off_${k}`, date: k, time: "", title: "🏖 " + (off.note || "放假 / 停课"), detail: "调课 / 调休：这天没有课", color: "#1d8a55" });
        if (sw) out.push({ id: `adj_sw_${k}`, date: k, time: "", title: `🔁 调课：上${md(sw.from)}的课`, detail: "学校调休补课", color: "#b46a00" });
        for (const c of list) {
          const st = (times[c.start - 1] || "").split("-")[0];
          const en = (times[c.end - 1] || "").split("-")[1] || "";
          out.push({ id: `${c.id}_${k}`, date: k, time: st, title: c.name + (c._add ? "（加课）" : c._from ? "（调课）" : ""),
            detail: `第${c.start}-${c.end}节 ${st}-${en}${c.week ? " · 第" + c.week + "周" : ""}${c.teacher ? " · " + c.teacher : ""}${c._from ? " · 原来是" + md(c._from) + "的课" : ""}`,
            location: c.location, color: `hsl(${hue(c.name)} 65% 55%)` });
        }
      }
      return out;
    });

    api.addTab({
      id: "main", title: "📚 课程表",
      render(el) {
        el.innerHTML = `<div class="panel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            同步到日历：第 1 周周一是 <input type="date" class="csW1">
            <label class="check"><input type="checkbox" class="csSync"> 在日历里显示课程</label>
            <span class="csTip" style="color:var(--sub);font-size:12px"></span>
          </div>`;
        const q = (s) => el.querySelector(s);
        q(".csW1").value = api.storage.get("week1", DEFAULT_WEEK1);
        q(".csSync").checked = api.storage.get("sync", true);
        const tip = () => { q(".csTip").textContent = api.storage.get("week1", DEFAULT_WEEK1) ? "" : "填写后，课程会自动出现在日历上"; };
        tip();
        q(".csW1").onchange = (e) => {
          let v = e.target.value;
          if (v) { const d = new Date(v + "T00:00:00"); d.setDate(d.getDate() - (d.getDay() + 6) % 7); v = keyOf(d); e.target.value = v; }
          api.storage.set("week1", v); tip(); api.refresh();
        };
        q(".csSync").onchange = (e) => { api.storage.set("sync", e.target.checked); api.refresh(); };
        // 「拍照导入」或另一台设备改了第 1 周：输入框跟着变
        window.addEventListener("storage", (e) => { if (e.key === "plg_course-schedule_week1") { q(".csW1").value = api.storage.get("week1", DEFAULT_WEEK1); tip(); } });
        api.mountApp(el, { minHeight: "70vh" });
      },
    });
  },
});
