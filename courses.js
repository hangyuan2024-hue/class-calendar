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
  };
  const VER = "20261002c";
  const DEFAULT_WEEK1 = "2026-09-14";
  const MAX_WEEK = 20;
  const PERIODS = {
    winter: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:00-14:50", "15:00-15:50", "16:10-17:00", "17:10-18:00", "19:10-20:00", "20:10-21:00"],
    summer: ["08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20", "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30"],
  };
  const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const LS_SYNC = "course_sync_sig_v1", LS_ICS = "course_ics_v1";
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
    const m = new Date().getMonth() + 1;
    const times = mode === "custom" && customOk ? custom : PERIODS[mode === "winter" || mode === "summer" ? mode : (m >= 5 && m <= 10 ? "summer" : "winter")];
    const w1 = js(st[K.week1], DEFAULT_WEEK1);
    data = { courses: Array.isArray(courses) ? courses.filter((c) => c && c.name) : [], week1: /^\d{4}-\d{2}-\d{2}$/.test(w1) ? w1 : DEFAULT_WEEK1,
      times, mode, custom: customOk ? custom : null, loaded: true };
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
  function coursesOn(k) {
    const wk = weekOf(k), day = (new Date(k + "T00:00:00").getDay() + 6) % 7;
    if (wk < 1 || wk > MAX_WEEK) return [];
    return data.courses.filter((c) => Number(c.day) === day && parseWeeks(c.weeks).has(wk))
      .map((c) => ({ ...c, t0: (data.times[c.start - 1] || "").split("-")[0], t1: (data.times[c.end - 1] || "").split("-")[1] || "", week: wk }))
      .sort((a, b) => a.start - b.start);
  }

  // ---------- 同步到服务器（邮件提醒、手机日历订阅用） ----------
  let syncTimer = 0, syncing = false;
  function payload() {
    const courses = data.courses.slice(0, 200).map((c) => ({ id: String(c.id || "").slice(0, 40), name: String(c.name).slice(0, 60), day: +c.day, start: +c.start, end: +c.end,
      weeks: String(c.weeks || "").slice(0, 40), wl: [...parseWeeks(c.weeks)].sort((a, b) => a - b), location: String(c.location || "").slice(0, 60), teacher: String(c.teacher || "").slice(0, 40) }));
    return { p_courses: courses, p_meta: { week1: mondayOf(data.week1), times: data.times.slice(0, 16), ics: load(LS_ICS, true) !== false } };
  }
  function changed() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync().catch(() => {}), 2500);
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
      save(LS_SYNC, { uid: currentUser.id, sig, n: p.p_courses.length, at: Date.now() });
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
    barEl.innerHTML = `<button class="btn ink sm" data-c="import">📷 拍照导入课表</button>
      <span class="cbar-t">${data.courses.length ? `共 ${data.courses.length} 门课` : "还没有课程"}${currentUser ? (synced ? " · ☁ 已同步" : data.courses.length ? " · 同步中…" : "") : " · 登录后可同步"}</span>
      <span class="spacer"></span>
      ${currentUser ? `<button class="small" data-c="mail">${mailOn ? "🔔 每晚提醒明天的课：开" : "🔕 每晚提醒明天的课：关"}</button>
      <label class="cbar-ck"><input type="checkbox" id="crsBarIcs" ${load(LS_ICS, true) !== false ? "checked" : ""}>手机日历订阅里带上课程</label>` : ""}`;
  }

  // ---------- 首页「今日课程」卡片 ----------
  function card(h) {
    const k = keyOf(new Date()), list = coursesOn(k), now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
    const t = new Date(), out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i), k = keyOf(d), l = coursesOn(k);
      if (l.length) out.push(`${k}（${DAYS[(d.getDay() + 6) % 7]}，第${l[0].week}周）：` + l.map((c) => `第${c.start}-${c.end}节${c.t0 ? " " + c.t0 + "-" + c.t1 : ""} ${c.name}${c.location ? " @" + c.location : ""}`).join("；"));
    }
    return out.length ? "\n我的课程（未来 7 天）：\n" + out.join("\n") : "";
  }

  // ---------- 拍照导入 ----------
  let dlg = null, rows = [], ocrResult = null;
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
        <ul class="ctips"><li>截全：要看得到「星期一…星期日」和左边的节次</li><li>App 截图通常只显示「本周」的课，周次可能要自己核对</li><li>图片只用来识别，识别完不保存</li></ul>
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
    q("#crsRev").addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (b) { collect(); rows.splice(+b.dataset.del, 1); renderRows(); } });
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
    try {
      const { job_id } = await CCAuth.rpc("course_ocr_start", { img: pickedB64 });
      const t0 = Date.now(); let r = null;
      while (Date.now() - t0 < 160000) {
        const sec = Math.round((Date.now() - t0) / 1000);
        st.textContent = `识别中… ${sec} 秒（一般 3~8 秒）`;
        await new Promise((res) => setTimeout(res, sec < 10 ? 1000 : 2000));
        r = await CCAuth.rpc("course_ocr_status", { jid: job_id });
        if (r && r.status !== "running") break;
      }
      if (!r || r.status !== "done" || !r.result) throw new Error((r && r.message) || "识别超时了，请稍后再试");
      ocrResult = r.result;
      showReview();
      st.textContent = "";
    } catch (e) { st.textContent = "没成功：" + e.message; st.className = "cal-st err"; }
    go.disabled = false;
  }

  function showReview() {
    const q = (s) => dlg.querySelector(s), res = ocrResult || {};
    rows = (res.courses || []).map((c) => ({ on: true, name: c.name, day: c.day, start: c.start, end: c.end, weeks: c.weeks || "", location: c.location || "", teacher: c.teacher || "",
      weeksFound: !!c.weeks_found, conf: c.conf, note: c.note || "" }));
    const anyWeeks = rows.some((r) => r.weeksFound);
    const guessMax = Math.max(16, ...rows.flatMap((r) => [...parseWeeks(r.weeks)]));
    for (const r of rows) if (!r.weeks) { r.weeks = `1-${guessMax}`; r.weeksGuess = true; }
    const warn = [...(res.warnings || [])];
    if (!rows.length) warn.unshift("没认出课程。可以换一张更清楚、更完整的截图，或点「＋ 加一门」手动添加。");
    else warn.unshift(`认出 ${rows.length} 门课，请逐门核对（标黄的是不太确定的地方），可以直接改。`);
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

  function renderRows() {
    const q = (s) => dlg.querySelector(s);
    const nper = Math.max(12, ...rows.map((r) => r.end || 0));
    const per = (v) => Array.from({ length: nper }, (_, i) => `<option value="${i + 1}"${+v === i + 1 ? " selected" : ""}>${i + 1}</option>`).join("");
    q("#crsCount").textContent = `${rows.filter((r) => r.on).length} / ${rows.length} 门要导入`;
    q("#crsRev").innerHTML = rows.map((r, i) => {
      const unsure = r.conf != null && r.conf < 0.9;
      return `<div class="crev-r${r.on ? "" : " off"}" data-i="${i}">
        <label class="cchk"><input type="checkbox" data-f="on" ${r.on ? "checked" : ""}></label>
        <input class="cname${unsure ? " warn" : ""}" data-f="name" value="${esc(r.name)}" placeholder="课程名" maxlength="60">
        <select data-f="day">${DAYS.map((d, k) => `<option value="${k}"${+r.day === k ? " selected" : ""}>${d}</option>`).join("")}</select>
        <span class="cper">第<select data-f="start">${per(r.start)}</select>-<select data-f="end">${per(r.end)}</select>节</span>
        <input class="cweeks${r.weeksGuess ? " warn" : ""}" data-f="weeks" value="${esc(r.weeks)}" placeholder="周次 如 1-16、1-15单" maxlength="40" title="周次：1-16、1-15单、2-16双、1-3,5-8">
        <input data-f="location" value="${esc(r.location)}" placeholder="地点" maxlength="60">
        <input data-f="teacher" value="${esc(r.teacher)}" placeholder="老师" maxlength="40">
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

  // 换了手机、换了浏览器：本机没有课程、服务器上有，就自动恢复
  async function restore() {
    const r = await CCAuth.rpc("courses_get");
    if (!r || !Array.isArray(r.courses) || !r.courses.length) return 0;
    const list = r.courses.map((c, i) => ({ id: c.id || `srv${Date.now()}_${i}`, name: c.name, teacher: c.teacher || "", location: c.location || "", day: +c.day, start: +c.start, end: +c.end,
      weeks: c.weeks || weeksText(new Set(c.wl || [])), courseType: "必修", note: "" }));
    const kv = { [K.courses]: JSON.stringify(list) }, m = r.meta || {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.week1 || "")) kv[K.week1] = JSON.stringify(m.week1);
    const t = Array.isArray(m.times) ? m.times : [];
    if (t.length >= 4 && t.every((x) => TIME_RE.test(x))) {
      const same = (a) => a.length === t.length && a.every((x, i) => x === t[i]);
      if (same(PERIODS.summer)) kv[K.mode] = "summer"; else if (same(PERIODS.winter)) kv[K.mode] = "winter";
      else { kv[K.custom] = JSON.stringify(t); kv[K.mode] = "custom"; }
    }
    await write(kv);
    return list.length;
  }

  async function boot() {
    if (!on()) return;
    await read();
    if (currentUser && !data.courses.length) {
      try {
        const n = await restore();
        if (n) { ensureCard(); showBanner(`已从云端恢复你的 ${n} 门课`); setTimeout(() => showBanner(""), 4000); }
      } catch (e) {}
    }
    renderBar();
    try { renderWidgets(); } catch (e) {}
    sync().catch(() => {});
  }

  return { NS, on, read, write, sync, changed, coursesOn, card, askLines, injectBuiltin, loadBuiltin, decorateTab, renderBar, openImport, boot, parseWeeks, weeksText,
    get data() { return data; } };
})();
