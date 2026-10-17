/* 5.9.3 捞捞教练（网页）：规则在 coach-core.js（和小程序、电脑版、安卓 App 同一套）。
 *   · 要用户自己点「开启」才开始记录；原始记录只存在这台设备（coach_log_v1，60 天），同步到账号的只有统计数字（coach_v1）
 *   · 首页「今日教练」卡片、捞捞偶尔说一句、「我的 → 捞捞教练」里看每周复盘、你的节奏、设置
 *   放在 app.js、island.js 后面加载 */
(function () {
  "use strict";
  if (typeof CoachCore === "undefined") return;
  const C = CoachCore, LS_LOG = C.LOG, LS_SYNC = C.SYNC, LS_OPTS = C.OPTS, LS_SKIP = "coach_skip_v1", LS_SHOWN = "coach_shown_v1";
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const opts = () => ({ on: false, asked: false, lao: true, ...rd(LS_OPTS, {}) });
  const setOpt = (k, v) => { const o = opts(); o[k] = v; wr(LS_OPTS, o); };
  const on = () => opts().on === true;
  const dev = () => (typeof devId === "function" ? devId() : "web");
  let dirty = true, cache = null;

  function record(ev) {
    if (!on()) return;
    wr(LS_LOG, C.append(rd(LS_LOG, []), ev, Date.now()));
    dirty = true;
  }
  function model() {
    const now = new Date(typeof ccNow === "function" ? ccNow() : Date.now());
    if (dirty || !cache) {
      cache = C.learn(rd(LS_LOG, []), now);
      const all = (typeof load === "function" ? load(LS_SYNC, {}) : rd(LS_SYNC, {})) || {};
      all[dev()] = cache;
      if (typeof save === "function") save(LS_SYNC, all); else wr(LS_SYNC, all);     // 只有统计数字跟着账号同步
      dirty = false;
    }
    const all = (typeof load === "function" ? load(LS_SYNC, {}) : rd(LS_SYNC, {})) || {};
    const others = Object.keys(all).filter((k) => k !== dev()).map((k) => all[k]).filter((m) => m && m.v === 1 && now - (m.at || 0) < 90 * 86400000);
    return C.combine([cache].concat(others));
  }
  function skips() { const o = rd(LS_SKIP, {}), now = Date.now(); for (const k in o) if (o[k] < now) delete o[k]; return o; }
  function skip(k) { const o = skips(); o[k] = Date.now() + 2 * 3600000; wr(LS_SKIP, o); }
  function current() {
    const ctx = islandCtx(), ranked = IslandCore.rank(ctx.items, ctx.courses, ctx.now);
    return C.suggest({ now: ctx.now, ranked, model: model(), log: rd(LS_LOG, []), skip: skips() });
  }
  function shown(key, style) {
    if (!style) return;
    const o = rd(LS_SHOWN, {}), k = key + "|" + style, now = Date.now();
    if (now - (o[k] || 0) < 3 * 3600000) return;
    for (const x in o) if (now - o[x] > 86400000) delete o[x];
    o[k] = now; wr(LS_SHOWN, o);
    record({ t: now, e: "show", k: key, s: style });
  }
  const accept = (key, style) => style && record({ t: Date.now(), e: "acc", k: key, s: style });
  const fmt = (x) => String(Math.round(x * 10) / 10);

  // ---------- 记录：完成 / 取消、番茄钟、打卡（包一层原来的函数，不改它们） ----------
  if (typeof logDone === "function") {
    const old = logDone;
    logDone = function (k, isOn) {
      old.apply(this, arguments);
      try {
        const r = typeof allItems === "function" ? allItems().find((x) => x._key === k) : null;
        let due = 0;
        if (r && r._p) { const d = new Date(r._p.day + "T00:00:00"); if (r._p.time) { const p = r._p.time.split(":"); d.setHours(+p[0], +p[1]); } else d.setHours(23, 59); due = d.getTime(); }
        record({ t: Date.now(), e: isOn ? "done" : "undo", k, y: r ? (r._mine ? (r.kind === "作业" ? "作业" : "个人") : r.msg_type) : "", d: due });
        setTimeout(renderCoach, 50);
      } catch (e) {}
    };
  }
  if (typeof savePomo === "function") {
    let last = typeof pomo !== "undefined" ? pomo.mode : "";
    const old = savePomo;
    savePomo = function () {
      try { if (last === "focus" && pomo.mode === "break") record({ t: Date.now(), e: "pomo", k: pomo.task || "", m: pomo.len || 25 }); last = pomo.mode; } catch (e) {}
      return old.apply(this, arguments);
    };
  }
  if (typeof toggleHabit === "function") {
    const old = toggleHabit;
    toggleHabit = function (id) {
      old.apply(this, arguments);
      try { const t = todayKey(); if (habitLog[id] && habitLog[id][t]) record({ t: Date.now(), e: "habit", k: id }); } catch (e) {}
    };
  }

  // ---------- 首页「今日教练」卡片 ----------
  function renderCoach() {
    const box = document.getElementById("coachCard"); if (!box) return;
    if (!currentUser) { box.innerHTML = ""; return; }
    const o = opts();
    if (!o.on) {
      box.innerHTML = o.asked ? "" : `<div class="cc-card cc-ask">
        <b>🧭 要不要试试捞捞教练？</b>
        <p>开启后，捞捞会在这台设备上记下你几点完成了事、专注了多久，慢慢学会你的节奏：推荐现在最适合做的事、定一个够得着的小目标、每周给你复盘。原始记录只存在本机；同步到账号的只有统计数字，没有标题和内容。随时可以关掉、清空。</p>
        <div class="cc-btns"><button class="btn" data-cc="on">开启</button><button class="small" data-cc="no">不用了</button></div></div>`;
      return;
    }
    let s; try { s = current(); } catch (e) { console.error(e); box.innerHTML = ""; return; }
    const top = s.top, pct = Math.min(100, Math.round((s.goal.done / Math.max(1, s.goal.target)) * 100));
    if (top && top.kind !== "course") shown(top.key, s.style);
    box.innerHTML = `<div class="cc-card">
      <div class="cc-h"><span class="cc-k">🧭 今日教练</span>
        ${s.streak.days ? `<span class="cc-chip ${s.streak.atRisk ? "risk" : "fire"}">🔥 ${s.streak.days} 天</span>` : ""}
        <span class="cc-chip ${s.goal.met ? "ok" : ""}">${s.goal.met ? "今日目标 ✓" : `今日 ${fmt(s.goal.done)}/${s.goal.target}`}</span></div>
      <div class="cc-bar"><i style="width:${pct}%" class="${s.goal.met ? "ok" : ""}"></i></div>
      <div class="cc-say">${esc(s.say)}</div>
      ${top && top.kind !== "course" ? `<div class="cc-top"><b>${esc(top.title)}</b><small>${esc([top.reason, top.step].filter(Boolean).join(" · "))}</small></div>
        <div class="cc-btns"><button class="btn ink" data-cc="start" data-k="${esc(top.key)}" data-s="${esc(s.style || "")}" data-t="${esc(top.kind === "pomo" ? "" : top.title)}">▶ 开始 25 分钟</button>
          ${top.kind === "item" ? `<button class="small" data-cc="done" data-k="${esc(top.key)}" data-s="${esc(s.style || "")}">✓ 做完了</button><button class="small ghost" data-cc="skip" data-k="${esc(top.key)}">换一个</button>` : ""}</div>`
        : s.mode === "sleep" ? `<div class="cc-note">🌙 明天的事明天再说</div>` : s.mode === "rest" ? `<div class="cc-note">🍵 休息也是计划的一部分</div>` : ""}
      <button class="cc-more" data-cc="open">📊 本周复盘 · 你的节奏 ›</button></div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cc]"); if (!b) return;
    const a = b.dataset.cc, k = b.dataset.k, st = b.dataset.s;
    if (a === "on") { setOpt("asked", true); setOpt("on", true); renderCoach(); }
    else if (a === "no") { setOpt("asked", true); renderCoach(); }
    else if (a === "start") {
      accept(k, st);
      try { showView("plan"); if ($("pTask") && b.dataset.t) $("pTask").value = b.dataset.t; if (pomo.mode === "idle") $("pStart").click(); setTimeout(() => $("pomoSec") && $("pomoSec").scrollIntoView({ behavior: "smooth", block: "start" }), 120); } catch (err) {}
    } else if (a === "done") {
      accept(k, st);
      const btn = document.querySelector(`.chk[data-act="done"][data-k="${CSS.escape(k)}"]`);
      if (btn) btn.click(); else renderCoach();
    } else if (a === "skip") { skip(k); renderCoach(); }
    else if (a === "open") openCoach();
  });

  // ---------- 教练页（弹窗）：每周复盘、你的节奏、设置 ----------
  function openCoach() {
    let d = document.getElementById("coachDlg");
    if (!d) { d = document.createElement("dialog"); d.id = "coachDlg"; d.className = "dlg cc-dlg"; document.body.appendChild(d); d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-ccx]")) d.close(); }); }
    paint(d);
    if (!d.open) d.showModal();
  }
  function paint(d) {
    const o = opts(), m = model(), now = new Date(typeof ccNow === "function" ? ccNow() : Date.now()), r = C.weekly(m, now), g = C.goal(m, now);
    const hours = []; for (let i = 7; i <= 23; i++) hours.push(i);
    const max = Math.max(0.0001, ...hours.map((i) => m.h[i]));
    d.innerHTML = `<div class="cc-dlgb">
      <h3>🧭 捞捞教练 <button class="small" data-ccx style="float:right">关闭</button></h3>
      <p class="meta">在这台设备上学你的节奏：几点状态最好、作业习惯提前还是拖到最后、哪种提醒对你有用。</p>
      ${o.on ? `<div class="cc-stats"><div><b>${fmt(r.thisWeek.done)}</b><small>这周完成</small></div><div><b>${fmt(r.lastWeek.done)}</b><small>上周</small></div><div><b>${r.streak}</b><small>连续天数</small></div></div>
      ${r.highlights.map((x) => `<div class="cc-li">✨ ${esc(x)}</div>`).join("")}
      ${r.next.length ? `<div class="cc-sub">下周可以试试</div>${r.next.map((x) => `<div class="cc-li">· ${esc(x)}</div>`).join("")}` : ""}
      <div class="cc-sub">你的节奏 <small>${r.best.length ? "状态最好：" + r.best.map((h) => h + ":00").join("、") : "再用几天就能看出来"}</small></div>
      <div class="cc-bars">${hours.map((h) => `<i class="${r.best.includes(h) ? "b" : ""}" style="height:${Math.max(3, Math.round((m.h[h] / max) * 100))}%" title="${h}:00"><em>${h % 3 === 0 || r.best.includes(h) ? h : ""}</em></i>`).join("")}</div>
      <div class="cc-li meta">每天的小目标：${g.target} 件（最近每天一般完成 ${fmt(g.cap)} 件，只比它高一点点）</div>
      ${m.sus ? `<div class="cc-li meta">🧐 最近有 ${m.sus} 次一口气勾了好几件、或者勾了又马上取消，这些只算了一部分。做完一件勾一件，记录才准。</div>` : ""}` : `<p>捞捞教练还没打开。</p>`}
      <div class="cc-sub">设置</div>
      <label class="gi"><span class="ic">🧭</span>打开捞捞教练<input type="checkbox" class="switch" data-cco="on" ${o.on ? "checked" : ""}></label>
      <label class="gi"><span class="ic">💬</span>让捞捞说教练的话<input type="checkbox" class="switch" data-cco="lao" ${o.lao ? "checked" : ""}></label>
      <div class="cc-sub">数据怎么用</div>
      <div class="cc-li meta">🔒 几点完成了哪件事这些原始记录只存在这台设备，最多保留 60 天，不上传。<br>☁ 跟着账号同步的只有统计数字（每个钟点的活跃度、每天完成几件、哪种提醒有用），没有标题和内容。<br>🧠 所有计算都在你的设备上完成，不用大模型，不发给任何第三方。</div>
      <button class="small" data-ccclear style="color:var(--red);margin-top:8px">清空学到的数据</button></div>`;
    d.onchange = (e) => { const k = e.target.dataset.cco; if (!k) return; setOpt("asked", true); setOpt(k, e.target.checked); paint(d); renderCoach(); };
    const cl = d.querySelector("[data-ccclear]");
    if (cl) cl.onclick = () => {
      if (!confirm("清空捞捞教练学到的数据？这台设备的记录和云端的统计数字都会清掉，从头开始学。")) return;
      wr(LS_LOG, []); wr(LS_SKIP, {}); const all = (typeof load === "function" ? load(LS_SYNC, {}) : {}) || {}; for (const k in all) all[k] = { v: 0 }; if (typeof save === "function") save(LS_SYNC, all);
      dirty = true; cache = null; paint(d); renderCoach();
    };
  }

  // ---------- 捞捞偶尔说一句（同一件事 3 小时内只说一次） ----------
  setInterval(() => {
    try {
      if (!on() || !opts().lao || document.hidden || typeof laoSay !== "function" || typeof laoOnce !== "function") return;
      if (typeof islandState !== "undefined" && islandState === "open") return;
      const s = current(), h = new Date().getHours();
      if (["go", "rest", "sleep"].includes(s.mode) && laoOnce("coach|" + (s.top ? s.top.key : s.mode) + "|" + Math.floor(h / 3))) laoSay("🧭 " + s.say, { q: "最急的是什么" });
    } catch (e) {}
  }, 5 * 60000);

  // 首页每次重画时跟着画；每分钟刷新一次
  if (typeof renderAgenda === "function") { const old = renderAgenda; renderAgenda = function () { const r = old.apply(this, arguments); try { renderCoach(); } catch (e) {} return r; }; }
  setInterval(() => { if (!document.hidden && typeof currentView === "function" && currentView() === "home") renderCoach(); }, 60000);
  window.CoachUI = { open: openCoach, render: renderCoach, record };
  setTimeout(renderCoach, 300);
})();
