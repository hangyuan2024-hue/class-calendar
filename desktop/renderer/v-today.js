// 今日总览：问候、一句话记事、今天的课（时间线）、待办、统计、专注、班级墙
"use strict";
App.views.today = {
  title: "今日", icon: "today",
  count() { const now = App.now(), t = M.dayKey(now); const n = App.items().filter((x) => !x.done && !x.hidden && x.day && (x.day === t || overdue(x, now))).length; return { n, hot: App.items().some((x) => !x.hidden && overdue(x, now) && x.type === "作业") }; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1 id="tdHello"></h1><div class="sub" id="tdSub"></div></div><span class="grow"></span>
        <button class="btn" id="tdMini" title="桌面上一直显示今天的课和待办">${icon("mini")}桌面小窗</button>
        <button class="btn primary" id="tdNew">${icon("plus")}记一件事</button></div>
      <div class="vbody">
        <div class="qa card"><span class="qa-i">✍️</span><input id="tdQuick" placeholder="一句话记事：明天下午3点交实验报告 @B302　　按 Enter 记下" spellcheck="false"><span class="qa-p" id="tdParse"></span></div>
        <div class="td-grid">
          <div class="card td-courses"><div class="card-h">今天的课<span class="grow"></span><small id="tdWeekNo"></small><button class="btn ghost sm" data-go="week">整周 →</button></div><div id="tdCourses"></div></div>
          <div class="card td-todo"><div class="card-h">要做的事<span class="grow"></span><button class="btn ghost sm" data-go="tasks">全部 →</button></div><div id="tdTodo" class="todo-list"></div></div>
          <div class="td-side">
            <div class="stats" id="tdStats"></div>
            <div class="card td-pomo" id="tdPomo"></div>
            <div class="card"><div class="card-h">这一周<span class="grow"></span><button class="btn ghost sm" data-go="month">月历 →</button></div><div id="tdWeek" class="wk-strip"></div></div>
            <div class="card"><div class="card-h">班级墙<span class="grow"></span><button class="btn ghost sm" data-go="wall">更多 →</button></div><div id="tdWall"></div></div>
          </div>
        </div>
      </div>`;
    el.onclick = (e) => { const g = e.target.closest("[data-go]"); if (g) App.go(g.dataset.go); };
    $("#tdNew", el).onclick = () => editItem(null);
    $("#tdMini", el).onclick = () => call("mini:toggle");
    const q = $("#tdQuick", el), pv = $("#tdParse", el);
    q.oninput = () => {
      const p = P.parse(q.value, App.now());
      pv.innerHTML = q.value.trim() ? [p.date && `<span>📅 ${esc(M.relDay(p.date, App.now()))}${p.time ? " " + p.time : ""}</span>`, !p.date && p.time ? `<span>🕒 ${p.time}</span>` : "", p.location && `<span>📍 ${esc(p.location)}</span>`].filter(Boolean).join("") : "";
    };
    q.onkeydown = async (e) => {
      if (e.key === "Escape") { q.value = ""; q.oninput(); q.blur(); }
      if (e.key !== "Enter" || !q.value.trim()) return;
      const rec = await call("quick:add", q.value);
      toast(`已记下：${rec.subject}${rec.event_time ? "（" + whenText({ day: rec.event_time.slice(0, 10), time: rec.event_time.slice(11) }, App.now()) + "）" : ""}`);
      q.value = ""; q.oninput();
    };
    el.addEventListener("click", (e) => {
      const c = e.target.closest(".chk[data-k]"); if (c) { e.stopPropagation(); const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); }
    });
    el.addEventListener("dblclick", (e) => { const r = e.target.closest(".todo[data-k]"); if (r) App.go("tasks", { key: r.dataset.k }); });
    el.addEventListener("contextmenu", (e) => { const r = e.target.closest(".todo[data-k]"); if (r) { const x = App.find(r.dataset.k); if (x) itemMenu(e, x); } });
  },
  update() {
    const S = App.S, now = App.now(), el = this.el, me = S.me || {};
    $("#tdHello", el).textContent = `${greet(now)}，${me.display_name || "同学"}`;
    const wk = M.weekOf(S.courses.meta, now);
    $("#tdSub", el).textContent = [`${now.getMonth() + 1}月${now.getDate()}日 星期${M.WEEK[now.getDay()]}`, wk ? `第 ${wk} 周` : "", App.className()].filter(Boolean).join(" · ");
    $("#tdWeekNo", el).textContent = wk ? `第 ${wk} 周` : "";
    this.tick();
    this.todo(); this.stats(); this.week(); this.wall(); this.pomo(App.pomo);
  },
  tick() { this.courses(); },
  courses() {
    const S = App.S, now = App.now(), el = $("#tdCourses", this.el), nm = now.getHours() * 60 + now.getMinutes();
    const list = M.coursesOn(S.courses, now);
    if (!(S.courses.courses || []).length) { el.innerHTML = `<div class="empty"><b>📚</b>还没有课程表<br><a data-ext="https://www.laolaokechengbiao.cn/app.html">在网站上导入或填写课程表</a>，这里会自动同步</div>`; return; }
    if (!list.length) {
      let nx = null; for (let i = 1; i <= 7 && !nx; i++) { const d = M.addDays(now, i), cs = M.coursesOn(S.courses, d); if (cs.length) nx = { d, c: cs[0], n: cs.length }; }
      el.innerHTML = `<div class="empty"><b>🎈</b>今天没课${nx ? `<br>下次上课：${M.relDay(M.dayKey(nx.d), now)} ${nx.c.tStart} ${esc(nx.c.name)}（那天 ${nx.n} 节）` : ""}</div>`; return;
    }
    const tm = M.coursesOn(S.courses, M.addDays(now, 1));
    const tmHtml = tm.length ? `<div class="tl-tmr"><span>明天</span>${tm.map((c) => `<em style="--c:${c.color}">${c.tStart} ${esc(c.name)}</em>`).join("")}</div>` : "";
    el.innerHTML = `<div class="tl">${list.map((c) => {
      const a = M.toMin(c.tStart), b = M.toMin(c.tEnd), cur = nm >= a && nm < b, past = nm >= b;
      const state = cur ? `<span class="tl-now">正在上 · 还剩 ${untilText(b - nm)}</span>` : !past && a - nm <= 180 ? `<span class="tl-soon">${untilText(a - nm)}后</span>` : "";
      const pct = cur ? Math.round(((nm - a) / (b - a)) * 100) : 0;
      return `<div class="tl-row${cur ? " cur" : ""}${past ? " past" : ""}" style="--c:${c.color}">
        <div class="tl-time"><b>${c.tStart}</b><span>${c.tEnd}</span></div>
        <div class="tl-card"><div class="tl-name">${esc(c.name)}${state}</div><div class="tl-meta">第 ${c.start}${c.end > c.start ? "–" + c.end : ""} 节${c.location ? " · " + icon("place") + esc(c.location) : ""}${c.teacher ? " · " + esc(c.teacher) : ""}</div>${cur ? `<div class="tl-bar"><i style="width:${pct}%"></i></div>` : ""}</div></div>`;
    }).join("")}</div>${tmHtml}`;
  },
  todo() {
    const now = App.now(), t = M.dayKey(now), el = $("#tdTodo", this.el);
    const live = M.sortItems(App.items().filter((x) => !x.hidden));
    const groups = [
      ["过期没完成", live.filter((x) => overdue(x, now) && M.dayDiff(x.day, now) >= -14), "bad"],
      ["今天", live.filter((x) => x.day === t && !overdue(x, now) && !x.done)],
      ["明天", live.filter((x) => x.day && M.dayDiff(x.day, now) === 1 && !x.done)],
      ["接下来一周", live.filter((x) => x.day && M.dayDiff(x.day, now) >= 2 && M.dayDiff(x.day, now) <= 7 && !x.done)],
      ["今天完成的", live.filter((x) => x.done && (App.S.doneLog || {})[x.key] === t), "ok"],
    ];
    const row = (x) => `<div class="todo${x.done ? " done" : ""}" data-k="${esc(x.key)}"><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}" title="${x.done ? "标记为没完成" : "完成"}"></button>${tagHtml(x.type)}<span class="todo-t">${esc(x.title)}</span><span class="todo-w${overdue(x, now) ? " late" : ""}">${esc(x.day === t ? x.time || "今天" : whenText(x, now))}</span></div>`;
    const html = groups.filter((g) => g[1].length).map((g) => `<div class="todo-g ${g[2] || ""}">${g[0]}<span>${g[1].length}</span></div>` + g[1].slice(0, 12).map(row).join("") + (g[1].length > 12 ? `<div class="todo-more" data-go="tasks">还有 ${g[1].length - 12} 件…</div>` : "")).join("");
    el.innerHTML = html || `<div class="empty"><b>🎉</b>最近一周没有要做的事<br>在上面一句话记事，或者按 Ctrl+N</div>`;
  },
  stats() {
    const S = App.S, now = App.now(), t = M.dayKey(now), log = S.doneLog || {}, pomo = S.pomo || {};
    const monday = M.addDays(now, -M.weekday0(now)), mk = M.dayKey(monday);
    const doneToday = Object.values(log).filter((d) => d === t).length;
    const doneWeek = Object.values(log).filter((d) => d >= mk && d <= t).length;
    const days = new Set(Object.values(log).concat(Object.keys(pomo).filter((k) => pomo[k] > 0)));
    let streak = 0; for (let d = days.has(t) ? now : M.addDays(now, -1); days.has(M.dayKey(d)); d = M.addDays(d, -1)) streak++;
    $("#tdStats", this.el).innerHTML = [["今天完成", doneToday, "件"], ["本周完成", doneWeek, "件"], ["今日专注", pomo[t] || 0, "分钟"], ["连续学习", streak, "天"]]
      .map(([a, b, c]) => `<div class="stat"><span>${a}</span><b>${b}<small>${c}</small></b></div>`).join("");
  },
  week() {
    const now = App.now(), monday = M.addDays(now, -M.weekday0(now)), items = App.items().filter((x) => !x.hidden && !x.done);
    $("#tdWeek", this.el).innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = M.addDays(monday, i), k = M.dayKey(d), cs = M.coursesOn(App.S.courses, d).length, its = items.filter((x) => x.day === k), hw = its.filter((x) => x.type === "作业").length;
      return `<div class="wk-d${k === M.dayKey(now) ? " today" : ""}${k < M.dayKey(now) ? " past" : ""}" title="${dateCN(k)}：${cs} 节课，${its.length} 件事"><span>${M.WEEK[d.getDay()]}</span><b>${d.getDate()}</b><i>${cs ? cs + "课" : "–"}</i>${its.length ? `<em class="${hw ? "hw" : ""}">${its.length}</em>` : "<em class='z'></em>"}</div>`;
    }).join("");
  },
  wall() {
    const posts = ((App.S.wall && App.S.wall.posts) || []).filter((p) => !p.hidden).slice().sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0)).slice(0, 3);
    $("#tdWall", this.el).innerHTML = posts.length ? posts.map((p) => `<div class="wl-mini" data-go="wall">${p.pinned_at ? "📌 " : p.is_notice ? "📣 " : ""}<b>${esc(p.author_name || "")}</b>：${esc(p.title ? p.title + " " + p.body : p.body)}</div>`).join("") : `<div class="empty" style="padding:14px">班级墙还没有内容</div>`;
  },
  pomo(p) {
    const el = this.el && $("#tdPomo", this.el); if (!el) return;
    p = p || {};
    if (p.running) {
      const m = Math.floor(p.left / 60), s = p.left % 60;
      el.innerHTML = `<div class="pm-mini on" data-go="focus"><span class="pm-dot"></span><div><b>${p.phase === "focus" ? "专注中" : "休息中"}${p.task ? " · " + esc(p.task) : ""}</b><span class="mono">${M.pad(m)}:${M.pad(s)}</span></div></div>`;
    } else el.innerHTML = `<div class="pm-mini"><span>🍅</span><div><b>专注一会儿</b><span>${App.S.settings.pomoFocus} 分钟，到点提醒你休息</span></div><button class="btn sm primary" id="tdPomoGo">开始</button></div>`;
    const b = $("#tdPomoGo", el); if (b) b.onclick = (e) => { e.stopPropagation(); call("pomo:start", App.S.settings.pomoFocus, ""); };
  },
  keys(e, typing) { if (!typing && e.key === "/") { $("#tdQuick", this.el).focus(); return true; } },
};
