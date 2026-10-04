// 课程表编辑：手动加课、改课、删课，设置第 1 周和每节课的时间；截图识别导入（服务器识别，不花 token）；
// 课表打印 / PDF / 图片 / 桌面壁纸用的页面。改完传到服务器，网页、手机日历订阅、邮件提醒都用同一份。
"use strict";
const DAYS7 = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const PERIOD_PRESETS = {
  summer: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20", "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30"],
  winter: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:00-14:50", "15:00-15:50", "16:10-17:00", "17:10-18:00", "19:10-20:00", "20:10-21:00"],
};
const CourseEd = {
  list() { return (App.S.courses.courses || []).map((c) => ({ ...c })); },
  meta() { return { ...(App.S.courses.meta || {}) }; },
  async save(list, meta, msg) {
    try { const n = await call("courses:save", list, meta); toast(msg || `课程表已保存（${n} 门课），网页和手机上也会更新`); return true; } catch (e) { return false; }
  },
  courseFields(c, preset) {
    c = c || {}; preset = preset || {};
    const per = () => Array.from({ length: 14 }, (_, i) => [String(i + 1), `第 ${i + 1} 节`]);
    return [
      { name: "name", label: "课程名", value: c.name || "", max: 60, placeholder: "比如：高等数学" },
      { name: "day", label: "星期", type: "select", value: String(c.day ?? preset.day ?? 0), options: DAYS7.map((d, i) => [String(i), d]) },
      { name: "start", label: "从", type: "select", value: String(c.start || preset.start || 1), options: per() },
      { name: "end", label: "到", type: "select", value: String(c.end || preset.end || preset.start || 2), options: per() },
      { name: "weeks", label: "上课的周", value: c.weeks || (Array.isArray(c.wl) && c.wl.length ? M.weeksText(new Set(c.wl)) : "1-16"), max: 40, hint: "写法：1-16、1-15单、2-16双、1-3,5-8" },
      { name: "location", label: "地点", value: c.location || "", max: 60 },
      { name: "teacher", label: "老师", value: c.teacher || "", max: 40 },
    ];
  },
  check(o) {
    if (!o.name) return "请填写课程名";
    if (+o.end < +o.start) return "结束节次比开始早";
    if (!M.parseWeeks(o.weeks).size) return "周次看不懂，例：1-16、1-15单、2-16双、1-3,5-8";
    return "";
  },
  async editOne(c, preset) {
    const v = await formBox(c ? "修改课程" : "添加课程", this.courseFields(c, preset), "保存", { check: (o) => this.check(o) });
    if (!v) return;
    const list = this.list(), rec = { ...(c || {}), id: c ? c.id : "d" + Date.now(), name: v.name, day: +v.day, start: +v.start, end: +v.end, weeks: M.weeksText(M.parseWeeks(v.weeks)) || v.weeks, location: v.location, teacher: v.teacher };
    const i = list.findIndex((x) => String(x.id) === String(rec.id));
    if (i >= 0) list[i] = rec; else list.push(rec);
    await this.save(list, null, c ? "已保存" : `已添加「${rec.name}」`);
  },
  async del(c) {
    if (!(await confirmBox(`删除「${c.name}」（${DAYS7[c.day]} 第 ${c.start}${c.end > c.start ? "-" + c.end : ""} 节）？`, "网页和手机上的课程表也会一起删掉。", "删除", true))) return;
    await this.save(this.list().filter((x) => String(x.id) !== String(c.id)), null, "已删除");
    App.views.week.sel = null; $("#wkInsp", App.views.week.el).classList.add("hidden");
  },
  // ---------- 整张课表：列表 + 第 1 周 + 作息时间 ----------
  open() {
    const meta = this.meta(), times = M.periodTimes(meta).slice(0, Math.max(10, (meta.times || []).length));
    const mode = JSON.stringify(times.slice(0, 10)) === JSON.stringify(PERIOD_PRESETS.summer) ? "summer" : JSON.stringify(times.slice(0, 10)) === JSON.stringify(PERIOD_PRESETS.winter) ? "winter" : "custom";
    let list = this.list().sort((a, b) => a.day - b.day || a.start - b.start);
    const d = h(`<div class="dialog wide ce" role="dialog"><h3>编辑课程表</h3><div class="dbody">
      <div class="row ce-top"><label class="field">第 1 周的星期一<input type="date" class="input" id="ceW1" value="${esc(meta.week1 || "")}"></label>
        <label class="field">作息时间<select class="input" id="ceMode"><option value="summer"${mode === "summer" ? " selected" : ""}>夏季作息（5–10 月）</option><option value="winter"${mode === "winter" ? " selected" : ""}>冬季作息</option><option value="custom"${mode === "custom" ? " selected" : ""}>自己填</option></select></label>
        <span class="grow"></span><button class="btn" id="ceAdd">${icon("plus")}加一门课</button></div>
      <div class="ce-times${mode === "custom" ? "" : " hidden"}" id="ceTimes">${times.map((t, i) => `<label>第${i + 1}节<input class="input" data-t="${i}" value="${esc(t)}" placeholder="08:00-08:45"></label>`).join("")}</div>
      <div class="ce-list" id="ceList"></div></div>
      <div class="dfoot"><span class="muted grow" id="ceN"></span><button class="btn danger" id="ceClear">全部清空</button><button class="btn" data-a="no">取消</button><button class="btn primary" id="ceSave">保存</button></div></div>`);
    const draw = () => {
      $("#ceN", d).textContent = `${list.length} 门课`;
      $("#ceList", d).innerHTML = list.length ? `<div class="ce-h"><span>课程</span><span>星期</span><span>节次</span><span>周</span><span>地点</span><span>老师</span><span></span></div>` + list.map((c, i) => `<div class="ce-r" data-i="${i}" style="--c:${M.colorFor(c.name)}">
        <input class="input" data-f="name" value="${esc(c.name)}" maxlength="60"><select class="input" data-f="day">${DAYS7.map((x, k) => `<option value="${k}"${+c.day === k ? " selected" : ""}>${x}</option>`).join("")}</select>
        <span class="ce-p"><input class="input" type="number" min="1" max="16" data-f="start" value="${c.start}">-<input class="input" type="number" min="1" max="16" data-f="end" value="${c.end || c.start}"></span>
        <input class="input" data-f="weeks" value="${esc(c.weeks || (Array.isArray(c.wl) && c.wl.length ? M.weeksText(new Set(c.wl)) : ""))}" placeholder="1-16" maxlength="40"><input class="input" data-f="location" value="${esc(c.location || "")}" maxlength="60"><input class="input" data-f="teacher" value="${esc(c.teacher || "")}" maxlength="40">
        <button class="btn ghost iconbtn sm danger" data-del="${i}" title="删除">${icon("trash")}</button></div>`).join("") : `<div class="empty">还没有课。点「加一门课」，或者关掉这个窗口用「截图导入」。</div>`;
    };
    draw();
    d.addEventListener("input", (e) => { const r = e.target.closest(".ce-r"), f = e.target.dataset.f; if (!r || !f) return; const c = list[+r.dataset.i]; c[f] = ["day", "start", "end"].includes(f) ? +e.target.value : e.target.value; if (f === "weeks") c.wl = []; });
    d.onclick = async (e) => {
      const del = e.target.closest("[data-del]"); if (del) { list.splice(+del.dataset.del, 1); draw(); return; }
      if (e.target.closest("#ceAdd")) { list.push({ id: "d" + Date.now(), name: "", day: 0, start: 1, end: 2, weeks: "1-16", location: "", teacher: "" }); draw(); const ins = $$(".ce-r input[data-f=name]", d); ins[ins.length - 1].focus(); return; }
      if (e.target.closest("#ceClear")) { const ok = await confirmBox("清空全部课程？", "点「保存」以后才会真的清空。", "清空", true); openOverlay(d); if (ok) { list = []; draw(); } return; }   // 确认框会盖掉这个窗口，确认完再放回来
      if (e.target.closest('[data-a="no"]')) { closeOverlay(); return; }
      if (e.target.closest("#ceSave")) {
        for (const c of list) { const err = c.name ? this.check({ ...c, weeks: c.weeks || "1-16" }) : ""; if (err) return toast(`「${c.name || "没写名字的课"}」：${err}`, { bad: true }); }
        const m = { week1: $("#ceW1", d).value ? M.mondayKey($("#ceW1", d).value) : meta.week1 || null };
        const md = $("#ceMode", d).value;
        m.times = md === "custom" ? $$("[data-t]", d).map((x) => x.value.trim()).filter((t) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t)) : PERIOD_PRESETS[md];
        if (md === "custom" && m.times.length < 4) return toast("自己填的作息时间至少要 4 节，格式 08:00-08:45", { bad: true });
        const ok = await this.save(list.filter((c) => c.name).map((c) => ({ ...c, weeks: M.weeksText(M.parseWeeks(c.weeks || "")) || c.weeks })), m);
        if (ok) closeOverlay();
      }
    };
    $("#ceMode", d).onchange = (e) => $("#ceTimes", d).classList.toggle("hidden", e.target.value !== "custom");
    openOverlay(d);
  },
  // ---------- 截图识别导入 ----------
  async importShot(file) {
    let b64 = null;
    if (file) b64 = await this.compress(file);
    else {
      b64 = await call("clip:image");
      if (!b64) {
        const pickF = await new Promise((res) => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = () => res(i.files[0] || null); i.click(); setTimeout(() => res(null), 120000); });
        if (!pickF) return toast("先在教务系统里把课表截图（Win+Shift+S），再点「截图导入」或在课程表页按 Ctrl+V");
        b64 = await this.compress(pickF);
      } else b64 = await this.compress(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "image/jpeg" }));
    }
    const d = h(`<div class="dialog wide" role="dialog"><h3>截图导入课程表</h3><div class="dbody"><img class="ci-prev" src="data:image/jpeg;base64,${b64}"><div class="ci-st" id="ciSt">上传中…</div></div><div class="dfoot"><span class="grow"></span><button class="btn" data-a="no">取消</button></div></div>`);
    let cancel = false;
    d.querySelector('[data-a="no"]').onclick = () => { cancel = true; closeOverlay(); };
    openOverlay(d, () => { cancel = true; });
    const st = $("#ciSt", d), t0 = Date.now();
    try {
      const { job_id } = await api("course_ocr_start", { img: b64 }, true);
      let r = null;
      while (Date.now() - t0 < 160000 && !cancel) {
        await new Promise((res) => setTimeout(res, 1000));
        try { r = await api("course_ocr_status", { jid: job_id }, true); } catch (e) { r = null; }
        st.textContent = `识别中… ${r && r.progress ? r.progress + "%，" : ""}${Math.round((Date.now() - t0) / 1000)} 秒（一般 5~15 秒）`;
        if (r && r.status !== "running") break;
      }
      if (cancel) return;
      if (!r || r.status !== "done" || !r.result) throw new Error((r && r.message) || "识别超时了，请稍后再试");
      closeOverlay(); this.review(r.result, b64);
    } catch (e) { st.textContent = "没成功：" + cleanErr(e); st.classList.add("bad"); }
  },
  async compress(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("图片打不开，请换成 JPG 或 PNG")); i.src = url; });
      let max = 2200, q = 0.9, out = "";
      for (let k = 0; k < 4; k++) {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q).split(",")[1];
        if (out.length < 4_000_000) return out;
        max = Math.round(max * 0.8); q -= 0.08;
      }
      return out;
    } finally { URL.revokeObjectURL(url); }
  },
  review(res, b64) {
    const rows = (res.courses || []).map((c) => ({ on: true, name: c.name, day: c.day, start: c.start, end: c.end, weeks: c.weeks || "", location: c.location || "", teacher: c.teacher || "", conf: c.conf, orig: { name: c.name, location: c.location || "", teacher: c.teacher || "" } }));
    const guess = Math.max(16, ...rows.flatMap((r) => [...M.parseWeeks(r.weeks || "1-16")]));
    for (const r of rows) if (!r.weeks) { r.weeks = `1-${guess}`; r.wguess = true; }
    const times = res.times || {}, nper = Math.max(res.periods || 0, ...rows.map((r) => r.end || 0)), full = [];
    for (let i = 1; i <= nper; i++) { const t = times[i] || times[String(i)]; if (!t || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t)) { full.length = 0; break; } full.push(t); }
    const have = this.list().length;
    const d = h(`<div class="dialog wide ce" role="dialog"><h3>核对识别结果</h3><div class="dbody">
      <div class="muted">${rows.length ? `认出 ${rows.length} 门课，请逐门核对（标黄的是不太确定的），可以直接改。` : "没认出课程，换一张更清楚、更完整的截图试试。"}${(res.warnings || []).map((w) => "<br>" + esc(w)).join("")}</div>
      <div class="ce-list" id="ciList"></div>
      <div class="row ce-top"><label class="field">第 1 周的星期一<input type="date" class="input" id="ciW1" value="${esc(App.S.courses.meta.week1 || "")}"></label>
        ${full.length >= 4 ? `<label class="row" style="gap:6px"><input type="checkbox" id="ciTimes" checked> 同时用截图里的上课时间（${full.length} 节）</label>` : ""}
        ${have ? `<label class="row" style="gap:6px"><input type="radio" name="cm" value="replace" checked> 替换原来的 ${have} 门课</label><label class="row" style="gap:6px"><input type="radio" name="cm" value="merge"> 合并（保留原来的）</label>` : ""}
        <label class="row" style="gap:6px" title="帮开发者改进识别"><input type="checkbox" id="ciShare"> 把这张截图和核对结果交给开发者改进识别</label></div></div>
      <div class="dfoot"><span class="grow"></span><button class="btn" data-a="no">取消</button><button class="btn primary" id="ciSave"${rows.length ? "" : " disabled"}>导入</button></div></div>`);
    const draw = () => { $("#ciList", d).innerHTML = rows.map((r, i) => `<div class="ce-r${r.on ? "" : " off"}" data-i="${i}" style="--c:${M.colorFor(r.name)}"><input type="checkbox" data-f="on"${r.on ? " checked" : ""}>
      <input class="input${r.conf != null && r.conf < 0.9 ? " warn" : ""}" data-f="name" value="${esc(r.name)}"><select class="input" data-f="day">${DAYS7.map((x, k) => `<option value="${k}"${+r.day === k ? " selected" : ""}>${x}</option>`).join("")}</select>
      <span class="ce-p"><input class="input" type="number" min="1" max="16" data-f="start" value="${r.start}">-<input class="input" type="number" min="1" max="16" data-f="end" value="${r.end}"></span>
      <input class="input${r.wguess ? " warn" : ""}" data-f="weeks" value="${esc(r.weeks)}"><input class="input" data-f="location" value="${esc(r.location)}" placeholder="地点"><input class="input" data-f="teacher" value="${esc(r.teacher)}" placeholder="老师"></div>`).join(""); };
    draw();
    d.addEventListener("input", (e) => { const r = e.target.closest(".ce-r"), f = e.target.dataset.f; if (!r || !f) return; const x = rows[+r.dataset.i]; x[f] = f === "on" ? e.target.checked : ["day", "start", "end"].includes(f) ? +e.target.value : e.target.value; if (f === "on") r.classList.toggle("off", !x.on); });
    d.querySelector('[data-a="no"]').onclick = () => closeOverlay();
    $("#ciSave", d).onclick = async () => {
      const pick = rows.filter((r) => r.on && r.name);
      for (const r of pick) { const err = this.check(r); if (err) return toast(`「${r.name}」：${err}`, { bad: true }); }
      const stamp = Date.now(), fresh = pick.map((r, i) => ({ id: `ocr${stamp}_${i}`, name: r.name, day: r.day, start: r.start, end: r.end, weeks: M.weeksText(M.parseWeeks(r.weeks)) || r.weeks, location: r.location, teacher: r.teacher }));
      const merge = (d.querySelector("[name=cm]:checked") || {}).value === "merge";
      let list = fresh;
      if (merge) { const sig = (c) => [c.name, c.day, c.start, c.end].join("|"), seen = new Set(this.list().map(sig)); list = this.list().concat(fresh.filter((c) => !seen.has(sig(c)))); }
      const m = {}; const w1 = $("#ciW1", d).value; if (w1) m.week1 = M.mondayKey(w1);
      if ($("#ciTimes", d) && $("#ciTimes", d).checked) m.times = full;
      // 「越用越准」：把改过的字交给服务器学习（和网页版共用）
      const learn = rows.filter((r) => r.on).flatMap((r) => ["name", "location", "teacher"].filter((f) => r.orig[f] && r[f] && r.orig[f] !== r[f]).map((f) => ({ f, w: r.orig[f], r: r[f] })));
      if (learn.length) api("course_learn_submit", { items: learn }, true).catch(() => {});
      if ($("#ciShare", d).checked) api("course_ocr_sample_add", { img: b64, ocr: { courses: res.courses, times: res.times, periods: res.periods }, final: pick.map(({ name, day, start, end, weeks, location, teacher }) => ({ name, day, start, end, weeks, location, teacher })) }, true).catch(() => {});
      if (await this.save(list, m, `已导入 ${fresh.length} 门课 🎉 网页和手机上也会更新`)) { closeOverlay(); App.go("week"); }
    };
    openOverlay(d);
  },
};

// ---------- 课表页面：打印 / PDF / 图片 / 壁纸 ----------
function timetableHtml(mon, opt = {}) {
  const S = App.S, meta = S.courses.meta || {}, times = M.periodTimes(meta), all = S.courses.courses || [];
  const nP = Math.max(8, ...all.map((c) => c.end || c.start)), days = Array.from({ length: 7 }, (_, i) => M.addDays(mon, i)), weekend = all.some((c) => c.day >= 5), nd = weekend ? 7 : 5;
  const wk = M.weekOf(meta, mon), tk = todayKey();
  const hw = App.items().filter((x) => !x.hidden && !x.done && x.type === "作业" && x.day && x.day >= M.dayKey(mon) && x.day <= M.dayKey(M.addDays(mon, 6))).sort((a, b) => a.day.localeCompare(b.day));
  let cells = "";
  for (let i = 0; i < nd; i++) for (const c of M.coursesOn(S.courses, days[i])) {
    cells += `<div class="c" style="grid-column:${i + 2};grid-row:${c.start + 1}/${(c.end || c.start) + 2};--c:${c.color}"><b>${esc(c.name)}</b>${c.location ? `<span>${esc(c.location)}</span>` : ""}${c.teacher && c.end > c.start ? `<span>${esc(c.teacher)}</span>` : ""}</div>`;
  }
  const head = days.slice(0, nd).map((d, i) => `<div class="h${M.dayKey(d) === tk && !opt.print ? " t" : ""}" style="grid-column:${i + 2}">周${"一二三四五六日"[i]}<small>${d.getMonth() + 1}/${d.getDate()}</small></div>`).join("");
  const rows = Array.from({ length: nP }, (_, p) => `<div class="p" style="grid-row:${p + 2}"><b>${p + 1}</b><small>${(times[p] || "").replace("-", "<br>")}</small></div>` + Array.from({ length: nd }, (_, i) => `<div class="e" style="grid-column:${i + 2};grid-row:${p + 2}"></div>`).join("")).join("");
  const grid = `<div class="g" style="grid-template-columns:64px repeat(${nd},1fr);grid-template-rows:auto repeat(${nP},1fr)"><div></div>${head}${rows}${cells}</div>`;
  const title = `${App.className() || "我的"}课程表${wk ? ` · 第 ${wk} 周` : ""}`;
  const css = `*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;color:#1b2740}
    .g{display:grid;gap:3px}.h{text-align:center;font-weight:700;padding:6px 0}.h small{display:block;font-weight:400;opacity:.6}.h.t{color:#3d6ff2}
    .p{display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;opacity:.7}.p b{font-size:14px}.e{border-radius:8px;background:rgba(127,140,170,.08)}
    .c{border-radius:9px;padding:6px 8px;background:color-mix(in srgb,var(--c) 18%,white);border-left:4px solid var(--c);font-size:12px;display:flex;flex-direction:column;gap:2px;overflow:hidden;z-index:1}.c b{font-size:13px}.c span{opacity:.75}
    .hw{margin-top:14px}.hw div{padding:4px 0;border-bottom:1px solid #e3e8f1;font-size:13px}`;
  if (opt.wallpaper) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css}
      body{width:__W__px;height:__H__px;overflow:hidden;background:radial-gradient(1200px 800px at 0% 100%,#8a5cff55,transparent 60%),radial-gradient(1000px 700px at 100% 0%,#2fc3ff55,transparent 60%),linear-gradient(135deg,#1d2b55,#2b2160);color:#fff}
      .wrap{position:absolute;right:4%;top:6%;width:min(62%,1500px);height:78%;background:rgba(255,255,255,.1);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.18);border-radius:22px;padding:22px 24px;display:flex;flex-direction:column}
      h1{margin:0 0 10px;font-size:28px;font-weight:700}h1 small{font-size:15px;opacity:.7;margin-left:10px;font-weight:400}.g{flex:1}.e{background:rgba(255,255,255,.06)}.c{background:color-mix(in srgb,var(--c) 55%,transparent);color:#fff}.p{opacity:.75}.h.t{color:#9fd0ff}
      .hw{position:absolute;left:4%;bottom:8%;width:26%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:16px 20px}.hw b{font-size:18px}.hw div{border-color:rgba(255,255,255,.15)}</style></head><body>
      <div class="wrap"><h1>${esc(title)}<small>${mon.getMonth() + 1}月${mon.getDate()}日这周</small></h1>${grid}</div>
      ${hw.length ? `<div class="hw"><b>📝 这周要交的作业</b>${hw.slice(0, 8).map((x) => `<div>${esc(x.title)} · 周${M.WEEK[M.fromKey(x.day).getDay()]}${x.time ? " " + x.time : ""}</div>`).join("")}</div>` : ""}</body></html>`;
  }
  return printDoc(title, `${mon.getMonth() + 1}月${mon.getDate()}日 – ${M.addDays(mon, 6).getMonth() + 1}月${M.addDays(mon, 6).getDate()}日`,
    `<div style="height:${opt.image ? 640 : 560}px;display:flex">${grid}</div>${hw.length ? `<div class="hw"><b>这周要交的作业</b>${hw.map((x) => `<div>☐ ${esc(x.title)}　<small>周${M.WEEK[M.fromKey(x.day).getDay()]} ${x.day.slice(5).replace("-", "/")}${x.time ? " " + x.time + " 截止" : ""}</small></div>`).join("")}</div>` : ""}`,
    css.replace(/body\{[^}]*\}/, "") + `.g{flex:1}${opt.image ? "body{padding:28px 32px;background:#fff}" : ""}`);
}
// 课表壁纸：新的一周自动换成这周的课表
App.autoWallpaper = async function () {
  try {
    const w = await window.cc.call("wallpaper:state"); if (!w.on || !w.windows) return;
    const mon = M.addDays(App.now(), -M.weekday0(App.now()));
    if (w.at >= mon.setHours(0, 0, 0, 0)) return;
    await window.cc.call("wallpaper:set", timetableHtml(M.addDays(App.now(), -M.weekday0(App.now())), { wallpaper: true }));
  } catch (e) {}
};
