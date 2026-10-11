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
// 网页版以后再加新的类型也不怕：不认识的记录原样存在 raw 里（不会丢，也不会被跳过），备份里也带着
const KINDS = {
  course_rev_v1: "one", course_view_v1: "map", kn_rev_v1: "one", mm_rev_v1: "one",
  personal_events_v1: "list", personal_marks_v1: "map", done_log_v1: "map", pomo_log_v1: "map",
  habits_v1: "list", habit_log_v1: "map2", quad_v1: "map", quad_todos_v1: "list", plan_notes_v1: "map", mood_log_v1: "map",
  profile_v1: "one", fun_opts_v1: "one", plugins_enabled_v1: "one", home_layout_v1: "one", ui_skin_v1: "one", ui_palette_v1: "one", home_quick_tools_v1: "one",
  island_v1: "one", farm_v1: "one",
  countdown_v1: "list", focus_min_v1: "map",          // 电脑版加的：倒数日、每天专注了多少分钟（网页版会原样保留）
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
  accent: "jade",          // 主色（jade = 和网站一样的青绿）
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
  autodelMine: true,       // 自己记的事项过期 2 周自动删除（和网页版「我自己记的」开关一样）
  liveSync: true,          // 实时同步：别的设备改了，几秒内就同步过来
  lanSync: true,           // 局域网互传：「只存在这台设备」的事项，同一个 Wi-Fi 里登录同一账号的设备之间直接传（不经过服务器）
};

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 北京时间的「今天」（和网页版一样按东八区算）
const bjDay = (ms) => dayKey(new Date(ms + (new Date().getTimezoneOffset() + 480) * 60000));
const blankNs = () => { const o = {}; for (const [k, kind] of Object.entries(KINDS)) o[k] = kind === "list" ? [] : kind === "one" ? null : {}; return o; };

function blank() {
  return {
    v: 2, uid: null, me: null, perms: [], classes: [], cid: null, items: [], groups: [], classOpts: {}, wall: null, features: null, plugins: null,
    courses: { courses: [], meta: {} }, ns: blankNs(),
    sync: { rev: 0, t: {} }, outbox: {}, lastRefresh: 0, settings: { ...DEFAULT_SETTINGS }, attach: {}, flags: {}, raw: {},
    extras: { cid: null, autodel: true, canSet: false, keep: {}, files: {}, loaded: false }, dev: "",
    localIds: {},   // 「只存在这台设备」的记录（ns + SEP + id）：不上传云端，只在局域网里互传
  };
}

class Store extends EventEmitter {
  constructor({ api, file, now }) {
    super();
    this.api = api; this.file = file; this.realNow = now || (() => Date.now());
    this.clockOff = 0;                                  // 本机时间比服务器慢了多少（sync_ping 校准），修改时间以服务器为准
    this.now = () => this.realNow() + this.clockOff;
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
        attach: d.attach || {}, flags: d.flags || {}, localIds: d.localIds && typeof d.localIds === "object" ? d.localIds : {}, raw: d.raw && typeof d.raw === "object" ? d.raw : {}, extras: { ...b.extras, ...(d.extras || {}) } };
      for (const [k, kind] of Object.entries(KINDS)) {   // 坏数据兜底
        const v = this.data.ns[k];
        if (kind === "list" && !Array.isArray(v)) this.data.ns[k] = [];
        if ((kind === "map" || kind === "map2") && (!v || typeof v !== "object" || Array.isArray(v))) this.data.ns[k] = {};
      }
      if ((d.v || 1) < 2) this.migrate1();
      // 3.0 换了新界面：默认主色从蓝色换成和网站一样的青绿（自己挑过别的颜色的不动）
      if (!this.data.flags.ui3) { if (!this.data.settings.accent || this.data.settings.accent === "blue") this.data.settings.accent = "jade"; this.data.flags.ui3 = true; }
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
  async signup(account, password, info) {
    const s = await this.api.signUp(account, password, info);
    if (this.data.uid && this.data.uid !== s.user_id) { const keep = this.data.settings; this.data = blank(); this.data.settings = keep; }
    this.data.uid = s.user_id; this.save(true);
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
        await this.loadCourses().catch(() => {});   // 课程表功能关着时会失败，不影响别的
        await this.pull();
        await this.loadExtras().catch(() => {});
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

  async loadCourses() {
    const c = await this.api.rpc("courses_get", {}, { retry: true });
    if (c) { this.data.courses = { courses: c.courses || [], meta: c.meta || {}, updated_at: c.updated_at }; this.changed("courses"); }
    return c;
  }

  // ---------- 事项附件数量、过期自动删除（和网页版 extras.js 同一套接口） ----------
  async loadExtras() {
    const cid = this.data.cid || null;
    try {
      const r = await this.api.rpc("item_extras", { cid }, { retry: true });
      this.data.extras = { cid, autodel: r.autodel !== false, canSet: !!r.can_set, keep: r.keep || {}, files: r.files || {}, loaded: true };
      if (r.deleted && r.deleted.length) { const g = new Set(r.deleted.map(String)); this.data.items = this.data.items.filter((x) => !g.has(String(x.id))); }
    } catch (e) { if (e.status !== 404) throw e; }   // 服务器还没升级：不影响别的
    this.cleanMine();
    this.changed("extras");
  }
  // 自己记的事项：日期过去 2 周自动删除（推迟过的看 keep）。第一次用时，已经过期的先多留 3 天
  cleanMine() {
    const today = bjDay(this.now()), list = this.data.ns.personal_events_v1;
    const addD = (k, n) => { const x = new Date(k + "T00:00:00"); x.setDate(x.getDate() + n); return dayKey(x); };
    const exp = (m) => { const p = M.parseTime(m.event_time); if (!p) return null; const base = addD(p.day, 14); return m.keep && m.keep > base ? m.keep : base; };
    if (!this.data.flags.autodelGrace) {
      for (const m of list) { const e = exp({ ...m, keep: "" }); if (e && e < addD(today, 3)) { m.keep = addD(today, 3); this.record("personal_events_v1", m.id, m); } }
      this.data.flags.autodelGrace = true; return;
    }
    if (!this.data.settings.autodelMine) return;
    const gone = list.filter((m) => { const e = exp(m); return e && e < today; });
    if (!gone.length) return;
    for (const m of gone) { list.splice(list.indexOf(m), 1); this.record("personal_events_v1", m.id, null); delete this.data.attach[m.id]; }
    this.api.rpc("file_del_items", { items: gone.map((m) => m.id) }).catch(() => {});
  }
  // 推迟删除（多留 3 天）
  async keepItem(key) {
    if (/^c\d+$/.test(key)) {
      if (!this.data.cid) throw new Error("还没加入班级");
      const r = await this.api.rpc("item_keep", { cid: this.data.cid, item_id: +key.slice(1) });
      this.data.extras.keep[key] = r.keep_until; this.changed("extras"); return r.keep_until;
    }
    const it = this.data.ns.personal_events_v1.find((x) => x.id === key); if (!it) throw new Error("没找到这件事");
    const today = bjDay(this.now()), p = M.parseTime(it.event_time);
    const addD = (k, n) => { const x = new Date(k + "T00:00:00"); x.setDate(x.getDate() + n); return dayKey(x); };
    let e = p ? addD(p.day, 14) : today; if (it.keep && it.keep > e) e = it.keep;
    this.upsertMine({ ...it, keep: addD(e > today ? e : today, 3) });
    return this.data.ns.personal_events_v1.find((x) => x.id === key).keep;
  }
  async setClassAutodel(on) {
    if (!this.data.cid) throw new Error("还没加入班级");
    this.data.extras.autodel = await this.api.rpc("class_autodel_set", { cid: this.data.cid, on_: !!on }); this.changed("extras"); return this.data.extras.autodel;
  }
  // 附件数量：没变就什么都不做（详情栏每次画都会报一次数量；以前每次都通知界面重画，详情栏就一直在重画、按钮点不动）
  setFileCount(key, n) {
    n = Math.max(0, n | 0);
    if ((this.data.extras.files[key] || 0) === n) return false;
    if (n) this.data.extras.files[key] = n; else delete this.data.extras.files[key];
    this.changed("extras"); return true;
  }

  // ---------- 实时同步：每隔几秒问一次服务器有没有新东西（sync_ping，很轻），顺便校准时钟 ----------
  async ping() {
    if (this.pingOff || this.pinging || !this.data.uid) return null;
    if (!this.data.dev) { this.data.dev = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); this.save(); }
    this.pinging = true;
    const t0 = this.realNow();
    try {
      const cid = this.data.cid || null;
      const lan = this.lanWanted();
      const r = await this.api.rpc("sync_ping", { p_dev: this.data.dev, p_cid: cid, p_lan: lan, p_kind: "desktop" + (lan && this.hasLocal() ? "+L" : "") }, { timeout: 8000 });
      const t1 = this.realNow();
      if (r && r.now) {
        const o = r.now - (t0 + t1) / 2;
        this.clockOff = Math.abs(o - this.clockOff) > 1000 || !this.pingAt ? Math.round(o) : Math.round(this.clockOff * 0.8 + o * 0.2);
        M.setClock(this.clockOff);
      }
      this.pingAt = this.realNow(); this.pingFail = 0;
      if (r && r.rev > (this.data.sync.rev || 0) && !this.busy) await this.pull().catch(() => {});
      if (r && cid && r.csig != null && this.data.cid === cid) {
        if (this.csig && this.csig.cid === cid && this.csig.v !== r.csig) this.reloadClass().then(() => this.loadExtras()).catch(() => {});
        this.csig = { cid, v: r.csig };
      }
      if (this.status.error || !this.status.online) { this.status = { ...this.status, online: true, error: "" }; this.emit("status", this.status); }
      // 局域网互传：同一账号在线的设备、别的设备发来的连接信息，交给界面去连（WebRTC 在界面里）
      this.emit("lan", { dev: this.data.dev, on: lan, peers: (r && r.peers) || [], sig: (r && r.sig) || [] });
      return r;
    } catch (e) {
      this.pingFail = (this.pingFail || 0) + 1;
      if (e && (e.status === 404 || /sync_ping|PGRST202|Could not find/i.test(e.message || ""))) this.pingOff = true;   // 服务器还没装：退回定时同步
      if (e && e.status === 401) this.emit("auth-expired");
      return null;
    } finally { this.pinging = false; }
  }

  // ---------- 局域网互传 ----------
  lanWanted() { return this.data.settings.lanSync !== false && !!this.data.uid; }
  hasLocal() { return Object.keys(this.data.localIds).length > 0; }
  async lanSend(to, body) {
    if (!this.lanWanted() || !/^[A-Za-z0-9_-]{6,40}$/.test(String(to || ""))) return false;
    await this.api.rpc("lan_send", { p_from: this.data.dev, p_to: String(to), p_body: body }, { timeout: 8000 });
    return true;
  }
  // 局域网收到的记录：只接「只存在这台设备」的列表记录（带 local 标记），以后改的为准由界面判断过了
  lanApply(list) {
    let n = 0;
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || KINDS[x.k] !== "list" || x.r == null) continue;
      const key = x.k + SEP + x.r, cur = this.data.ns[x.k].find((y) => y && String(y.id) === String(x.r));
      if (x.v == null) { if (cur && cur.local) { this.kvSet(x.k, x.r, null, true); n++; } continue; }
      if (cur && !cur.local) continue;                        // 本机这条是同步到云端的：不让局域网盖掉
      if (!this.data.localIds[key] && this.tOf(x.k, String(x.r))) continue;
      this.kvSet(x.k, x.r, { ...x.v, id: x.v.id ?? x.r, local: true }, true); n++;
    }
    if (n) this.changed("lan");
    return n;
  }

  async switchClass(cid) { this.data.cid = cid; this.data.items = []; this.data.groups = []; this.data.wall = null; this.changed(); return this.refresh(); }

  // ---------- 云端同步（和网页版同一套规则：每条记录带修改时间，以后改的为准） ----------
  tOf(ns, k) { return ((this.data.sync.t[ns] || {})[k]) || 0; }
  record(ns, k, v) {
    // 「只存在这台设备」的记录不上传；原来在云端的改成只存本机：云端那条删掉
    const lk = ns + SEP + k;
    if (KINDS[ns] === "list" && ((v && v.local) || (v == null && this.data.localIds[lk]))) {
      if (v == null) delete this.data.localIds[lk]; else this.data.localIds[lk] = 1;
      if (!this.tOf(ns, k)) return;
      v = null; delete this.data.sync.t[ns][k];
      this.data.outbox[lk] = { ns, k, v: null, t: Math.max(this.now(), 1) };
      clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.flush().catch(() => {}), 800);
      return;
    }
    if (KINDS[ns] === "list") delete this.data.localIds[lk];
    const t = Math.max(this.now(), this.tOf(ns, k) + 1);
    (this.data.sync.t[ns] ||= {})[k] = t;
    this.data.outbox[ns + SEP + k] = { ns, k, v: v === undefined ? null : v, t };
    clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.flush().catch(() => {}), 800);
  }
  applyRow(row) {
    const { ns, k } = row, kind = KINDS[ns];
    if (!kind) {   // 不认识的类型：原样记下（以后升级了也能用；从备份恢复时也会带上）
      if (typeof ns !== "string" || !/^[a-z0-9_]{1,60}$/.test(ns)) return false;
      const r = (this.data.raw[ns] ||= {}), old = r[k];
      if (old && old.t > row.t) return false;
      if (row.v == null) delete r[k]; else r[k] = { v: row.v, t: row.t };
      return false;
    }
    if (this.data.localIds[ns + SEP + k]) return false;              // 只存本机的这条以本机为准
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
    const rev0 = JSON.stringify(this.data.ns.course_rev_v1 || null);
    for (let guard = 0; guard < 50; guard++) {
      const r = await this.api.rpc("udata_pull", { since: this.data.sync.rev || 0 }, { retry: true });
      for (const row of (r && r.rows) || []) if (this.applyRow(row)) n++;
      this.data.sync.rev = (r && r.rev) || this.data.sync.rev;
      if (!r || !r.more) break;
    }
    if (n) this.changed("pull");
    // 别的设备改了课表（course_rev_v1 变了）：马上拿新课表
    if (JSON.stringify(this.data.ns.course_rev_v1 || null) !== rev0) this.loadCourses().catch(() => {});
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
    // kind：作业 / 普通；from：改的是哪条班级事项；keep：推迟自动删除到哪天（这几个和网页版同名）
    if (rec.kind !== "作业") delete rec.kind;
    if (!/^c\d+$/.test(String(rec.from || ""))) delete rec.from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rec.keep || ""))) delete rec.keep;
    if (rec.local) rec.local = true; else delete rec.local;   // 只存在这台设备（和网页版同名）
    for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
    if (i >= 0) list[i] = rec; else list.push(rec);
    this.record("personal_events_v1", id, rec);
    this.changed("mine");
    return rec;
  }
  // 「编辑（仅自己）」：把班级事项存成自己的一条，原来那条替我隐藏（删掉这条就恢复）
  overrideClassItem(fromKey, rec) {
    if (!/^c\d+$/.test(fromKey)) throw new Error("只能改班级事项");
    const out = this.upsertMine({ ...rec, id: undefined, from: fromKey });
    this.setMark(fromKey, { hidden: true });
    return out;
  }
  deleteMine(id) {
    const list = this.data.ns.personal_events_v1, i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const from = list[i].from;
    list.splice(i, 1); this.record("personal_events_v1", id, null);
    if (from) this.setMark(from, { hidden: false });   // 删掉「仅自己」的版本：班级原来那条重新显示
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
    } else if (/^kn\d+$/.test(key)) {
      this.setMark(key, { done: !!done });   // 课内学习的考核：和网页版一样记在完成标记里
    } else {
      const it = this.data.ns.personal_events_v1.find((x) => x.id === key); if (!it) return;
      this.upsertMine({ ...it, done: !!done });
    }
    const log = this.data.ns.done_log_v1;
    if (done) log[key] = bjDay(this.now()); else delete log[key];
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
    const k = bjDay(this.now()), pl = this.data.ns.pomo_log_v1, fm = this.data.ns.focus_min_v1;
    pl[k] = (Number(pl[k]) || 0) + 1; fm[k] = (Number(fm[k]) || 0) + Math.max(1, Math.round(minutes));
    this.record("pomo_log_v1", k, pl[k]); this.record("focus_min_v1", k, fm[k]);
    this.growth("pomo", k + "|" + pl[k], false);
    this.changed("pomo");
  }
  // 习惯打卡（今天打过就取消）
  toggleHabit(id, day) {
    day = day || bjDay(this.now());
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
    m.adj = M.cleanAdj(m.adj);   // 调课 / 调休：一定要带上，不然会把网页版记的冲掉
    try {
      const r = await this.api.rpc("courses_sync", { p_courses: list, p_meta: { week1: m.week1 || null, times: m.times || [], ics: m.ics !== false, adj: m.adj } });
      const srv = (r && r.updated_at) || "";
      if (srv) { this.data.courses.updated_at = srv; this.kvSet("course_rev_v1", "_", { at: srv, n: list.length }, true); }   // 告诉别的设备：课表变了
      this.changed("courses");
    }
    catch (e) { if (e.status === 404) { this.data.courses = prev; this.changed("courses"); throw new Error("服务器还不支持保存课程表，请管理员更新数据库"); } throw e; }
    return list.length;
  }

  // 课内学习的考核（界面交过来的，存一份在本机：电脑关了网也能提醒）
  setExtraItems(list) {
    const clean = (Array.isArray(list) ? list : []).filter((x) => x && /^kn\d+$/.test(String(x.key))).slice(0, 300).map((x) => ({
      key: String(x.key), studyId: x.studyId, course: String(x.course || "").slice(0, 60), title: String(x.title || "").slice(0, 200), summary: String(x.summary || "").slice(0, 500),
      day: /^\d{4}-\d{2}-\d{2}$/.test(x.day || "") ? x.day : "", time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : "" }));
    if (JSON.stringify(clean) === JSON.stringify(this.data.extraItems || [])) return false;
    this.data.extraItems = clean; this.changed("extra"); return true;
  }
  // 只改调课 / 调休
  async saveAdj(adj) { return this.saveCourses(this.data.courses.courses || [], { adj: M.cleanAdj(adj) }); }

  // 给界面用的一份数据（不含登录令牌）
  snapshot() {
    const d = this.data;
    return { me: d.me, perms: d.perms, classes: d.classes, cid: d.cid, items: d.items, groups: d.groups || [], classOpts: d.classOpts || {}, groupsOk: !!d.groupsOk,
      wall: d.wall, features: d.features, courses: d.courses, plugins: d.plugins,
      mine: d.ns.personal_events_v1, marks: d.ns.personal_marks_v1, doneLog: d.ns.done_log_v1, pomo: d.ns.pomo_log_v1, focusMin: d.ns.focus_min_v1,
      kv: d.ns, attach: d.attach, settings: d.settings, status: this.status, lastRefresh: d.lastRefresh, pending: Object.keys(d.outbox).length,
      extras: d.extras, extraItems: d.extraItems || [], clockOff: this.clockOff, live: !this.pingOff && !!this.pingAt, dev: d.dev, lanOk: !this.pingOff };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, dayKey, SYNC_NS, KINDS };
