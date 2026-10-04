// 捞捞课程表 电脑版 · 本机数据 + 云端同步
// - 班级事项、分组、课程表、班级墙：从服务器拿，存一份在本机，断网也能看
// - 我的事项、完成标记、打卡、规划、心情、倒数日……和网页版、手机用同一套云端同步（user_kv），哪边改了都会同步过来
// - 作业附件（本机文件路径）只存在这台电脑上，不上传
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const M = require("./model");

// 和网页版 app.js 里的 SYNC_KINDS 一致（网页没有的是电脑版新加的，网页会原样保留）
// list：数组，按 id 一条条同步；map：对象，按键同步；map2：两层对象（习惯 → 日期）；one：整体同步
const KINDS = {
  personal_events_v1: "list", personal_marks_v1: "map", done_log_v1: "map", pomo_log_v1: "map",
  habits_v1: "list", habit_log_v1: "map2", quad_v1: "map", plan_notes_v1: "map", mood_log_v1: "map",
  profile_v1: "one", fun_opts_v1: "one", plugins_enabled_v1: "one",
  countdown_v1: "list", focus_min_v1: "map", island_v1: "one", farm_v1: "one",          // 电脑版新加：倒数日、每天专注了多少分钟
};
const SYNC_NS = Object.keys(KINDS);
const SEP = "\u0001";

const DEFAULT_SETTINGS = {
  remindBefore: 30,        // 事项开始前几分钟提醒
  courseRemind: 10,        // 上课前几分钟提醒
  eveningDigest: true,     // 每晚 8 点提醒明天的事
  closeToTray: true,       // 关窗口时缩到右下角
  autoStart: false,        // 开机自动启动
  theme: "system",         // light / dark / system
  accent: "blue",          // 主色
  hotkey: "CommandOrControl+Alt+Space",
  pomoFocus: 25, pomoBreak: 5,
  clipWatch: true,         // 复制了像作业通知的群消息时提示整理
  focusQuiet: true,        // 专注时不弹事项提醒，结束后一起告诉你
  classQuiet: false,       // 上课时只弹上课提醒
  morningBrief: true,      // 每天第一次打开电脑时弹出今日简报
  autoBackup: true,        // 每天自动备份到「文档」
  weeklyReport: true,      // 周日晚上生成本周学习报告
  countdownRemind: true,   // 倒数日提前 7 / 3 / 1 天提醒
  taskbarBadge: true,      // 任务栏图标上显示今天还剩几件事
  noise: "off", noiseVol: 0.4,
};

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const blankNs = () => { const o = {}; for (const [k, kind] of Object.entries(KINDS)) o[k] = kind === "list" ? [] : kind === "one" ? null : {}; return o; };

function blank() {
  return {
    v: 2, uid: null, me: null, perms: [], classes: [], cid: null, items: [], groups: [], classOpts: {}, wall: null, features: null, plugins: null,
    courses: { courses: [], meta: {} }, ns: blankNs(),
    sync: { rev: 0, t: {} }, outbox: {}, lastRefresh: 0, settings: { ...DEFAULT_SETTINGS }, attach: {}, flags: {},
  };
}

class Store extends EventEmitter {
  constructor({ api, file, now }) {
    super();
    this.api = api; this.file = file; this.now = now || (() => Date.now());
    this.data = blank(); this.saveTimer = 0; this.pushTimer = 0;
    this.status = { syncing: false, online: true, error: "", lastOk: 0 };
    this.busy = null;
  }

  // ---------- 本机文件 ----------
  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const b = blank();
      this.data = { ...b, ...d, ns: { ...b.ns, ...(d.ns || {}) }, sync: { ...b.sync, ...(d.sync || {}) }, settings: { ...b.settings, ...(d.settings || {}) },
        attach: d.attach || {}, flags: d.flags || {} };
      for (const [k, kind] of Object.entries(KINDS)) {   // 坏数据兜底
        const v = this.data.ns[k];
        if (kind === "list" && !Array.isArray(v)) this.data.ns[k] = [];
        if ((kind === "map" || kind === "map2") && (!v || typeof v !== "object" || Array.isArray(v))) this.data.ns[k] = {};
      }
      if ((d.v || 1) < 2) this.migrate1();
    } catch (e) { this.data = blank(); }
    return this;
  }
  // 1.0 版把「专注了多少分钟」记在 pomo_log_v1 里，网页版那里记的是「几个番茄」：分开
  migrate1() {
    const pl = this.data.ns.pomo_log_v1, fm = this.data.ns.focus_min_v1;
    for (const [day, v] of Object.entries(pl)) {
      const n = Number(v) || 0;
      if (n > 12) { fm[day] = (Number(fm[day]) || 0) + n; pl[day] = Math.max(1, Math.round(n / 25)); if (this.data.uid) { this.record("focus_min_v1", day, fm[day]); this.record("pomo_log_v1", day, pl[day]); } }
    }
    this.data.v = 2;
  }
  save(now) {
    clearTimeout(this.saveTimer);
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(this.data));
        fs.renameSync(tmp, this.file);
      } catch (e) { console.error("保存失败", e); }
    };
    if (now) write(); else this.saveTimer = setTimeout(write, 300);
  }
  changed(what) { this.save(); this.emit("change", what || "data"); }

  // ---------- 登录 ----------
  async login(account, password) {
    const s = await this.api.signIn(account, password);
    if (this.data.uid && this.data.uid !== s.user_id) { const keep = this.data.settings; this.data = blank(); this.data.settings = keep; }   // 换了账号：清掉上个人的数据
    this.data.uid = s.user_id;
    this.save(true);
    await this.refresh();
    return true;
  }
  async logout() {
    try { await this.flush(); } catch (e) {}
    await this.api.signOut();
    const keep = this.data.settings; this.data = blank(); this.data.settings = keep;
    this.save(true); this.emit("change", "logout");
  }
  async loggedIn() { return !!(await this.api.session()); }

  // ---------- 从服务器拿数据 ----------
  refresh() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      this.status.syncing = true; this.emit("status", this.status);
      try {
        // 新版（按班级分组过滤事项和班级墙）；服务器还没更新时退回老版
        let b;
        try { b = await this.api.rpc("app_bootstrap2", { cid: this.data.cid }, { retry: true }); }
        catch (e) { if (e.status !== 404) throw e; b = await this.api.rpc("app_bootstrap", { cid: this.data.cid }, { retry: true }); }
        if (!b) throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
        const d = this.data;
        d.me = b.me; d.perms = b.perms || []; d.classes = b.classes || []; d.cid = b.cid || null;
        d.items = Array.isArray(b.items) ? b.items : (d.cid ? d.items : []);
        d.groups = Array.isArray(b.groups) ? b.groups : (b.v === 2 ? [] : d.groups || []);
        d.classOpts = b.class_opts || {}; d.groupsOk = b.v === 2;
        d.wall = b.wall || null; d.features = b.features || null;
        if (Array.isArray(b.plugins)) d.plugins = b.plugins;
        if (b.mail !== undefined) d.mail = b.mail;
        try { const c = await this.api.rpc("courses_get", {}, { retry: true }); if (c) d.courses = { courses: c.courses || [], meta: c.meta || {}, updated_at: c.updated_at }; } catch (e) { /* 课程表功能关着 */ }
        await this.pull();
        await this.flush();
        d.lastRefresh = this.now();
        this.status = { syncing: false, online: true, error: "", lastOk: this.now() };
      } catch (e) {
        this.status = { ...this.status, syncing: false, online: !e.offline, error: e.message };
        if (e.status === 401) { this.emit("auth-expired"); }
      } finally { this.busy = null; this.changed("refresh"); this.emit("status", this.status); }
    })();
    return this.busy;
  }

  // 只重新拿当前班级的事项和分组（发布、修改班级事项之后用，比整个刷新省请求）
  async reloadClass() {
    const cid = this.data.cid; if (!cid) return;
    try {
      const x = await this.api.rpc("class_ctx", { cid });
      if (this.data.cid !== cid) return;
      this.data.items = x.items || []; this.data.groups = x.groups || []; this.data.classOpts = x.class_opts || {}; this.data.groupsOk = true;
      this.changed("class");
    } catch (e) { if (e.status === 404) return this.refresh(); throw e; }
  }

  async switchClass(cid) { this.data.cid = cid; this.data.items = []; this.data.groups = []; this.data.wall = null; this.changed(); return this.refresh(); }

  // ---------- 云端同步（和网页版同一套规则：每条记录带修改时间，以后改的为准） ----------
  tOf(ns, k) { return ((this.data.sync.t[ns] || {})[k]) || 0; }
  record(ns, k, v) {
    const t = Math.max(this.now(), this.tOf(ns, k) + 1);
    (this.data.sync.t[ns] ||= {})[k] = t;
    this.data.outbox[ns + SEP + k] = { ns, k, v: v === undefined ? null : v, t };
    clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.flush().catch(() => {}), 800);
  }
  applyRow(row) {
    const { ns, k } = row, kind = KINDS[ns]; if (!kind) return false;
    if (row.t < this.tOf(ns, k)) return false;                        // 本机的更新
    const ob = this.data.outbox[ns + SEP + k];
    if (ob && ob.t > row.t) return false;
    if (ob) delete this.data.outbox[ns + SEP + k];
    (this.data.sync.t[ns] ||= {})[k] = row.t;
    const cur = this.data.ns;
    if (kind === "list") {
      const list = cur[ns], i = list.findIndex((x) => x && String(x.id) === k);
      if (row.v == null) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = row.v; else list.push(row.v);
    } else if (kind === "one") {
      cur[ns] = row.v == null ? null : row.v;
    } else if (kind === "map2") {
      const [a, b] = k.split(SEP), o = cur[ns];
      if (b === undefined) return false;
      if (row.v == null) { if (o[a]) { delete o[a][b]; if (!Object.keys(o[a]).length) delete o[a]; } }
      else (o[a] ||= {})[b] = row.v;
    } else {
      if (row.v == null) delete cur[ns][k]; else cur[ns][k] = row.v;
    }
    return true;
  }
  async pull() {
    let n = 0;
    for (let guard = 0; guard < 50; guard++) {
      const r = await this.api.rpc("udata_pull", { since: this.data.sync.rev || 0 }, { retry: true });
      for (const row of (r && r.rows) || []) if (this.applyRow(row)) n++;
      this.data.sync.rev = (r && r.rev) || this.data.sync.rev;
      if (!r || !r.more) break;
    }
    if (n) this.changed("pull");
    return n;
  }
  async flush() {
    const keys = Object.keys(this.data.outbox);
    for (let i = 0; i < keys.length; i += 300) {
      const part = keys.slice(i, i + 300), batch = part.map((x) => this.data.outbox[x]);
      await this.api.rpc("udata_push", { p: batch });
      part.forEach((x, j) => { if (this.data.outbox[x] === batch[j]) delete this.data.outbox[x]; });
      this.save();
    }
    return keys.length;
  }

  // ---------- 通用：改一条同步数据（界面上的打卡、规划、心情、倒数日都走这里） ----------
  kvSet(ns, k, v, quiet) {
    const kind = KINDS[ns]; if (!kind) throw new Error("不支持的数据：" + ns);
    if (v !== null && v !== undefined && JSON.stringify(v).length > 28000) throw new Error("内容太长了");
    const cur = this.data.ns;
    if (kind === "one") { cur[ns] = v ?? null; this.record(ns, "_", v ?? null); }
    else if (kind === "list") {
      k = String(k || (v && v.id) || ""); if (!k) throw new Error("缺少 id");
      const list = cur[ns], i = list.findIndex((x) => x && String(x.id) === k);
      if (v == null) { if (i >= 0) list.splice(i, 1); }
      else { v = { ...v, id: v.id ?? k }; if (i >= 0) list[i] = v; else list.push(v); }
      this.record(ns, k, v ?? null);
    } else if (kind === "map2") {
      const [a, b] = Array.isArray(k) ? k.map(String) : String(k).split(SEP); if (b === undefined) throw new Error("缺少日期");
      const o = cur[ns];
      if (v == null) { if (o[a]) { delete o[a][b]; if (!Object.keys(o[a]).length) delete o[a]; } } else (o[a] ||= {})[b] = v;
      this.record(ns, a + SEP + b, v ?? null);
    } else {
      k = String(k);
      if (v == null) delete cur[ns][k]; else cur[ns][k] = v;
      this.record(ns, k, v ?? null);
    }
    if (!quiet) this.changed(ns);
    return true;
  }
  // 一次改好几条（删除习惯连同打卡记录、六件事挪到明天……）
  kvBatch(ops) { for (const [ns, k, v] of ops || []) this.kvSet(ns, k, v, true); this.changed("batch"); return true; }

  // ---------- 修改 ----------
  upsertMine(item) {
    const list = this.data.ns.personal_events_v1;
    const id = item.id || "p" + this.now() + Math.floor(Math.random() * 1000);
    const i = list.findIndex((x) => x.id === id);
    const rec = { ...(i >= 0 ? list[i] : { done: false }), ...item, id };
    for (const k of ["subject", "event_time", "location", "note"]) rec[k] = String(rec[k] ?? "").slice(0, k === "note" ? 2000 : 200);
    if (i >= 0) list[i] = rec; else list.push(rec);
    this.record("personal_events_v1", id, rec);
    this.changed("mine");
    return rec;
  }
  deleteMine(id) {
    const list = this.data.ns.personal_events_v1, i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1); this.record("personal_events_v1", id, null);
    if (this.data.ns.quad_v1[id] != null) { delete this.data.ns.quad_v1[id]; this.record("quad_v1", id, null); }
    if (this.data.attach[id]) delete this.data.attach[id];
    this.changed("mine");
    return true;
  }
  setMark(key, patch) {
    const m = this.data.ns.personal_marks_v1, v = { ...(m[key] || {}), ...patch };
    for (const k of Object.keys(v)) if (v[k] === false || v[k] === "" || v[k] == null) delete v[k];
    if (Object.keys(v).length) m[key] = v; else delete m[key];
    this.record("personal_marks_v1", key, m[key] || null);
    this.changed("marks");
  }
  // 勾选完成（班级事项记在完成标记里；我的事项直接改那一条）
  setDone(key, done) {
    if (/^c\d+$/.test(key)) {
      this.setMark(key, { done: !!done });
      this.growth("done", key.slice(1), !done);
    } else {
      const it = this.data.ns.personal_events_v1.find((x) => x.id === key); if (!it) return;
      this.upsertMine({ ...it, done: !!done });
    }
    const log = this.data.ns.done_log_v1;
    if (done) log[key] = dayKey(new Date(this.now())); else delete log[key];
    this.record("done_log_v1", key, log[key] || null);
    this.changed("done");
  }
  // 拖到别的日子：只有自己的事项能改日期
  moveMine(id, day) {
    const it = this.data.ns.personal_events_v1.find((x) => x.id === id); if (!it) return false;
    const time = (String(it.event_time || "").match(/\d{2}:\d{2}/) || [""])[0];
    this.upsertMine({ ...it, event_time: day + (time ? " " + time : "") });
    return true;
  }
  // 完成一个番茄：和网页版一样记「几个番茄」，另外记专注了多少分钟
  logPomo(minutes) {
    const k = dayKey(new Date(this.now())), pl = this.data.ns.pomo_log_v1, fm = this.data.ns.focus_min_v1;
    pl[k] = (Number(pl[k]) || 0) + 1; fm[k] = (Number(fm[k]) || 0) + Math.max(1, Math.round(minutes));
    this.record("pomo_log_v1", k, pl[k]); this.record("focus_min_v1", k, fm[k]);
    this.growth("pomo", k + "|" + pl[k], false);
    this.changed("pomo");
  }
  // 习惯打卡（今天打过就取消）
  toggleHabit(id, day) {
    day = day || dayKey(new Date(this.now()));
    const log = this.data.ns.habit_log_v1, on = !(log[id] && log[id][day]);
    this.kvSet("habit_log_v1", [id, day], on ? true : null);
    this.growth("habit", id + "|" + day, !on);
    return on;
  }
  // 成长值（排行榜）：老师不参加
  growth(kind, ref, undo) {
    if (!this.data.cid || this.isTeacher()) return;
    this.api.rpc("growth_log", { cid: this.data.cid, k: kind, r: String(ref), undo: !!undo }).catch(() => {});
  }
  setSettings(patch) { this.data.settings = { ...this.data.settings, ...patch }; this.changed("settings"); return this.data.settings; }

  // 作业附件：本机文件，只记路径
  setAttach(key, list) { if (list && list.length) this.data.attach[key] = list.slice(0, 30); else delete this.data.attach[key]; this.changed("attach"); }

  isTeacher() { const c = this.data.classes.find((x) => x.id === this.data.cid); return !!(c && c.is_teacher); }
  async wallPost(title, body, notice, gid) {
    if (!this.data.cid) throw new Error("还没加入班级");
    const a = { cid: this.data.cid, p_title: String(title || "").slice(0, 60), p_body: String(body || "").slice(0, 5000), p_notice: !!notice };
    if (gid) await this.api.rpc("wall_post_group", { ...a, gid: +gid }); else await this.api.rpc("wall_post", a);
    await this.refresh();
  }

  // ---------- 课程表：电脑上改了，传到服务器（网页、手机日历订阅、邮件提醒都会用这一份） ----------
  async saveCourses(courses, meta) {
    const list = (courses || []).filter((c) => c && c.name).slice(0, 200).map((c, i) => ({
      id: String(c.id || "d" + this.now() + "_" + i).slice(0, 40), name: String(c.name).slice(0, 60), day: Math.max(0, Math.min(6, +c.day || 0)),
      start: Math.max(1, +c.start || 1), end: Math.max(+c.start || 1, +c.end || +c.start || 1), weeks: String(c.weeks || "").slice(0, 40),
      wl: [...M.parseWeeks(String(c.weeks || ""))].sort((a, b) => a - b), location: String(c.location || "").slice(0, 60), teacher: String(c.teacher || "").slice(0, 40) }));
    const m = { ...(this.data.courses.meta || {}), ...(meta || {}) };
    if (Array.isArray(m.times)) m.times = m.times.filter((t) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(t)).slice(0, 16);
    const prev = this.data.courses;
    this.data.courses = { courses: list, meta: m, updated_at: new Date(this.now()).toISOString() };
    this.changed("courses");
    if (m.week1) m.week1 = M.mondayKey(m.week1);
    try { await this.api.rpc("courses_sync", { p_courses: list, p_meta: { week1: m.week1 || null, times: m.times || [], ics: m.ics !== false } }); }
    catch (e) { if (e.status === 404) { this.data.courses = prev; this.changed("courses"); throw new Error("服务器还不支持保存课程表，请管理员更新数据库"); } throw e; }
    return list.length;
  }

  // 给界面用的一份数据（不含登录令牌）
  snapshot() {
    const d = this.data;
    return { me: d.me, perms: d.perms, classes: d.classes, cid: d.cid, items: d.items, groups: d.groups || [], classOpts: d.classOpts || {}, groupsOk: !!d.groupsOk,
      wall: d.wall, features: d.features, courses: d.courses, plugins: d.plugins,
      mine: d.ns.personal_events_v1, marks: d.ns.personal_marks_v1, doneLog: d.ns.done_log_v1, pomo: d.ns.pomo_log_v1, focusMin: d.ns.focus_min_v1,
      kv: d.ns, attach: d.attach, settings: d.settings, status: this.status, lastRefresh: d.lastRefresh, pending: Object.keys(d.outbox).length };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, dayKey, SYNC_NS, KINDS };
