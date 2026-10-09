"use strict";
// ===== 课程表接入系统 =====
// 组员做的课程表（plugins/course-schedule）作为「内置插件」随网站发布，数据还是放在它原来的插件存储里（老数据不丢）。
// 这里补上它自己做不到的事：
//   1. 拍照 / 截图导入课表：图片交给服务器识别（PaddleOCR，不调大模型、不花 token），识别结果逐门核对后再保存
//   2. 课程同步到服务器：每晚发「明天的课」邮件、手机日历订阅里带上课程
//   3. 首页「今日课程」卡片、本地 AI 问答知道你的课
// 依赖 app.js 里的全局变量（PFS、frames、pluginItemsCache、renderAll、CCAuth…），都是调用时才用到。
const CourseKit = (() => {
  const NS = "course-schedule";
  const K = {
    courses: "personal_course_schedule_courses_v1",
    mode: "personal_course_schedule_time_mode_v1",
    custom: "personal_course_schedule_custom_times_v1",
    week1: "plg_course-schedule_week1",
    adj: "personal_course_schedule_adjust_v1",   // 调课 / 调休 / 停课 / 加课（见 coursesOn）
  };
  const VER = "20261009-adj3";
  const DEFAULT_WEEK1 = "2026-09-14";
  const MAX_WEEK = 20;
  const PERIODS = {
    winter: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:00-14:50", "15:00-15:50", "16:10-17:00", "17:10-18:00", "19:10-20:00", "20:10-21:00"],
    summer: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20", "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30"],
  };
  const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const LS_SYNC = "course_sync_sig_v1", LS_ICS = "course_ics_v1";
  // 课表「版本」：哪台设备把课表传上服务器，就把服务器时间写在这里；它随「我的数据」几秒内同步到别的设备，别的设备看到变了就去拿新课表
  const LS_REV = "course_rev_v1";
  const TIME_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
  let data = { courses: [], week1: DEFAULT_WEEK1, times: PERIODS.summer, mode: "", custom: null, loaded: false };
  let builtinCode = null;

  const on = () => typeof feat !== "function" || feat("courses");
  const js = (v, d) => { try { const x = JSON.parse(v); return x == null ? d : x; } catch (e) { return d; } };
  const mondayOf = (k) => { const d = new Date(k + "T00:00:00"); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return keyOf(d); };

  // 和课程表里一样的周次规则（空的 = 全部周）
  function parseWeeks(str) {
    const set = new Set(), s = typeof str === "string" ? str.trim() : "";
    if (!s) { for (let z = 1; z <= 16; z++) set.add(z); return set; }
    const pm = s.match(/^(\d+)\s*[-–—~至]\s*(\d+)\s*[（(]?\s*(单|双)\s*[）)]?$/);
    if (pm) { for (let i = +pm[1]; i <= +pm[2]; i++) if ((pm[3] === "单") === (i % 2 === 1)) set.add(i); return set; }
    for (const part of s.split(/[,，、;；\s]+/)) {
      const r = part.match(/^(\d+)\s*[-–—~至]\s*(\d+)$/);
      if (r) { let [x, y] = [+r[1], +r[2]]; if (x > y) [x, y] = [y, x]; for (let k = x; k <= y && k <= 30; k++) set.add(k); }
      else if (/^\d+$/.test(part) && +part <= 30) set.add(+part);
    }
    return set;
  }
  // 周次集合 → 课程表的写法：1-16、1-15单、2-16双、1-3,5-8
  function weeksText(ws) {
    const a = [...ws].filter((x) => x >= 1 && x <= 30).sort((x, y) => x - y);
    if (!a.length) return "";
    if (a.length >= 3 && a.every((x, i) => i === 0 || x - a[i - 1] === 2)) return `${a[0]}-${a[a.length - 1]}${a[0] % 2 ? "单" : "双"}`;
    const runs = []; let st = a[0];
    for (let i = 1; i <= a.length; i++) if (a[i] !== a[i - 1] + 1) { runs.push(st === a[i - 1] ? `${st}` : `${st}-${a[i - 1]}`); st = a[i]; }
    return runs.join(",");
  }

  // ---------- 读写课程表的存储 ----------
  async function read() {
    const st = await PFS.all(NS);
    const courses = js(st[K.courses], []);
    const custom = js(st[K.custom], null);
    const customOk = Array.isArray(custom) && custom.length >= 4 && custom.every((t) => TIME_RE.test(t));
    const mode = st[K.mode] || "";
    const m = (typeof ccDate === "function" ? ccDate() : new Date()).getMonth() + 1;
    const times = mode === "custom" && customOk ? custom : PERIODS[mode === "winter" || mode === "summer" ? mode : (m >= 5 && m <= 10 ? "summer" : "winter")];
    const w1 = js(st[K.week1], DEFAULT_WEEK1);
    data = { courses: Array.isArray(courses) ? courses.filter((c) => c && c.name) : [], week1: /^\d{4}-\d{2}-\d{2}$/.test(w1) ? w1 : DEFAULT_WEEK1,
      times, mode, custom: customOk ? custom : null, adj: cleanAdj(js(st[K.adj], [])), loaded: true };
    return data;
  }
  async function write(kv) {
    for (const [k, v] of Object.entries(kv)) {
      await PFS.put(NS, k, v);
      // 开着的课程表页面跟着刷新（隔离间收到后会发 storage 事件）
      for (const f of frames.values()) if (f.meta && f.meta.ns === NS) f.post({ cc: "store", key: k, value: v });
    }
    delete pluginItemsCache[NS];
    await read();
    try { renderAll(); } catch (e) {}
    changed();
  }

  // ---------- 某一天的课 ----------
  function weekOf(k) { return Math.floor((new Date(k + "T00:00:00") - new Date(data.week1 + "T00:00:00")) / 86400000 / 7) + 1; }
  // 课表里原本这一天的课（不管调课）
  function baseOn(k) {
    const wk = weekOf(k), day = (new Date(k + "T00:00:00").getDay() + 6) % 7;
    if (wk < 1 || wk > MAX_WEEK) return [];
    return data.courses.filter((c) => Number(c.day) === day && parseWeeks(c.weeks).has(wk))
      .map((c) => ({ ...c, t0: (data.times[c.start - 1] || "").split("-")[0], t1: (data.times[c.end - 1] || "").split("-")[1] || "", week: wk }));
  }
  // ---------- 调课 / 调休（学校临时通知） ----------
  //   swap：date 这天按 from 那天的课上（调休补课：周六上周三的课）
  //   off：date 这天放假 / 停课，一节都没有
  //   cancel：date 这天某一门课不上（name，可指定 start 节）
  //   add：date 这天加一节课（name、start-end、location、teacher）
  // 和小程序（mp/lib/courses.js）、服务器（courses_on：邮件提醒、手机日历订阅）是同一套规则
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
  function adjOn(k) { return (data.adj || []).filter((a) => a.date === k); }
  function coursesOn(k) {
    const on = adjOn(k);
    let list;
    if (on.some((a) => a.type === "off")) list = [];
    else {
      const sw = on.find((a) => a.type === "swap");
      list = sw ? baseOn(sw.from).map((c) => ({ ...c, _from: sw.from })) : baseOn(k);
    }
    for (const a of on) if (a.type === "cancel") list = list.filter((c) => !(c.name === a.name && (!a.start || +a.start === +c.start)));
    const wk = weekOf(k);
    for (const a of on) if (a.type === "add") list.push({ id: "adj_" + a.id, name: a.name, start: a.start, end: a.end, location: a.location || "", teacher: a.teacher || "",
      t0: (data.times[a.start - 1] || "").split("-")[0], t1: (data.times[a.end - 1] || "").split("-")[1] || "", week: wk, _add: true });
    return list.sort((a, b) => a.start - b.start);
  }
  // 这一天的调整说明（日历、课表表头用）：「放假」「上 10月8日（周三）的课」「加课」
  function dayNote(k) {
    const on = adjOn(k); if (!on.length) return "";
    if (on.some((a) => a.type === "off")) return (on.find((a) => a.type === "off").note || "放假 / 停课");
    const sw = on.find((a) => a.type === "swap");
    const parts = [];
    if (sw) parts.push(`上 ${mdw(sw.from)} 的课`);
    const nc = on.filter((a) => a.type === "cancel").length, na = on.filter((a) => a.type === "add").length;
    if (nc) parts.push(`停 ${nc} 节`); if (na) parts.push(`加 ${na} 节`);
    return parts.join("，");
  }
  const mdw = (k) => { const d = new Date(k + "T00:00:00"); return `${d.getMonth() + 1}月${d.getDate()}日（${DAYS[(d.getDay() + 6) % 7]}）`; };

  // ---------- 同步到服务器（邮件提醒、手机日历订阅用） ----------
  let syncTimer = 0, syncing = false;
  function payload() {
    const courses = data.courses.slice(0, 200).map((c) => ({ id: String(c.id || "").slice(0, 40), name: String(c.name).slice(0, 60), day: +c.day, start: +c.start, end: +c.end,
      weeks: String(c.weeks || "").slice(0, 40), wl: [...parseWeeks(c.weeks)].sort((a, b) => a - b), location: String(c.location || "").slice(0, 60), teacher: String(c.teacher || "").slice(0, 40) }));
    return { p_courses: courses, p_meta: { week1: mondayOf(data.week1), times: data.times.slice(0, 16), ics: load(LS_ICS, true) !== false, adj: cleanAdj(data.adj) } };
  }
  function changed() {
    const L = load(LS_SYNC, {}); L.editAt = Sync.now(); try { localStorage.setItem(LS_SYNC, JSON.stringify(L)); } catch (e) {}
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync().catch(() => {}), 1200);
  }
  async function sync(force) {
    if (!currentUser || !on() || syncing) return null;
    if (!data.loaded) await read();
    const p = payload(), sig = JSON.stringify(p);
    const last = load(LS_SYNC, {});
    if (!force && last.uid === currentUser.id && last.sig === sig) return null;
    if (!p.p_courses.length && !(last.uid === currentUser.id && last.n)) return null;   // 从没同步过、也没有课：不用传
    syncing = true;
    try {
      const r = await CCAuth.rpc("courses_sync", p);
      const srv = (r && r.updated_at) || "";
      save(LS_SYNC, { uid: currentUser.id, sig, n: p.p_courses.length, at: Date.now(), srv });
      if (srv) save(LS_REV, { at: srv, n: p.p_courses.length });   // 告诉别的设备：课表变了
      renderBar();
      return r;
    } finally { syncing = false; }
  }

  // ---------- 内置插件 ----------
  async function injectBuiltin(list) {
    if (!on()) return list;
    const meta = { id: NS, key: NS, ns: NS, name: "课程表", icon: "📚", version: "2", author_name: "信息捞捞队",
      description: "组员做的课程表：拍照导入课表、每晚提醒明天的课、同步到手机日历", default_on: true, channel: "builtin" };
    return [meta, ...list.filter((p) => !(p.id === NS && p.channel === "published"))];
  }
  async function loadBuiltin() {
    if (builtinCode) return builtinCode;
    const get = async (f) => { const r = await fetch(`plugins/course-schedule/${f}?v=${VER}`, { cache: "no-cache" }); if (!r.ok) throw new Error("课程表文件读取失败"); return r.text(); };
    const [code, app_html] = await Promise.all([get("plugin.js"), get("app.html")]);
    return (builtinCode = { code, app_html });
  }

  // ---------- 课程表页面上方的工具条 ----------
  let barEl = null;
  function decorateTab(sec) {
    barEl = document.createElement("div");
    barEl.className = "cbar surface";
    sec.insertBefore(barEl, sec.children[1] || null);
    barEl.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.c === "import") openImport();
      if (b.dataset.c === "adjust") openAdjust();
      if (b.dataset.c === "mail") { showView("me"); setTimeout(() => { const m = $("mailBox"); if (m) m.scrollIntoView({ behavior: "smooth", block: "center" }); }, 200); }
    });
    barEl.addEventListener("change", (e) => {
      if (e.target.id === "crsBarIcs") { save(LS_ICS, e.target.checked); sync(true).catch(() => {}); }
    });
    renderBar();
  }
  function renderBar() {
    if (!barEl) return;
    const last = currentUser ? load(LS_SYNC, {}) : {};
    const synced = last.uid === (currentUser && currentUser.id) && last.at;
    const mailOn = typeof mailInfo !== "undefined" && mailInfo && mailInfo.email && mailInfo.prefs && mailInfo.prefs.course;
    const upcoming = (data.adj || []).filter((a) => a.date >= keyOf(ccDate())).length;
    barEl.innerHTML = `<button class="btn ink sm" data-c="import">📷 拍照导入课表</button>
      <button class="btn sm" data-c="adjust" title="学校临时调休、换课、停课、加课">🔁 调课 / 调休${upcoming ? `<em class="cbar-n">${upcoming}</em>` : ""}</button>
      <span class="cbar-t">${data.courses.length ? `共 ${data.courses.length} 门课` : "还没有课程"}${currentUser ? (synced ? " · ☁ 已同步" : data.courses.length ? " · 同步中…" : "") : " · 登录后可同步"}</span>
      <span class="spacer"></span>
      ${currentUser ? `<button class="small" data-c="mail">${mailOn ? "🔔 每晚提醒明天的课：开" : "🔕 每晚提醒明天的课：关"}</button>
      <label class="cbar-ck"><input type="checkbox" id="crsBarIcs" ${load(LS_ICS, true) !== false ? "checked" : ""}>手机日历订阅里带上课程</label>` : ""}`;
  }

  // ---------- 调课 / 调休 的弹窗 ----------
  let adjTab = "swap";
  const nextSat = () => { const d = ccDate(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return keyOf(d); };
  const adjText = (a) => a.type === "swap" ? `上 ${mdw(a.from)} 的课` : a.type === "off" ? `放假 / 停课${a.note ? "：" + a.note : ""}`
    : a.type === "cancel" ? `「${a.name}」${a.start ? "第" + a.start + "节" : ""}不上` : `加课「${a.name}」第${a.start}${a.end > a.start ? "-" + a.end : ""}节${a.location ? " · " + a.location : ""}`;
  function adjDialog() {
    let d = document.getElementById("crsAdjDlg");
    if (!d) { d = document.createElement("dialog"); d.id = "crsAdjDlg"; d.className = "dlg kn-dlg crs-adj"; document.body.appendChild(d);
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); }
    return d;
  }
  function openAdjust() { read().then(() => { adjRender(); const d = adjDialog(); if (!d.open) d.showModal(); }); }
  function adjRender(msg) {
    const d = adjDialog(), today = keyOf(ccDate()), list = (data.adj || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const coming = list.filter((a) => a.date >= today), past = list.filter((a) => a.date < today);
    const nper = Math.max(data.times.length, 10, ...data.courses.map((c) => +c.end || 0));
    const pers = Array.from({ length: nper }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 节${data.times[i] ? "（" + data.times[i].split("-")[0] + "）" : ""}</option>`).join("");
    const names = [...new Set(data.courses.map((c) => c.name))];
    const row = (a) => `<div class="adj-row${a.date < today ? " past" : ""}"><b>${mdw(a.date)}</b><span>${esc(adjText(a))}</span><button type="button" class="small" data-adjdel="${esc(a.id)}">删除</button></div>`;
    const tabs = [["swap", "🔁 换课（调休）"], ["off", "🏖 放假 / 停课"], ["add", "➕ 加一节课"]];
    d.innerHTML = `<form id="adjForm"><h3>调课 / 调休<small>学校临时通知换课、补课、放假、加课，在这里记一下，课表、首页、日历、提醒都会跟着变</small></h3>
      <div class="ptabs adj-tabs">${tabs.map(([k, t]) => `<button type="button" class="ptab${adjTab === k ? " on" : ""}" data-adjtab="${k}">${t}</button>`).join("")}</div>
      ${adjTab === "swap" ? `<div class="adj-grid"><label>哪天上课<input type="date" id="adjB" value="${nextSat()}" required></label><label>上哪天的课<input type="date" id="adjA" required></label></div>
          <label class="check"><input type="checkbox" id="adjAoff" checked>那天（课被挪走的那天）放假，不上课</label>`
      : adjTab === "off" ? `<div class="adj-grid"><label>日期<input type="date" id="adjD" value="${today}" required></label><label>到（放好几天时填）<input type="date" id="adjD2"></label></div>
          <label>停哪些课<select id="adjWhich"><option value="">整天都不上</option></select></label>
          <label>说明（可以不填）<input id="adjNote" maxlength="30" placeholder="如 国庆放假、运动会停课"></label>`
      : `<div class="adj-grid"><label>日期<input type="date" id="adjD" value="${today}" required></label><label>课程<input id="adjName" list="adjNames" maxlength="60" placeholder="课程名" required><datalist id="adjNames">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></label></div>
          <div class="adj-grid"><label>第几节开始<select id="adjS">${pers}</select></label><label>到第几节<select id="adjE">${pers}</select></label></div>
          <div class="adj-grid"><label>地点<input id="adjLoc" maxlength="60" placeholder="可以不填"></label><label>老师<input id="adjT" maxlength="40" placeholder="可以不填"></label></div>`}
      <div class="adj-prev" id="adjPrev"></div>
      <div class="nd-actions"><span class="meta" id="adjSt">${esc(msg || "")}</span><span class="spacer"></span><button type="button" class="small" data-adjclose="1">关闭</button><button type="submit" class="btn ink sm">添加</button></div>
      <div class="adj-list"><div class="adj-h">已经记下的${coming.length ? `（${coming.length}）` : ""}</div>${coming.length ? coming.map(row).join("") : `<div class="meta">还没有。比如「国庆调休：10月11日（周六）上 10月8日（周三）的课」</div>`}
        ${past.length ? `<details><summary>已经过去的 ${past.length} 条</summary>${past.map(row).join("")}<button type="button" class="small" data-adjclean="1">清掉已经过去的</button></details>` : ""}</div>
    </form>`;
    adjPreview();
  }
  function adjPreview() {
    const d = adjDialog(), $q = (id) => d.querySelector("#" + id), pv = $q("adjPrev"); if (!pv) return;
    const names = (k) => { const l = baseOn(k); return l.length ? l.map((c) => c.name).join("、") : "没有课"; };
    if (adjTab === "swap") {
      const A = $q("adjA").value, B = $q("adjB").value;
      pv.textContent = A && B ? `${mdw(B)} 上 ${mdw(A)} 的课：${names(A)}${$q("adjAoff").checked ? `；${mdw(A)} 放假` : ""}` : "选好两个日期，这里会显示要上哪些课";
    } else if (adjTab === "off") {
      const D = $q("adjD").value, sel = $q("adjWhich"), cur = sel.value;
      const l = D ? coursesOn(D) : [];
      sel.innerHTML = `<option value="">整天都不上</option>` + l.filter((c) => !c._add).map((c) => `<option value="${esc(c.name)}|${c.start}">只停「${esc(c.name)}」第${c.start}${c.end > c.start ? "-" + c.end : ""}节</option>`).join("");
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
      pv.textContent = D ? `${mdw(D)} 原来的课：${l.length ? l.map((c) => c.name).join("、") : "没有课"}` : "";
    } else {
      const n = $q("adjName").value.trim(), c = data.courses.find((x) => x.name === n);
      if (c && !$q("adjLoc").value && !$q("adjT").value) { $q("adjLoc").value = c.location || ""; $q("adjT").value = c.teacher || ""; }
      if (+$q("adjE").value < +$q("adjS").value) $q("adjE").value = $q("adjS").value;
      pv.textContent = "";
    }
  }
  async function adjSave(list, msg) {
    data.adj = cleanAdj(list);
    await write({ [K.adj]: JSON.stringify(data.adj) });
    renderBar(); adjRender(msg);
  }
  document.addEventListener("input", (e) => { if (e.target.closest && e.target.closest("#crsAdjDlg")) adjPreview(); });
  document.addEventListener("change", (e) => { if (e.target.closest && e.target.closest("#crsAdjDlg")) adjPreview(); });
  document.addEventListener("click", async (e) => {
    const t = e.target.closest && e.target.closest("#crsAdjDlg button"); if (!t) return;
    if (t.dataset.adjtab) { adjTab = t.dataset.adjtab; adjRender(); return; }
    if (t.dataset.adjclose) { adjDialog().close(); return; }
    if (t.dataset.adjdel) { await adjSave(data.adj.filter((a) => a.id !== t.dataset.adjdel), "已删除"); return; }
    if (t.dataset.adjclean) { const today = keyOf(ccDate()); await adjSave(data.adj.filter((a) => a.date >= today), "已清掉"); return; }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "adjForm") return;
    e.preventDefault();
    const d = adjDialog(), $q = (id) => d.querySelector("#" + id), st = $q("adjSt"), id = () => Math.random().toString(36).slice(2, 10);
    const list = (data.adj || []).slice(); let msg = "";
    if (adjTab === "swap") {
      const A = $q("adjA").value, B = $q("adjB").value;
      if (!A || !B) { st.textContent = "两个日期都要选"; return; }
      if (A === B) { st.textContent = "两个日期不能一样"; return; }
      const rest = list.filter((a) => !(a.date === B && (a.type === "swap" || a.type === "off")));
      rest.push({ id: id(), date: B, type: "swap", from: A });
      if ($q("adjAoff").checked && !rest.some((a) => a.date === A && a.type === "off")) rest.push({ id: id(), date: A, type: "off", note: `课挪到 ${mdw(B)}` });
      await adjSave(rest, `已记下：${mdw(B)} 上 ${mdw(A)} 的课`); return;
    }
    if (adjTab === "off") {
      const D = $q("adjD").value, D2 = $q("adjD2").value || D, which = $q("adjWhich").value, note = $q("adjNote").value.trim();
      if (!D) { st.textContent = "选一个日期"; return; }
      if (D2 < D) { st.textContent = "结束日期比开始早"; return; }
      if (which) { const [name, start] = which.split("|"); list.push({ id: id(), date: D, type: "cancel", name, start: +start, note }); msg = `已记下：${mdw(D)}「${name}」不上`; }
      else {
        let k = D, n = 0;
        while (k <= D2 && n < 60) { if (!list.some((a) => a.date === k && a.type === "off")) list.push({ id: id(), date: k, type: "off", note }); const x = new Date(k + "T00:00:00"); x.setDate(x.getDate() + 1); k = keyOf(x); n++; }
        msg = n > 1 ? `已记下：放假 ${n} 天` : `已记下：${mdw(D)} 放假`;
      }
      await adjSave(list, msg); return;
    }
    const D = $q("adjD").value, name = $q("adjName").value.trim();
    if (!D || !name) { st.textContent = "日期和课程名都要填"; return; }
    list.push({ id: id(), date: D, type: "add", name, start: +$q("adjS").value, end: Math.max(+$q("adjS").value, +$q("adjE").value), location: $q("adjLoc").value.trim(), teacher: $q("adjT").value.trim() });
    await adjSave(list, `已记下：${mdw(D)} 加课「${name}」`);
  });

  // ---------- 首页「今日课程」卡片 ----------
  function card(h) {
    const k = keyOf((typeof ccDate === "function" ? ccDate() : new Date())), list = coursesOn(k), now = (typeof ccDate === "function" ? ccDate() : new Date()), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), tl = coursesOn(keyOf(tomorrow));
    const n = Math.max(2, h * 3);
    const row = (c, past) => `<div class="crow${past ? " past" : ""}${!past && c.t0 && c.t0 <= hm && hm < c.t1 ? " now" : ""}"><span class="ct">${esc(c.t0 || "第" + c.start + "节")}</span><span class="cn">${esc(c.name)}</span><span class="cl">${esc(c.location || "")}</span></div>`;
    let body;
    if (!data.courses.length) body = `<div class="empty">还没有课程。<a href="#" data-cimport="1">📷 拍照导入课表</a></div>`;
    else if (list.length) body = list.slice(0, n).map((c) => row(c, c.t1 && c.t1 <= hm)).join("") + (list.length > n ? `<div class="crow more">还有 ${list.length - n} 节…</div>` : "");
    else body = `<div class="empty">今天没有课 🎈${tl.length ? `<br>明天 ${tl.length} 节，第一节 ${esc(tl[0].t0 || "")} ${esc(tl[0].name)}` : ""}</div>`;
    const wk = weekOf(k);
    return `<div class="surface wb wsimple wcourse" data-tab="${esc((pluginTabs.find((x) => x.plugin === NS) || { id: "tools" }).id)}"><h5>📚 今日课程${wk >= 1 && wk <= MAX_WEEK && data.courses.length ? `<small>第${wk}周</small>` : ""}</h5>${body}</div>`;
  }
  function openTab() {
    const t = pluginTabs.find((x) => x.plugin === NS);
    if (t) showView(t.id);
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cimport]")) { e.preventDefault(); openImport(); }
    else if (e.target.closest("[data-ctab]") && !document.documentElement.classList.contains("wediting")) { e.preventDefault(); openTab(); }
  });

  // 首次导入后，把「今日课程」卡片放到首页（用户自己删掉过就不再加）
  function ensureCard() {
    try {
      if (load("course_card_added_v1", false)) return;
      const L = homeLayout();
      if (!L.home.some((x) => x.id === "w:course")) { L.home.splice(Math.min(1, L.home.length), 0, { id: "w:course", w: 2, h: 1 }); saveLayout(L); renderWidgets(); }
      save("course_card_added_v1", true);
    } catch (e) {}
  }

  // ---------- 本地 AI 问答：告诉它今天、明天有什么课 ----------
  function askLines() {
    if (!data.courses.length) return "";
    const t = (typeof ccDate === "function" ? ccDate() : new Date()), out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i), k = keyOf(d), l = coursesOn(k);
      if (l.length) out.push(`${k}（${DAYS[(d.getDay() + 6) % 7]}，第${l[0].week}周）：` + l.map((c) => `第${c.start}-${c.end}节${c.t0 ? " " + c.t0 + "-" + c.t1 : ""} ${c.name}${c.location ? " @" + c.location : ""}`).join("；"));
    }
    return out.length ? "\n我的课程（未来 7 天）：\n" + out.join("\n") : "";
  }

  // ---------- 拍照导入 ----------
  let dlg = null, rows = [], ocrResult = null, removed = [];

  // ---------- 越用越准：记住大家核对时改了什么 ----------
  // 每次导入保存时，把「识别出来的 → 改成的」交给服务器；下次识别后自动套用。
  // 只有自己改过的，或者至少 2 个人都这样改过的才会自动套用（防止一个人乱改影响所有人）。
  const LEARN_FIELDS = ["name", "location", "teacher"];
  let learned = null;
  const isCJK = (ch) => /[\u4e00-\u9fff]/.test(ch || "");
  const isSoft = (ch) => isCJK(ch) || /[ⅠⅡⅢⅣⅤⅥ()（）·]/.test(ch || "");
  function lev(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // a 和 b 只差一个「汉字 / 罗马数字 / 括号」（OCR 常见的认错、漏字），字母数字不同的不算（A400 和 B400 是不同教室）
  function nearOCR(a, b) {
    if (!a || !b || a === b || a.length < 2) return false;
    if (a.length === b.length) {
      const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
      return d.length === 1 && isSoft(a[d[0]]) && isSoft(b[d[0]]);
    }
    const [s1, l1] = a.length < b.length ? [a, b] : [b, a];
    if (l1.length - s1.length !== 1) return false;
    for (let i = 0; i < l1.length; i++) if (l1.slice(0, i) + l1.slice(i + 1) === s1) return isSoft(l1[i]);
    return false;
  }
  async function loadLearned() {
    if (!currentUser) return null;
    try {
      const rowsL = (await CCAuth.rpc("course_learn_get")) || [];
      const L = { fixes: new Map(), vocab: { name: new Map(), location: new Map(), teacher: new Map() }, junk: new Set(), maxweek: 0 };
      for (const [f, w, r, n, mine] of rowsL) {
        const score = n + (mine ? 100 : 0);
        if (LEARN_FIELDS.includes(f)) { const k = f + "|" + w, old = L.fixes.get(k); if (!old || old.score < score) L.fixes.set(k, { right: r, score }); }
        else if (f.startsWith("vocab_")) { const m = L.vocab[f.slice(6)]; if (m) m.set(r, Math.max(m.get(r) || 0, score)); }
        else if (f === "junk") L.junk.add(w);
        else if (f === "maxweek" && (mine || n >= 2)) L.maxweek = Math.max(L.maxweek, +r || 0);
      }
      return (learned = L);
    } catch (e) { return null; }
  }
  function learnApply(list) {
    if (!learned) return 0;
    let n = 0;
    for (const r of list) {
      r.learned = {};
      for (const f of LEARN_FIELDS) {
        const v = r[f]; if (!v) continue;
        const fx = learned.fixes.get(f + "|" + v);
        if (fx && fx.right !== v) { r[f] = fx.right; r.learned[f] = v; n++; continue; }
        const voc = learned.vocab[f];
        if (voc.has(v)) continue;
        const cands = [...voc.entries()].filter(([c]) => nearOCR(v, c)).sort((a, b) => b[1] - a[1]);
        if (cands.length === 1 || (cands.length > 1 && cands[0][1] >= cands[1][1] + 100)) { r[f] = cands[0][0]; r.learned[f] = v; n++; }
      }
      if (learned.junk.has(r.name)) { r.on = false; r.learned.junk = true; n++; }
    }
    return n;
  }
  function learnSubmit(final) {
    if (!currentUser) return;
    const items = [], add = (f, w, r) => { if (items.length < 300) items.push({ f, w: String(w || "").slice(0, 80), r: String(r || "").slice(0, 80) }); };
    for (const r of final) {
      const o = r.orig;
      if (o) {
        for (const f of LEARN_FIELDS) {
          const was = r.learned && r.learned[f] ? r.learned[f] : o[f];   // 自动改过又被改回去的：记的是原始识别结果
          if (was && r[f] && was !== r[f] && lev(was, r[f], 3) <= Math.max(1, Math.floor(Math.max(was.length, r[f].length) / 3))) add(f, was, r[f]);
        }
        if (o.day !== r.day || o.start !== r.start || o.end !== r.end) add("pos", `${o.day}:${o.start}-${o.end}`, `${r.day}:${r.start}-${r.end}`);
        if (o.weeks && o.weeksFound && weeksText(parseWeeks(o.weeks)) !== weeksText(parseWeeks(r.weeks))) add("weeks", o.weeks, r.weeks);
        if (!r.on && o.name) add("junk", o.name, "");
      }
      if (r.on) for (const f of LEARN_FIELDS) if (r[f]) add("vocab_" + f, "", r[f]);
    }
    for (const r of removed) if (r.orig && r.orig.name) add("junk", r.orig.name, "");
    const mw = Math.max(0, ...final.filter((r) => r.on).flatMap((r) => [...parseWeeks(r.weeks)]));
    if (mw) add("maxweek", "", String(mw));
    if (items.length) CCAuth.rpc("course_learn_submit", { items }).catch(() => {});
  }
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "dlg cdlg"; dlg.id = "courseDlg";
    dlg.innerHTML = `<form method="dialog" id="crsForm">
      <button type="button" class="cal-x" data-x="1" aria-label="关闭">✕</button>
      <h3>📷 拍照导入课表</h3>
      <div id="crsStep1">
        <div class="cdrop" id="crsDrop" tabindex="0">
          <input type="file" accept="image/*" id="crsFile" hidden>
          <div class="cdrop-in"><b>选一张课表截图</b><small>教务系统网页、课表 App 截图都行，也可以拍电脑屏幕；电脑上可以直接粘贴（Ctrl+V）或拖进来</small></div>
          <img id="crsPrev" alt="" hidden>
        </div>
        <ul class="ctips"><li>截全：要看得到「星期一…星期日」和左边的节次</li><li>App 截图通常只显示「本周」的课，周次可能要自己核对</li><li>图片只用来识别，识别完不保存</li><li>你核对时改的地方会被记住，越用越准</li></ul>
        <div class="cal-row"><button type="button" class="btn ink" id="crsGo" disabled>开始识别</button><span class="cal-st" id="crsSt"></span></div>
      </div>
      <div id="crsStep2" hidden>
        <div class="cal-st" id="crsWarn"></div>
        <div class="crev-h"><b id="crsCount"></b><span class="spacer"></span><button type="button" class="small" id="crsAdd">＋ 加一门</button><button type="button" class="small" id="crsRe">换一张图</button></div>
        <div class="crev" id="crsRev"></div>
        <div class="cal-card cset">
          <label class="crow2">第 1 周的周一是<input type="date" id="crsW1"></label>
          <label class="crow2 hidden" id="crsTimesRow"><span><input type="checkbox" id="crsTimes" checked> 使用截图里的上课时间</span><small id="crsTimesTxt"></small></label>
          <div class="crow2 hidden" id="crsModeRow"><label><input type="radio" name="cMode" value="replace" checked> 替换现有的 <b id="crsOld"></b> 门课</label><label><input type="radio" name="cMode" value="merge"> 加到现有课程里（相同的不重复）</label></div>
          <label class="crow2" id="crsMailRow"><span><input type="checkbox" id="crsMail" checked> 每晚 7 点后把明天的课发到邮箱</span><small id="crsMailTxt"></small></label>
          <label class="crow2"><span><input type="checkbox" id="crsIcs" checked> 订阅的手机日历里也显示课程</span></label>
          <label class="crow2"><span><input type="checkbox" id="crsShare"> 把这张截图和核对好的结果交给管理员，帮忙改进识别</span><small>只有管理员能看到，用来让识别更准；不勾就不会上传</small></label>
        </div>
        <div class="cal-row"><button type="button" class="btn ink" id="crsSave">保存到课程表</button><span class="cal-st" id="crsSt2"></span></div>
      </div>
    </form>`;
    document.body.appendChild(dlg);
    const q = (s) => dlg.querySelector(s);
    q("[data-x]").onclick = () => dlg.close();
    q("#crsDrop").onclick = () => q("#crsFile").click();
    q("#crsDrop").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); q("#crsFile").click(); } };
    q("#crsFile").onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) pickFile(f); e.target.value = ""; };
    q("#crsDrop").ondragover = (e) => { e.preventDefault(); q("#crsDrop").classList.add("over"); };
    q("#crsDrop").ondragleave = () => q("#crsDrop").classList.remove("over");
    q("#crsDrop").ondrop = (e) => { e.preventDefault(); q("#crsDrop").classList.remove("over"); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) pickFile(f); };
    dlg.addEventListener("paste", (e) => { const it = [...(e.clipboardData && e.clipboardData.items || [])].find((x) => x.type.startsWith("image/")); if (it) { e.preventDefault(); pickFile(it.getAsFile()); } });
    q("#crsGo").onclick = runOcr;
    q("#crsRe").onclick = () => { q("#crsStep2").hidden = true; q("#crsStep1").hidden = false; };
    q("#crsAdd").onclick = () => { collect(); rows.push({ on: true, name: "", day: 0, start: 1, end: 2, weeks: "1-16", location: "", teacher: "", fresh: true }); renderRows(); };
    q("#crsRev").addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (b) { collect(); removed.push(...rows.splice(+b.dataset.del, 1)); renderRows(); } });
    q("#crsRev").addEventListener("change", (e) => { if (e.target.matches("[data-f=start]")) { collect(); const r = rows[+e.target.closest("[data-i]").dataset.i]; if (r.end < r.start) r.end = r.start; renderRows(); } });
    q("#crsSave").onclick = doSave;
    return dlg;
  }

  let pickedB64 = "";
  async function pickFile(file) {
    const q = (s) => dlg.querySelector(s), st = q("#crsSt");
    if (!file || !/^image\//.test(file.type || "image/")) { st.textContent = "请选择图片文件"; st.className = "cal-st err"; return; }
    st.textContent = "正在读取图片…"; st.className = "cal-st";
    try {
      pickedB64 = await compress(file);
      q("#crsPrev").src = "data:image/jpeg;base64," + pickedB64; q("#crsPrev").hidden = false;
      q(".cdrop-in").hidden = true;
      q("#crsGo").disabled = false;
      st.textContent = "";
    } catch (e) { pickedB64 = ""; q("#crsGo").disabled = true; st.textContent = "这张图片打不开：" + e.message; st.className = "cal-st err"; }
  }
  // 压缩：长边不超过 2200 像素、JPEG，一般 300KB~1MB（识别准确度和原图几乎一样）
  async function compress(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("格式不支持，请换成 JPG 或 PNG 截图")); i.src = url; });
      let max = 2200, quality = 0.9, out = "";
      for (let k = 0; k < 4; k++) {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", quality).split(",")[1];
        if (Math.min(c.width, c.height) < 200) throw new Error("图片太小了");
        if (out.length < 4_000_000) return out;
        max = Math.round(max * 0.8); quality -= 0.08;
      }
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  async function runOcr() {
    const q = (s) => dlg.querySelector(s), st = q("#crsSt"), go = q("#crsGo");
    if (!currentUser) { st.textContent = "请先登录"; st.className = "cal-st err"; return; }
    if (!pickedB64) return;
    go.disabled = true; st.className = "cal-st"; st.textContent = "上传中…";
    const t0 = Date.now(); let pct = 0;
    const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); st.textContent = `识别中… ${pct ? pct + "%，" : ""}${sec} 秒（一般 5~15 秒）`; }, 500);
    try {
      const { job_id } = await CCAuth.rpc("course_ocr_start", { img: pickedB64 });
      // 识别分几步在服务器上做，每问一次进度，服务器就接着做下一步
      let r = null;
      while (Date.now() - t0 < 160000) {
        await new Promise((res) => setTimeout(res, 1000));
        try { r = await CCAuth.rpc("course_ocr_status", { jid: job_id }); } catch (e) { r = null; }
        if (r && r.progress) pct = r.progress;
        if (r && r.status !== "running") break;
      }
      if (!r || r.status !== "done" || !r.result) throw new Error((r && r.status === "failed" && r.message) || "识别超时了，请稍后再试");
      ocrResult = r.result;
      await loadLearned();
      clearInterval(tick);
      showReview();
      st.textContent = "";
    } catch (e) { clearInterval(tick); st.textContent = "没成功：" + e.message; st.className = "cal-st err"; }
    go.disabled = false;
  }

  function showReview() {
    const q = (s) => dlg.querySelector(s), res = ocrResult || {};
    rows = (res.courses || []).map((c) => ({ on: true, name: c.name, day: c.day, start: c.start, end: c.end, weeks: c.weeks || "", location: c.location || "", teacher: c.teacher || "",
      weeksFound: !!c.weeks_found, conf: c.conf, note: c.note || "" }));
    for (const r of rows) r.orig = { ...r };
    removed = [];
    const nLearn = learnApply(rows);
    const anyWeeks = rows.some((r) => r.weeksFound);
    const guessMax = Math.max(learned && learned.maxweek >= 8 && learned.maxweek <= MAX_WEEK ? learned.maxweek : 16, ...rows.flatMap((r) => [...parseWeeks(r.weeks)]));
    for (const r of rows) if (!r.weeks) { r.weeks = `1-${guessMax}`; r.weeksGuess = true; }
    const warn = [...(res.warnings || [])];
    if (!rows.length) warn.unshift("没认出课程。可以换一张更清楚、更完整的截图，或点「＋ 加一门」手动添加。");
    else warn.unshift(`认出 ${rows.length} 门课，请逐门核对（标黄的是不太确定的地方），可以直接改。你改的地方会被记住，下次识别更准。`);
    if (nLearn) warn.splice(1, 0, `🧠 按以前的核对结果自动改了 ${nLearn} 处（标绿的，鼠标放上去能看到原来认出的字）。`);
    if (!anyWeeks && rows.length) warn.push(`周次先按「1-${guessMax}」填了（标黄），请改成实际的周次。`);
    else if (rows.some((r) => r.weeksGuess)) warn.push("标黄的周次没认出来，先按整个学期填了，请核对。");
    q("#crsWarn").innerHTML = warn.map(esc).join("<br>"); q("#crsWarn").className = "cal-st";
    // 作息时间
    const times = res.times || {}, nper = Math.max(res.periods || 0, ...rows.map((r) => r.end));
    const full = [];
    for (let i = 1; i <= nper; i++) { const t = times[i] || times[String(i)]; if (!t || !TIME_RE.test(t)) { full.length = 0; break; } full.push(t); }
    ocrResult._times = full.length >= 4 ? full : null;
    q("#crsTimesRow").classList.toggle("hidden", !ocrResult._times);
    if (ocrResult._times) q("#crsTimesTxt").textContent = ocrResult._times.map((t, i) => `第${i + 1}节 ${t}`).join("　");
    q("#crsW1").value = data.week1;
    q("#crsModeRow").classList.toggle("hidden", !data.courses.length);
    q("#crsOld").textContent = data.courses.length;
    const email = typeof mailInfo !== "undefined" && mailInfo && mailInfo.email;
    q("#crsMail").checked = !!email; q("#crsMail").disabled = !email;
    q("#crsMailTxt").textContent = email ? `发到 ${email}` : "还没绑定邮箱：到「我的 → 邮箱通知」绑定后就能打开";
    q("#crsIcs").checked = load(LS_ICS, true) !== false;
    q("#crsSt2").textContent = "";
    renderRows();
    q("#crsStep1").hidden = true; q("#crsStep2").hidden = false;
  }

  const lc = (r, f) => (r.learned && r.learned[f] ? " learned" : "");
  const lt = (r, f) => (r.learned && r.learned[f] ? ` title="自动改的，原来认出的是「${esc(r.learned[f])}」"` : "");
  function renderRows() {
    const q = (s) => dlg.querySelector(s);
    const nper = Math.max(12, ...rows.map((r) => r.end || 0));
    const per = (v) => Array.from({ length: nper }, (_, i) => `<option value="${i + 1}"${+v === i + 1 ? " selected" : ""}>${i + 1}</option>`).join("");
    q("#crsCount").textContent = `${rows.filter((r) => r.on).length} / ${rows.length} 门要导入`;
    q("#crsRev").innerHTML = rows.map((r, i) => {
      const unsure = r.conf != null && r.conf < 0.9;
      return `<div class="crev-r${r.on ? "" : " off"}" data-i="${i}">
        <label class="cchk"><input type="checkbox" data-f="on" ${r.on ? "checked" : ""}></label>
        <input class="cname${lc(r, "name") || (unsure ? " warn" : "")}" data-f="name" value="${esc(r.name)}" placeholder="课程名" maxlength="60"${lt(r, "name")}>
        <select data-f="day">${DAYS.map((d, k) => `<option value="${k}"${+r.day === k ? " selected" : ""}>${d}</option>`).join("")}</select>
        <span class="cper">第<select data-f="start">${per(r.start)}</select>-<select data-f="end">${per(r.end)}</select>节</span>
        <input class="cweeks${r.weeksGuess ? " warn" : ""}" data-f="weeks" value="${esc(r.weeks)}" placeholder="周次 如 1-16、1-15单" maxlength="40" title="周次：1-16、1-15单、2-16双、1-3,5-8">
        <input class="${lc(r, "location")}" data-f="location" value="${esc(r.location)}" placeholder="地点" maxlength="60"${lt(r, "location")}>
        <input class="${lc(r, "teacher")}" data-f="teacher" value="${esc(r.teacher)}" placeholder="老师" maxlength="40"${lt(r, "teacher")}>
        <button type="button" class="cdel" data-del="${i}" aria-label="删除这门课">🗑</button>
      </div>`;
    }).join("") || `<div class="empty">没有课程</div>`;
  }
  function collect() {
    dlg.querySelectorAll(".crev-r").forEach((el) => {
      const r = rows[+el.dataset.i]; if (!r) return;
      el.querySelectorAll("[data-f]").forEach((x) => {
        const f = x.dataset.f;
        if (f === "on") r.on = x.checked;
        else if (f === "day" || f === "start" || f === "end") r[f] = +x.value;
        else r[f] = x.value.trim();
      });
    });
  }
  document.addEventListener("change", (e) => { if (dlg && e.target.closest("#crsRev") && e.target.matches("[data-f=on]")) { collect(); renderRows(); } });

  async function doSave() {
    const q = (s) => dlg.querySelector(s), st = q("#crsSt2");
    collect();
    const pick = rows.filter((r) => r.on && r.name);
    for (const r of pick) {
      if (r.end < r.start) { st.textContent = `「${r.name}」结束节次比开始早`; st.className = "cal-st err"; return; }
      const ws = parseWeeks(r.weeks);
      if (!r.weeks || !ws.size) { st.textContent = `「${r.name}」的周次看不懂，例：1-16、1-15单、2-16双、1-3,5-8`; st.className = "cal-st err"; return; }
      if (Math.max(...ws) > MAX_WEEK) { st.textContent = `「${r.name}」的周次超过了 ${MAX_WEEK} 周`; st.className = "cal-st err"; return; }
    }
    if (!pick.length) { st.textContent = "没有要导入的课程"; st.className = "cal-st err"; return; }
    const stamp = Date.now();
    const fresh = pick.map((r, i) => ({ id: `ocr${stamp}_${i}`, name: r.name, teacher: r.teacher, location: r.location, day: r.day, start: r.start, end: r.end,
      weeks: weeksText(parseWeeks(r.weeks)) || r.weeks, courseType: "必修", note: "拍照导入" }));
    const mode = (dlg.querySelector("[name=cMode]:checked") || {}).value || "replace";
    let list = fresh;
    if (data.courses.length && mode === "merge") {
      const sig = (c) => [c.name, c.day, c.start, c.end, weeksText(parseWeeks(c.weeks))].join("|");
      const have = new Set(data.courses.map(sig));
      list = data.courses.concat(fresh.filter((c) => !have.has(sig(c))));
    }
    const kv = { [K.courses]: JSON.stringify(list) };
    const w1 = q("#crsW1").value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(w1)) kv[K.week1] = JSON.stringify(mondayOf(w1));
    if (ocrResult && ocrResult._times && q("#crsTimes").checked) { kv[K.custom] = JSON.stringify(ocrResult._times); kv[K.mode] = "custom"; }
    save(LS_ICS, q("#crsIcs").checked);
    q("#crsSave").disabled = true; st.className = "cal-st"; st.textContent = "保存中…";
    try {
      await write(kv);
      learnSubmit(rows);
      if (currentUser && q("#crsShare").checked && pickedB64) {
        const final = rows.filter((r) => r.on).map(({ name, day, start, end, weeks, location, teacher }) => ({ name, day, start, end, weeks, location, teacher }));
        CCAuth.rpc("course_ocr_sample_add", { img: pickedB64, ocr: ocrResult ? { courses: ocrResult.courses, times: ocrResult.times, periods: ocrResult.periods } : null, final }).catch(() => {});
      }
      ensureCard();
      let extra = "";
      if (currentUser) {
        try { await sync(true); extra = "，已同步到服务器"; } catch (e) { extra = "（同步到服务器没成功，稍后会自动重试：" + e.message + "）"; }
        if (!q("#crsMail").disabled) {
          try { mailInfo = await CCAuth.rpc("mail_set_prefs", { p: { course: q("#crsMail").checked } }); try { renderMail(); } catch (e) {} } catch (e) {}
        }
      }
      renderBar();
      st.className = "cal-st ok"; st.textContent = `已保存 ${fresh.length} 门课${extra} 🎉`;
      setTimeout(() => { dlg.close(); openTab(); showBanner(`课程表已更新：${list.length} 门课。日历、首页和提醒都会跟着变。`); setTimeout(() => showBanner(""), 5000); }, 900);
    } catch (e) { st.className = "cal-st err"; st.textContent = "保存失败：" + e.message; }
    q("#crsSave").disabled = false;
  }

  function openImport() {
    if (!on()) { showBanner("课程表功能暂时关闭了"); setTimeout(() => showBanner(""), 3000); return; }
    ensureDialog();
    const q = (s) => dlg.querySelector(s);
    q("#crsStep1").hidden = false; q("#crsStep2").hidden = true;
    q("#crsSt").textContent = currentUser ? "" : "登录后才能识别图片（识别在服务器上做）";
    q("#crsGo").disabled = !pickedB64;
    read().then(() => { if (!dlg.open) dlg.showModal(); });
  }

  // 把服务器上的课表写到本机（别的设备改过 / 换了设备）
  async function applyServer(r) {
    const stamp = Date.now(), old = {};
    (data.loaded ? data : await read()).courses.forEach((c) => { if (c.id) old[c.id] = c; });
    const list = (r.courses || []).map((c, i) => {
      const x = { id: c.id || `srv${stamp}_${i}`, name: c.name, teacher: c.teacher || "", location: c.location || "", day: +c.day, start: +c.start, end: +c.end,
        weeks: c.weeks || weeksText(new Set(c.wl || [])), courseType: "必修", note: "" };
      const o = old[x.id]; return o ? { ...o, ...x, courseType: o.courseType || x.courseType, note: o.note || "" } : x;   // 服务器上没有的字段（备注等）留着
    });
    const kv = { [K.courses]: JSON.stringify(list) }, m = r.meta || {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.week1 || "")) kv[K.week1] = JSON.stringify(m.week1);
    const t = Array.isArray(m.times) ? m.times : [];
    if (t.length >= 4 && t.every((x) => TIME_RE.test(x))) {
      const same = (a) => a.length === t.length && a.every((x, i) => x === t[i]);
      if (same(PERIODS.summer)) kv[K.mode] = "summer"; else if (same(PERIODS.winter)) kv[K.mode] = "winter";
      else { kv[K.custom] = JSON.stringify(t); kv[K.mode] = "custom"; }
    }
    if (typeof m.ics === "boolean") { try { localStorage.setItem(LS_ICS, JSON.stringify(m.ics)); } catch (e) {} }
    if (Array.isArray(m.adj)) kv[K.adj] = JSON.stringify(cleanAdj(m.adj));
    await write(kv); clearTimeout(syncTimer);
    // 刚从服务器拿的，不用再传回去
    if (currentUser) { try { localStorage.setItem(LS_SYNC, JSON.stringify({ uid: currentUser.id, sig: JSON.stringify(payload()), n: list.length, at: Date.now(), srv: r.updated_at || "" })); } catch (e) {} }
    renderBar();
    return list.length;
  }
  const sameT = (a, b) => !!a && !!b && (a === b || Date.parse(a) === Date.parse(b));
  // 和服务器对一下：服务器上的比本机新（别的设备改过）→ 拿下来；本机有没传上去的修改 → 传上去
  let pulling = null, pulledAt = 0;
  function pull(force) {
    if (!currentUser || !on()) return Promise.resolve(0);
    if (pulling) return pulling;
    const rev = load(LS_REV, null), last = load(LS_SYNC, {});
    if (!force && rev && last.uid === currentUser.id && sameT(rev.at, last.srv)) return Promise.resolve(0);
    if (!force && Date.now() - pulledAt < 1500) return Promise.resolve(0);
    pulling = (async () => {
      pulledAt = Date.now();
      const r = await CCAuth.rpc("courses_get");
      const L = load(LS_SYNC, {}), mine = L.uid === currentUser.id;
      const local = data.loaded ? data : await read(), sig = JSON.stringify(payload()), dirty = mine ? L.sig !== sig : local.courses.length > 0;
      if (!r || !r.updated_at) { if (local.courses.length) await sync(); return 0; }   // 服务器上还没有：把本机的传上去
      // 本机记了调课 / 调休、服务器上那份还没有（之前服务器没升级，传上去被丢掉了）：重新传一次
      if ((local.adj || []).length && !(r.meta && Array.isArray(r.meta.adj)) && (mine || local.courses.length)) { await sync(true); return 0; }
      if (mine && sameT(r.updated_at, L.srv)) { if (dirty) await sync(); return 0; }   // 服务器没变
      if (dirty && local.courses.length) {
        if (!mine) { await sync(true); return 0; }   // 登录前在这台设备上填的课：照旧传上去
        if (Date.parse(r.updated_at) < (L.editAt || 0)) { await sync(true); return 0; }   // 两边都改了：本机的修改更晚
      }
      const n = await applyServer(r);
      return n || -1;
    })().finally(() => { pulling = null; });
    return pulling;
  }
  async function restore() { const n = await pull(true); return n > 0 ? n : 0; }
  // 别的设备改了课表：「我的数据」同步过来 course_rev_v1 → 马上拿新课表；切回这个页面时也对一下
  let hooked = false;
  function hook() {
    if (hooked || typeof Sync === "undefined") return; hooked = true;
    Sync.onChange((set) => { if (set && set.has && set.has(LS_REV)) setTimeout(() => pull().catch(() => {}), 50); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - pulledAt > 30000) pull(true).catch(() => {}); });
  }

  async function boot() {
    if (!on()) return;
    hook();
    await read();
    if (currentUser) {
      const had = data.courses.length;
      try {
        const n = await pull(true);
        if (!had && n > 0) { ensureCard(); showBanner(`已从云端恢复你的 ${n} 门课`); setTimeout(() => showBanner(""), 4000); }
      } catch (e) {}
    }
    renderBar();
    try { renderWidgets(); } catch (e) {}
    try { renderAgenda(); } catch (e) {}   // 首页问候卡的时间轴要用课程：课表读好后重画一次（不然刷新后时间轴上没有课）
  }

  return { dayNote, openAdjust, baseOn, cleanAdj, pull, _nearOCR: (a, b) => nearOCR(a, b), NS, on, read, write, sync, changed, coursesOn, card, askLines, injectBuiltin, loadBuiltin, decorateTab, renderBar, openImport, boot, parseWeeks, weeksText,
    get data() { return data; } };
})();
