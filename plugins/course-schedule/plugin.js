// 课程表插件：组员开发的独立页面 app.html 由 api.mountApp 嵌入；
// 另外把课程同步到日历（读取 app.html 存在本机的 personal_course_schedule_* 数据）。
CalendarApp.register({
  id: "course-schedule",
  init(api) {
    const { esc, keyOf } = api.util;
    const MAX_WEEK = 16;
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
      const mode = saved === "summer" || saved === "winter" ? saved : (m >= 5 && m <= 10 ? "summer" : "winter");
      const times = PERIODS[mode];
      const w1 = new Date(first + "T00:00:00");
      const out = [];
      for (let d = new Date(startKey + "T00:00:00"); keyOf(d) <= endKey; d.setDate(d.getDate() + 1)) {
        const week = Math.floor((d - w1) / 86400000 / 7) + 1;
        if (week < 1 || week > MAX_WEEK) continue;
        const day = (d.getDay() + 6) % 7; // 0=周一，与 app.html 一致
        for (const c of courses) {
          if (Number(c.day) !== day || !parseWeeks(c.weeks)[week]) continue;
          const st = (times[c.start - 1] || "").split("-")[0];
          const en = (times[c.end - 1] || "").split("-")[1] || "";
          out.push({ id: `${c.id}_${keyOf(d)}`, date: keyOf(d), time: st, title: c.name,
            detail: `第${c.start}-${c.end}节 ${st}-${en} · 第${week}周${c.teacher ? " · " + c.teacher : ""}`,
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
        api.mountApp(el, { minHeight: "70vh" });
      },
    });
  },
});
