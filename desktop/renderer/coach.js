// 3.3.3（网站 5.9.3）捞捞教练：规则在 ../core/coach-core.js（和网页、小程序、安卓 App 同一套）
//   · 要在卡片或设置里点「开启」才开始记录；原始记录只存在这台电脑（主进程 data.json 的 coachLog，不同步），
//     跟着账号同步的只有统计数字（coach_v1，每台设备一条）
//   · 首页「今日教练」卡片、捞捞偶尔说一句、系统通知（状态最好的钟点 / 连续天数快断了 / 周日晚上复盘，一天最多 3 条）、教练弹窗（每周复盘、节奏、设置）
"use strict";
const Coach59 = {
  log: [], logAt: 0, lastSync: "", timers: [], planAt: 0,
  on() { return !!(App.S && App.S.settings && App.S.settings.coach); },
  opt(k, d) { const v = App.S && App.S.settings ? App.S.settings["coach_" + k] : undefined; return v === undefined ? d : !!v; },
  async refreshLog(force) {
    if (!this.on()) { this.log = []; return; }
    if (!force && Date.now() - this.logAt < 20000) return;
    try { this.log = (await call("coach:log")) || []; this.logAt = Date.now(); } catch (e) {}
  },
  model() {
    const now = App.now(), mine = CoachCore.learn(this.log, now), all = KV("coach_v1") || {}, dev = App.S.dev || "desktop";
    const bg = this.bag(); if (bg && bg.own) mine.bag = { own: bg.own, n: bg.n || 0 };      // 3.3.4 收藏也跟着账号（只有「有哪几样」）
    // 只有统计数字跟着账号同步；有变化才写
    const sig = JSON.stringify({ day: mine.day, h: mine.h, sty: mine.sty, sus: mine.sus, bag: mine.bag });
    if (sig !== this.lastSync && (this.log.length || mine.bag)) { this.lastSync = sig; kvSet("coach_v1", dev, mine); }
    const others = Object.keys(all).filter((k) => k !== dev).map((k) => all[k]).filter((m) => m && m.v === 1 && now - (m.at || 0) < 90 * 86400000);
    return CoachCore.combine([mine].concat(others));
  },
  skips() { let o = {}; try { o = JSON.parse(localStorage.getItem("coach_skip_v1") || "{}"); } catch (e) {} const n = Date.now(); for (const k in o) if (o[k] < n) delete o[k]; return o; },
  skip(k) { const o = this.skips(); o[k] = Date.now() + 2 * 3600000; try { localStorage.setItem("coach_skip_v1", JSON.stringify(o)); } catch (e) {} },
  ranked() { const c = DIsland.ctx(); return { c, ranked: IslandCore.rank(c.items, c.courses, c.now) }; },
  current() { const { c, ranked } = this.ranked(); return CoachCore.suggest({ now: c.now, ranked, model: this.model(), log: this.log, skip: this.skips() }); },
  shown(key, style) {
    if (!style) return;
    let o = {}; try { o = JSON.parse(localStorage.getItem("coach_shown_v1") || "{}"); } catch (e) {}
    const k = key + "|" + style, n = Date.now(); if (n - (o[k] || 0) < 3 * 3600000) return;
    for (const x in o) if (n - o[x] > 86400000) delete o[x];
    o[k] = n; try { localStorage.setItem("coach_shown_v1", JSON.stringify(o)); } catch (e) {}
    call("coach:rec", { e: "show", k: key, s: style }).then(() => (this.logAt = 0)).catch(() => {});
  },
  accept(key, style) { if (style) call("coach:rec", { e: "acc", k: key, s: style }).then(() => (this.logAt = 0)).catch(() => {}); },
  fmt(x) { return String(Math.round(x * 10) / 10); },
  bag() { try { return JSON.parse(localStorage.getItem(CoachCore.BAG) || "null"); } catch (e) { return null; } },
  wear(e) {
    const bot = document.getElementById("laoBot"); if (!bot) return;
    let w = bot.querySelector(".lao-wear");
    if (!e) { if (w) w.remove(); return; }
    if (!w) { w = document.createElement("em"); w.className = "lao-wear"; w.style.cssText = "position:absolute;left:50%;top:-14px;transform:translateX(-50%);font-size:24px;font-style:normal;pointer-events:none"; bot.appendChild(w); }
    w.textContent = e;
  },

  // ---------- 首页卡片 ----------
  async render() {
    const box = document.getElementById("tdCoach"); if (!box) return;
    if (!App.S || !App.S.loggedIn) { box.innerHTML = ""; return; }
    if (!this.on()) {
      box.innerHTML = App.S.settings.coach_asked ? "" : `<div class="cc-card"><b class="cc-say" style="font-size:16px">🧭 要不要试试捞捞教练？</b>
        <p class="muted" style="margin:6px 0 0;line-height:1.6;font-size:13px">开启后，捞捞会在这台电脑上记下你几点完成了事、专注了多久，慢慢学会你的节奏：推荐现在最适合做的事、定一个够得着的小目标、在你状态最好的时候提醒、每周给你复盘。原始记录只存在本机；同步到账号的只有统计数字，没有标题和内容。随时可以关掉、清空。</p>
        <div class="cc-btns"><button class="btn primary sm" data-cc="on">开启</button><button class="btn sm" data-cc="no">不用了</button></div></div>`;
      return;
    }
    await this.refreshLog();
    let s; try { s = this.current(); } catch (e) { console.error(e); return; }
    const top = s.top && s.top.kind !== "course" ? s.top : null, pct = Math.min(100, Math.round((s.goal.done / Math.max(1, s.goal.target)) * 100));
    if (top) this.shown(top.key, s.style);
    box.innerHTML = `<div class="cc-card">
      <div class="cc-h"><span class="cc-k">🧭 今日教练</span>${s.streak.days ? `<span class="cc-chip ${s.streak.atRisk ? "risk" : "fire"}">🔥 ${s.streak.days} 天</span>` : ""}<span class="cc-chip ${s.goal.met ? "ok" : ""}">${s.goal.met ? "今日目标 ✓" : `今日 ${this.fmt(s.goal.done)}/${s.goal.target}`}</span></div>
      <div class="cc-bar"><i class="${s.goal.met ? "ok" : ""}" style="width:${pct}%"></i></div>
      <div class="cc-say">${esc(s.say)}</div>
      ${top ? `<div class="cc-top"><b>${esc(top.title)}</b><small>${esc([top.reason, top.step].filter(Boolean).join(" · "))}</small></div>
        <div class="cc-btns"><button class="btn primary sm" data-cc="start" data-k="${esc(top.key)}" data-s="${esc(s.style || "")}" data-t="${esc(top.kind === "pomo" ? "" : top.title)}">▶ 开始 25 分钟</button>
        ${top.kind === "item" ? `<button class="btn sm" data-cc="done" data-k="${esc(top.key)}" data-s="${esc(s.style || "")}">✓ 做完了</button><button class="btn ghost sm" data-cc="skip" data-k="${esc(top.key)}">换一个</button>` : ""}</div>`
        : s.mode === "sleep" ? `<div class="muted" style="margin-top:6px">🌙 明天的事明天再说</div>` : s.mode === "rest" ? `<div class="muted" style="margin-top:6px">🍵 休息也是计划的一部分</div>` : ""}
      ${s.mode !== "class" && s.mode !== "sleep" && window.FlowUI ? `<button class="cc-flow" data-cc="flow"><b>🔥 刷任务</b><small>一张张小卡，按空格下一张 · 走完有机会掉宝贝</small></button>` : ""}
      <button class="cc-more" data-cc="open">📊 本周复盘 · 你的节奏 ›</button></div>`;
  },
  async onClick(e) {
    const b = e.target.closest("[data-cc]"); if (!b) return false;
    const a = b.dataset.cc, k = b.dataset.k, st = b.dataset.s;
    if (a === "on") { await call("settings", { coach: true, coach_asked: true }); toast("捞捞教练开始学你的节奏啦，用几天会越来越准"); this.logAt = 0; this.plan(true); }
    else if (a === "no") { await call("settings", { coach_asked: true }); toast("以后可以在「设置」里打开捞捞教练"); }
    else if (a === "start") { this.accept(k, st); await call("pomo:start", App.S.settings.pomoFocus || 25, b.dataset.t || ""); App.go("focus"); }
    else if (a === "done") { this.accept(k, st); await toggleDone(k, true); }
    else if (a === "skip") { this.skip(k); }
    else if (a === "open") { this.open(); return true; }
    else if (a === "flow") { await this.refreshLog(true); FlowUI.open(); return true; }
    else if (a === "book") { closeOverlay(); FlowUI.book(); return true; }
    setTimeout(() => this.render(), 120);
    return true;
  },

  // ---------- 教练弹窗：每周复盘、你的节奏、设置 ----------
  async open() {
    await this.refreshLog(true);
    const on = this.on(), m = this.model(), now = App.now(), r = CoachCore.weekly(m, now), g = CoachCore.goal(m, now);
    const hours = []; for (let i = 7; i <= 23; i++) hours.push(i);
    const max = Math.max(0.0001, ...hours.map((i) => m.h[i]));
    const d = h(`<div class="dialog" role="dialog" style="max-width:560px">
      <h3>🧭 捞捞教练<small class="muted" style="font-weight:400;margin-left:8px">学你的节奏，推荐现在最适合做的事</small></h3>
      <div class="dbody" style="max-height:70vh;overflow:auto">
        ${on ? `<div class="cc-stats"><div><b>${this.fmt(r.thisWeek.done)}</b><small>这周完成</small></div><div><b>${this.fmt(r.lastWeek.done)}</b><small>上周</small></div><div><b>${r.streak}</b><small>连续天数</small></div></div>
        ${r.highlights.map((x) => `<div class="cc-li">✨ ${esc(x)}</div>`).join("")}
        ${r.next.length ? `<div class="cc-sub">下周可以试试</div>${r.next.map((x) => `<div class="cc-li">· ${esc(x)}</div>`).join("")}` : ""}
        <div class="cc-sub">你的节奏 <small class="muted">${r.best.length ? "状态最好：" + r.best.map((x) => x + ":00").join("、") : "再用几天就能看出来"}</small></div>
        <div class="cc-bars">${hours.map((x) => `<i class="${r.best.includes(x) ? "b" : ""}" style="height:${Math.max(3, Math.round((m.h[x] / max) * 100))}%"><em>${x % 3 === 0 || r.best.includes(x) ? x : ""}</em></i>`).join("")}</div>
        <div class="cc-li muted">每天的小目标：${g.target} 件（最近每天一般完成 ${this.fmt(g.cap)} 件，只比它高一点点）</div>
        ${m.sus ? `<div class="cc-li muted">🧐 最近有 ${m.sus} 次一口气勾了好几件、或者勾了又马上取消，这些只算了一部分。做完一件勾一件，记录才准。</div>` : ""}` : `<p class="muted">捞捞教练还没打开。</p>`}
        ${window.FlowUI ? `<button class="cc-more" data-cc="book">🎁 捞捞的收藏 ${CoachCore.owned(CoachCore.mergeBag(this.bag(), [], now))}/${CoachCore.LOOT.length} ›</button>` : ""}
        <div class="cc-sub">设置</div>
        <label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" data-cco="coach"${on ? " checked" : ""}> 打开捞捞教练</label>
        <label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" data-cco="coach_notify"${this.opt("notify", true) ? " checked" : ""}> 到合适的时候用系统通知提醒（一天最多 3 条，23 点到 7 点不打扰）</label>
        <label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" data-cco="coach_lao"${this.opt("lao", true) ? " checked" : ""}> 让捞捞说教练的话</label>
        <div class="cc-sub">数据怎么用</div>
        <div class="cc-li muted">🔒 几点完成了哪件事这些原始记录只存在这台电脑，最多保留 60 天，不上传。<br>☁ 跟着账号同步的只有统计数字（每个钟点的活跃度、每天完成几件、哪种提醒有用），没有标题和内容。<br>👥 「刷任务」时班里只能看到有几个人在专注、全班专注了多少分钟，看不到是谁、在做什么。<br>🧠 所有计算都在这台电脑上完成，不用大模型，不发给任何第三方。</div>
      </div>
      <div class="dfoot"><button type="button" class="btn danger" data-a="clear">清空学到的数据</button><span class="grow"></span><button type="button" class="btn primary" data-a="close">好的</button></div></div>`);
    d.onchange = async (e) => { const k = e.target.dataset.cco; if (!k) return; await call("settings", { [k]: e.target.checked, coach_asked: true }); this.logAt = 0; this.plan(true); this.render(); };
    d.onclick = async (e) => {
      const a = e.target.closest("[data-a]"); if (!a) return;
      if (a.dataset.a === "close") closeOverlay();
      if (a.dataset.a === "clear" && await confirmBox("清空学到的数据？", "这台电脑的记录和云端的统计数字都会清掉，捞捞教练从头开始学。", "清空", true)) {
        await call("coach:clear"); const all = KV("coach_v1") || {}; for (const k in all) kvSet("coach_v1", k, { v: 0 }); this.log = []; this.lastSync = ""; toast("已清空"); closeOverlay(); this.render();
      }
    };
    openOverlay(d);
  },

  // ---------- 系统通知：今天挑合适的时间（到点再确认一次） ----------
  async plan(force) {
    if (!force && Date.now() - this.planAt < 30 * 60000) return;
    this.planAt = Date.now();
    this.timers.forEach(clearTimeout); this.timers = [];
    if (!this.on() || !this.opt("notify", true)) return;
    await this.refreshLog(true);
    const { c, ranked } = this.ranked();
    const list = CoachCore.nudges({ now: c.now, ranked, model: this.model(), courses: c.courses });
    list.forEach((n) => {
      const wait = n.at - Date.now(); if (wait <= 0 || wait > 20 * 3600000) return;
      this.timers.push(setTimeout(async () => {
        if (!this.on() || !this.opt("notify", true)) return;
        await this.refreshLog(true);
        const m = this.model(), now = App.now();
        if (n.kind === "streak" && CoachCore.streak(m, now).today >= 1) return;     // 已经做到了就不打扰
        let body = n.body;
        if (n.kind === "best") { const s = this.current(); if (s.mode !== "go" || s.goal.met) return; body = s.say; }
        try { const no = new Notification(n.title, { body, silent: false }); no.onclick = () => { call("open:main").catch(() => {}); if (n.kind === "weekly") this.open(); }; } catch (e) {}
      }, wait));
    });
  },

  // ---------- 捞捞偶尔说一句 ----------
  laoTick() {
    try {
      if (!this.on() || !this.opt("lao", true) || DIsland.state === "open" || document.hidden) return;
      const s = this.current(), hh = new Date().getHours();
      if (["go", "rest", "sleep"].includes(s.mode) && DIsland.once("coach|" + (s.top ? s.top.key : s.mode) + "|" + Math.floor(hh / 3))) DIsland.say("🧭 " + s.say, "最急的是什么");
    } catch (e) {}
  },
};
document.addEventListener("click", (e) => { if (e.target.closest("[data-cc]")) Coach59.onClick(e); });
setInterval(() => Coach59.plan(), 30 * 60000);
setInterval(() => Coach59.laoTick(), 5 * 60000);
// 3.3.4 刷任务 · 随机掉落 · 班级同步自习（界面和网页共用 flow-ui.js）
if (window.FlowUI) FlowUI.init({
  ctx() { const { c, ranked } = Coach59.ranked(); return { now: c.now, ranked, skip: Coach59.skips() }; },
  record(ev) { call("coach:rec", ev).then(() => (Coach59.logAt = 0)).catch(() => {}); },
  bag: () => Coach59.bag(),
  saveBag(b) { try { localStorage.setItem(CoachCore.BAG, JSON.stringify(b)); } catch (e) {} try { Coach59.model(); } catch (e) {} },
  otherBags() { const all = KV("coach_v1") || {}, dev = App.S.dev || "desktop"; return Object.keys(all).filter((k) => k !== dev).map((k) => all[k] && all[k].bag).filter(Boolean); },
  rpc: (n, a) => api(n, a, true),
  cid: () => (App.S && App.S.loggedIn && App.S.cid) || null,
  done: (k) => toggleDone(k, true),
  skip: (k) => Coach59.skip(k),
  wear: (e) => Coach59.wear(e),
  toast: (m) => toast(m),
  after: () => Coach59.render(),
});
setTimeout(() => Coach59.plan(true), 6000);
