// 捞捞课程表 电脑版 · 本机数据 + 云端同步
// - 班级事项、课程表、班级墙：从服务器拿，存一份在本机，断网也能看
// - 我的事项、完成标记、备注：和网页版、手机用同一套云端同步（user_kv），哪边改了都会同步过来
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const NS_LIST = ["personal_events_v1"];                               // 列表：每条按 id 同步
const NS_MAP = ["personal_marks_v1", "done_log_v1", "pomo_log_v1"];  // 字典：每个键单独同步
const SYNC_NS = [...NS_LIST, ...NS_MAP];

const DEFAULT_SETTINGS = {
  remindBefore: 30,        // 事项开始前几分钟提醒
  courseRemind: 10,        // 上课前几分钟提醒
  eveningDigest: true,     // 每晚 8 点提醒明天的事
  closeToTray: true,       // 关窗口时缩到右下角
  autoStart: false,        // 开机自动启动
  theme: "system",         // light / dark / system
  hotkey: "CommandOrControl+Alt+Space",
  pomoFocus: 25, pomoBreak: 5,
};

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function blank() {
  return {
    v: 1, uid: null, me: null, perms: [], classes: [], cid: null, items: [], wall: null, features: null,
    courses: { courses: [], meta: {} }, ns: { personal_events_v1: [], personal_marks_v1: {}, done_log_v1: {}, pomo_log_v1: {} },
    sync: { rev: 0, t: {} }, outbox: {}, lastRefresh: 0, settings: { ...DEFAULT_SETTINGS },
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
      this.data = { ...b, ...d, ns: { ...b.ns, ...(d.ns || {}) }, sync: { ...b.sync, ...(d.sync || {}) }, settings: { ...b.settings, ...(d.settings || {}) } };
    } catch (e) { this.data = blank(); }
    return this;
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
        const b = await this.api.rpc("app_bootstrap", { cid: this.data.cid }, { retry: true });
        if (!b) throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
        const d = this.data;
        d.me = b.me; d.perms = b.perms || []; d.classes = b.classes || []; d.cid = b.cid || null;
        d.items = Array.isArray(b.items) ? b.items : (d.cid ? d.items : []);
        d.wall = b.wall || null; d.features = b.features || null;
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

  async switchClass(cid) { this.data.cid = cid; this.data.items = []; this.changed(); return this.refresh(); }

  // ---------- 云端同步（和网页版同一套规则：每条记录带修改时间，以后改的为准） ----------
  tOf(ns, k) { return ((this.data.sync.t[ns] || {})[k]) || 0; }
  record(ns, k, v) {
    const t = Math.max(this.now(), this.tOf(ns, k) + 1);
    (this.data.sync.t[ns] ||= {})[k] = t;
    this.data.outbox[ns + "\u0001" + k] = { ns, k, v: v === undefined ? null : v, t };
    clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.flush().catch(() => {}), 800);
  }
  applyRow(row) {
    const { ns, k } = row; if (!SYNC_NS.includes(ns)) return false;
    if (row.t < this.tOf(ns, k)) return false;                        // 本机的更新
    if (this.data.outbox[ns + "\u0001" + k] && this.data.outbox[ns + "\u0001" + k].t > row.t) return false;
    (this.data.sync.t[ns] ||= {})[k] = row.t;
    if (NS_LIST.includes(ns)) {
      const list = this.data.ns[ns], i = list.findIndex((x) => x && String(x.id) === k);
      if (row.v == null) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = row.v; else list.push(row.v);
    } else {
      if (row.v == null) delete this.data.ns[ns][k]; else this.data.ns[ns][k] = row.v;
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
    list.splice(i, 1); this.record("personal_events_v1", id, null); this.changed("mine");
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
      if (this.data.cid && !this.isTeacher()) this.api.rpc("growth_log", { cid: this.data.cid, k: "done", r: key.slice(1), undo: !done }).catch(() => {});
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
  logPomo(minutes) {
    const k = dayKey(new Date(this.now())), m = this.data.ns.pomo_log_v1;
    m[k] = (Number(m[k]) || 0) + minutes;
    this.record("pomo_log_v1", k, m[k]); this.changed("pomo");
  }
  setSettings(patch) { this.data.settings = { ...this.data.settings, ...patch }; this.changed("settings"); return this.data.settings; }

  isTeacher() { const c = this.data.classes.find((x) => x.id === this.data.cid); return !!(c && c.is_teacher); }
  async wallPost(title, body, notice) {
    if (!this.data.cid) throw new Error("还没加入班级");
    await this.api.rpc("wall_post", { cid: this.data.cid, p_title: String(title || "").slice(0, 60), p_body: String(body || "").slice(0, 2000), p_notice: !!notice });
    await this.refresh();
  }

  // 给界面用的一份数据（不含登录令牌）
  snapshot() {
    const d = this.data;
    return { me: d.me, perms: d.perms, classes: d.classes, cid: d.cid, items: d.items, wall: d.wall, features: d.features, courses: d.courses,
      mine: d.ns.personal_events_v1, marks: d.ns.personal_marks_v1, doneLog: d.ns.done_log_v1, pomo: d.ns.pomo_log_v1,
      settings: d.settings, status: this.status, lastRefresh: d.lastRefresh, pending: Object.keys(d.outbox).length };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, dayKey, SYNC_NS };
