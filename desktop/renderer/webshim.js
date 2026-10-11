// 网站模块的「转接头」：课内学习、思维导图、云宠农场、元宇宙工具箱这几块直接用网站的原代码
// （打包时 scripts/sync-web.js 从网站拷最新版到 renderer/web/，每个文件外面包一层 with (WebShim.scope)），
// 网站代码里用到的 app.js 全局变量（$、currentUser、save、Sync……）在这里换成电脑版的数据，读的时候都是最新值。
// 这样网站以后改了这几块，电脑版重新打包就跟着变，不用再抄一遍。
"use strict";
(function () {
  const SYNC_KIND = {};   // 同步数据：哪些 localStorage 键其实是账号里的数据（和 core/store.js 的 KINDS 一致）
  ["course_rev_v1", "kn_rev_v1", "mm_rev_v1", "profile_v1", "fun_opts_v1", "plugins_enabled_v1", "home_layout_v1", "ui_skin_v1", "ui_palette_v1", "home_quick_tools_v1", "island_v1", "farm_v1"].forEach((k) => (SYNC_KIND[k] = "one"));
  ["personal_events_v1", "habits_v1", "quad_todos_v1", "countdown_v1"].forEach((k) => (SYNC_KIND[k] = "list"));
  ["course_view_v1", "personal_marks_v1", "done_log_v1", "pomo_log_v1", "quad_v1", "plan_notes_v1", "mood_log_v1", "focus_min_v1"].forEach((k) => (SYNC_KIND[k] = "map"));
  SYNC_KIND.habit_log_v1 = "map2";
  const SEP = "\u0001";
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem("web:" + k)); return v ?? d; } catch (e) { return d; } };
  const lsPut = (k, v) => { try { v == null ? localStorage.removeItem("web:" + k) : localStorage.setItem("web:" + k, JSON.stringify(v)); } catch (e) {} };

  // 网站的 load / save：同步数据走账号（kv:set），别的存在这台电脑上
  function load(k, d) {
    if (SYNC_KIND[k]) { const v = App.S && App.S.kv ? App.S.kv[k] : undefined; return v === undefined || v === null ? d : JSON.parse(JSON.stringify(v)); }
    return lsGet(k, d);
  }
  function save(k, v) {
    const kind = SYNC_KIND[k];
    if (!kind) { lsPut(k, v); return; }
    const cur = (App.S && App.S.kv && App.S.kv[k]) ?? (kind === "list" ? [] : kind === "one" ? null : {});
    if (App.S && App.S.kv) App.S.kv[k] = JSON.parse(JSON.stringify(v ?? null));   // 先在界面里改好，主进程推回来之前也是新值
    if (kind === "one") { call("kv:set", k, "_", v ?? null).catch(() => {}); return; }
    const ops = [];
    if (kind === "list") {
      const a = new Map((cur || []).map((x) => [String(x.id), x])), b = new Map((v || []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]));
      for (const [id, x] of b) if (JSON.stringify(a.get(id)) !== JSON.stringify(x)) ops.push([k, id, x]);
      for (const id of a.keys()) if (!b.has(id)) ops.push([k, id, null]);
    } else if (kind === "map2") {
      const flat = (o) => { const m = new Map(); for (const x in o || {}) for (const y in o[x] || {}) m.set(x + SEP + y, o[x][y]); return m; };
      const a = flat(cur), b = flat(v);
      for (const [id, x] of b) if (JSON.stringify(a.get(id)) !== JSON.stringify(x)) ops.push([k, id.split(SEP), x]);
      for (const id of a.keys()) if (!b.has(id)) ops.push([k, id.split(SEP), null]);
    } else {
      for (const id in v || {}) if (JSON.stringify((cur || {})[id]) !== JSON.stringify(v[id])) ops.push([k, id, v[id]]);
      for (const id in cur || {}) if (!(id in (v || {}))) ops.push([k, id, null]);
    }
    if (ops.length) call("kv:batch", ops).catch(() => {});
  }

  // 网站的 Sync：别的设备改了某类数据 → onChange 收到一组变了的键
  const changeCbs = [], noteCbs = [], stateCbs = [];
  let lastKv = {};
  function stateArrived(S) {
    const kv = (S && S.kv) || {}, changed = new Set();
    for (const k in SYNC_KIND) { const a = JSON.stringify(kv[k] ?? null); if (lastKv[k] !== undefined && lastKv[k] !== a) changed.add(k); lastKv[k] = a; }
    if (changed.size) changeCbs.forEach((f) => { try { f(changed); } catch (e) { console.error(e); } });
    stateCbs.forEach((f) => { try { f(); } catch (e) {} });
  }
  const Sync = {
    note() {}, active: () => true, mode: () => "cloud", rev: () => 0, now: () => App.now().getTime(), setClock() {}, kinds: SYNC_KIND,
    onChange: (f) => changeCbs.push(f), onNote: (f) => noteCbs.push(f), onState: (f) => stateCbs.push(f),
    status: () => ({ state: App.S && App.S.status && App.S.status.syncing ? "syncing" : "ok", pending: (App.S && App.S.pending) || 0, lastOk: (App.S && App.S.lastRefresh) || 0 }),
    pull: () => call("refresh"), flush: async () => {}, emitChanged: (set) => changeCbs.forEach((f) => f(set)),
  };
  // 网站的 CCAuth：只用到 rpc（走主进程的白名单），用户信息从 App.S 拿
  const CCAuth = { rpc: (fn, args) => window.cc.call("api:rpc", fn, args || {}).catch((e) => { throw new Error(cleanErr(e)); }), rest: (p) => window.cc.call("api:get", p), esc };

  // 网站格式的事项（_key、_p、_done、msg_type、subject……），农场、课内学习算养料、截止用
  function webItems() {
    return App.items().map((x) => ({ ...(x.raw || {}), _key: x.key, id: x.mine ? x.key : x.id, _mine: !!x.mine, _study: x.study ? x.studyId : undefined, msg_type: x.mine && x.type !== "作业" ? "个人" : x.type,
      subject: x.title, summary: x.summary, location: x.location, event_time: x.day ? x.day + (x.time ? " " + x.time : "") : "", _p: x.day ? { day: x.day, time: x.time } : null,
      _done: !!x.done, _hidden: !!x.hidden, _note: x.note, kind: x.kind || undefined, need_confirm: !!x.confirm }));
  }
  const ccDate = () => App.now();
  const keyOf = (d) => M.dayKey(d);
  const parseTime = (t) => M.parseTime(t);
  const weekStats = () => {
    const now = App.now(), mon = M.dayKey(M.addDays(now, -M.weekday0(now))), sun = M.dayKey(M.addDays(now, 6 - M.weekday0(now))), t = M.dayKey(now);
    const wk = App.items().filter((x) => !x.hidden && x.day && x.day >= mon && x.day <= sun), hw = wk.filter((x) => x.type === "作业");
    const hs = KV("habits_v1"), hl = KV("habit_log_v1") || {};
    return { hwDone: hw.filter((x) => x.done).length, hwAll: hw.length, allDone: wk.filter((x) => x.done).length, all: wk.length, hDone: hs.filter((h) => (hl[h.id] || {})[t]).length, hAll: hs.length };
  };
  const dueInfo = (r) => { if (!r._p) return { text: "没定日子", cls: "" }; const x = { day: r._p.day, time: r._p.time, done: r._done }; return { text: whenText(x, App.now()) + (r.msg_type === "作业" && r._p.time ? " 截止" : ""), cls: overdue(x, App.now()) ? "late" : "" }; };
  const scope = {
    $: (id) => document.getElementById(id), esc, load, save, Sync, CCAuth, keyOf, ccDate, ccNow: () => App.now().getTime(), parseTime, WEEK: M.WEEK,
    showBanner: (msg) => { if (msg) toast(String(msg).replace(/<[^>]+>/g, "")); },
    showView: (id) => { const map = { home: "today", calendar: "month", ask: "ai", store: "tools", user: "people" }; App.go(map[id] || id); },
    currentView: () => ({ study: "study", mindmap: "mindmap", farm: "farm", today: "home", month: "calendar" })[App.view] || App.view,
    renderAll: () => { App._itemsOf = null; try { navCounts(); } catch (e) {} },
    renderWidgets() {}, renderIsland() {}, laoSay() {}, buzz() {}, isMobile: () => false,
    feat: (k) => App.feat(k), funOpts: () => ({ farm: true, ...App.fun() }), todayKey: () => todayKey(), shiftDay: (k, n) => shiftDay(k, n), dayDiff: (k) => M.dayDiff(k, App.now()),
    allItems: webItems, weekStats, dueInfo, confetti: (n) => confetti(n || 40),
    toggleHabit: (id) => call("habit", id).then((on) => on && cheer("habit")),
    rankCache: null, loadRankData: () => Promise.reject(new Error("no")),
    ck: () => ({ data: { courses: (App.S.courses.courses || []).map((c) => ({ ...c })) }, on: () => true }),
    get currentUser() { const me = App.S && App.S.me; return me && App.S.loggedIn ? { ...me, id: me.id } : null; },
    get currentClass() { return App.cls && App.S ? App.cls() : null; },
    get habits() { return KV("habits_v1"); }, get habitLog() { return KV("habit_log_v1") || {}; },
    get doneLog() { return (App.S && App.S.doneLog) || {}; }, get pomoLog() { return (App.S && App.S.pomo) || {}; },
    get mine() { return (App.S && App.S.mine) || []; }, get classRecords() { return (App.S && App.S.items) || []; },
  };
  window.WebShim = { scope, stateArrived, load, save, mods: {}, put(name, o) { this.mods[name] = Object.assign(this.mods[name] || {}, o); } };
  window.cc.on("state", (s) => setTimeout(() => stateArrived(s), 0));
})();
