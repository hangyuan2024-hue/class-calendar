// 今日：问候 + 课铃时间带（接下来最该关注的一件、今天的课和有时间点的事排在一条时间轴上）+ 一句话记事 + 要做的事 + 右边一列小东西
"use strict";
const hm2m = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
const atOf = (day, t) => { const m = hm2m(t); if (m == null || !day) return 0; const d = M.fromKey(day); d.setMinutes(m); return d.getTime(); };
function leftLabel(ms) {
  if (ms <= 0) return ["就是现在", ""];
  const m = Math.ceil(ms / 60000);
  if (m < 60) return [String(m), "分钟后"];
  if (m < 24 * 60) { const h = Math.floor(m / 60), r = m % 60; return [h + (r ? `:${M.pad(r)}` : ""), r ? "小时后" : "小时后"]; }
  return [String(Math.round(m / 1440)), "天后"];
}
function islandCtx() { return DIsland.ctx(); }
// 3.3.3 会议、活动这类到点开始的事：一天之内显示「还有多久开始 / 进行中」（规则在 island-core.js，和网页、小程序、App 一样）
function startTag(x, now) {
  if (!x || x.done || x.type === "作业" || !x.time || !x.day || typeof IslandCore === "undefined" || !IslandCore.startInfo) return "";
  const si = IslandCore.startInfo({ type: x.type, day: x.day, time: x.time }, now);
  if (!si || si.st === "past" || (si.mins != null && si.mins > 24 * 60)) return "";
  return `<span class="td-st st-${si.st}">${esc(si.text)}</span>`;
}

App.views.today = {
  title: "首页", icon: "today",
  count() { const now = App.now(), t = M.dayKey(now); const n = App.items().filter((x) => !x.done && !x.hidden && x.day && (x.day === t || overdue(x, now))).length; return { n, hot: App.items().some((x) => !x.hidden && overdue(x, now) && x.type === "作业") }; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead td-head"><div><h1 id="tdHello"></h1><div class="sub" id="tdSub"></div></div><span class="grow"></span>
        <button class="btn" id="tdMini" title="桌面上一直显示今天的课和待办">${icon("mini")}桌面小窗</button>
        <button class="btn primary" id="tdNew">${icon("plus")}记一件事</button></div>
      <div class="vbody td-body">
        <section class="td-band" id="tdBand"></section>
        <div id="tdCoach"></div>
        <div class="td-quick"><span>✍️</span><input id="tdQuick" placeholder="一句话记事：明天下午3点交实验报告 @B302　按 Enter 记下，按 / 随时回到这里" spellcheck="false"><span class="td-qp" id="tdParse"></span></div>
        <div class="td-cols">
          <section class="td-main">
            <div class="sec"><b>要做的事</b><small id="tdTodoN"></small><span class="grow"></span><button class="btn ghost sm" data-go="homework">作业</button><button class="btn ghost sm" data-go="tasks">全部事项</button></div>
            <div id="tdTodo" class="td-todo"></div>
          </section>
          <aside class="td-aside">
            <div class="td-stats" id="tdStats"></div>
            <div id="tdHb" class="td-plate hidden"></div>
            <div id="tdCd"></div>
            <div class="td-plate td-pomo" id="tdPomo"></div>
            <div class="td-plate"><div class="sec"><b>这一周</b><span class="grow"></span><button class="btn ghost sm" data-go="month">日历</button></div><div id="tdWeek" class="td-week"></div></div>
            <div class="td-plate td-enc" id="tdEnc"></div>
            <div class="td-plate"><div class="sec"><b>班级墙</b><span class="grow"></span><button class="btn ghost sm" data-go="wall">更多</button></div><div id="tdWall"></div></div>
          </aside>
        </div>
      </div>`;
    el.onclick = async (e) => {
      const g = e.target.closest("[data-go]"); if (g) return App.go(g.dataset.go);
      if (e.target.closest("[data-enc-next]")) { this.shift = (this.shift || 0) + 1; return this.enc(); }
      const md = e.target.closest("[data-mood]"); if (md) { const t = todayKey(), cur = (KV("mood_log_v1") || {})[t]; kvSet("mood_log_v1", t, cur === md.dataset.mood ? null : md.dataset.mood); return; }
      if (e.target.closest("[data-mood-redo]")) { kvSet("mood_log_v1", todayKey(), null); return; }
      const hb = e.target.closest("[data-hb]"); if (hb) { const on = await call("habit", hb.dataset.hb); if (on) cheer("habit"); return; }
      if (e.target.closest("[data-cd]")) return App.go("countdown");
      if (e.target.closest("[data-nx=pomo]")) return call("pomo:start", App.S.settings.pomoFocus, "");
      const c = e.target.closest(".chk[data-k]"); if (c) { e.stopPropagation(); const x = App.find(c.dataset.k); if (x) toggleDone(x.key, !x.done); return; }
      const seg = e.target.closest(".tb-c[data-day]"); if (seg) return App.go("week");
      const r = e.target.closest("[data-k]"); if (r) Insp.open(r.dataset.k);
    };
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
    el.addEventListener("dblclick", (e) => { const r = e.target.closest(".td-row[data-k]"); if (r) { const x = App.find(r.dataset.k); if (x && x.mine) editItem(x); } });
    el.addEventListener("contextmenu", (e) => { const r = e.target.closest("[data-k]"); if (r) { const x = App.find(r.dataset.k); if (x) itemMenu(e, x); } });
  },
  update() {
    const S = App.S, now = App.now(), el = this.el, me = S.me || {};
    $("#tdHello", el).textContent = `${greet(now)}，${me.display_name || "同学"}`;
    const wk = M.weekOf(S.courses.meta, now), note = M.dayNote(S.courses, M.dayKey(now));
    $("#tdSub", el).innerHTML = [`${now.getMonth() + 1}月${now.getDate()}日 星期${M.WEEK[now.getDay()]}`, wk >= 1 && wk <= M.MAX_WEEK ? `第 ${wk} 周` : "", esc(App.className()), note ? `<span class="td-adj">🔁 ${esc(note)}</span>` : ""].filter(Boolean).join("　");
    this.band(); this.todo(); this.stats(); this.week(); this.wall(); this.pomo(App.pomo); this.enc(); this.cd(); this.habits();
    if (typeof Coach59 !== "undefined") Coach59.render();     // 3.3.3 捞捞教练
  },
  tick() { this.band(); },

  // ---------- 课铃时间带 ----------
  band() {
    const box = $("#tdBand", this.el); if (!box) return;
    let ctx = null; try { ctx = islandCtx(); } catch (e) { return; }
    // 内容没变就不重画（重画会让鼠标下面的东西闪一下、点击丢掉）
    const html = this.nextHtml(ctx) + this.lineHtml(ctx);
    if (html !== this._bandHtml || !box.firstChild) { box.innerHTML = html; this._bandHtml = html; }
    this.layout();
    if (!this._ro && window.ResizeObserver) { this._ro = new ResizeObserver(() => this.layout()); this._ro.observe(box); }
  },
  // 按时间轴的真实宽度摆放：事的小卡片错开成几行（最多 4 行，靠右的往左展开），时间刻度挤不下的隐藏
  layout() {
    const tr = $("#tdBand .tb-track", this.el); if (!tr || !tr.clientWidth) return;
    const W = tr.clientWidth, rows = [], gap = 6;
    let more = 0;
    for (const b of $$(".tb-p", tr)) {
      b.hidden = false; b.classList.remove("r"); b.style.setProperty("--row", 0);
      const x = (parseFloat(b.style.left) || 0) / 100 * W, w = Math.min(b.offsetWidth, W * 0.62);
      const right = x + w > W - 4, iv = right ? [x - w, x] : [x, x + w];
      let r = rows.findIndex((row) => row.every(([s0, e0]) => iv[1] + gap <= s0 || iv[0] >= e0 + gap));
      if (r < 0) { if (rows.length < 4) { r = rows.length; rows.push([]); } else { b.hidden = true; more++; continue; } }
      rows[r].push(iv); b.classList.toggle("r", right); b.style.setProperty("--row", r);
    }
    tr.style.setProperty("--rows", Math.max(1, rows.length));
    const mb = $(".tb-more", tr); if (mb) { mb.hidden = !more; mb.textContent = `还有 ${more} 件 ›`; }
    // 刻度：「现在」优先，其余从左到右，和已经放下的重叠就隐藏
    const tk = $("#tdBand .tb-ticks", this.el); if (!tk) return;
    const labs = $$("i", tk); labs.forEach((i) => (i.style.visibility = ""));
    const kept = [], order = labs.filter((i) => i.classList.contains("now")).concat(labs.filter((i) => !i.classList.contains("now")));
    for (const i of order) {
      const r = i.getBoundingClientRect();
      if (kept.some((k) => r.left < k.right + 6 && r.right > k.left - 6)) i.style.visibility = "hidden"; else kept.push(r);
    }
  },
  nextCourse(ctx) {
    const now = ctx.now, nm = now.getHours() * 60 + now.getMinutes(), t = M.dayKey(now);
    const c = ctx.courses.filter((x) => hm2m(x.t0) != null && hm2m(x.t0) > nm).sort((a, b) => hm2m(a.t0) - hm2m(b.t0))[0];
    if (c) return { c, day: t };
    const tm = shiftDay(t, 1), c2 = ctx.coursesOn(tm).filter((x) => hm2m(x.t0) != null).sort((a, b) => hm2m(a.t0) - hm2m(b.t0))[0];
    return c2 ? { c: c2, day: tm } : null;
  },
  // 左边：接下来最该关注的一件（和捞捞、网页版同一套智能排序）
  nextHtml(ctx) {
    const list = IslandCore.rank(ctx.items, ctx.courses, ctx.now).filter((x) => x.level !== "past");
    const top = list[0], h = ctx.now.getHours(), night = h >= 23 || h < 5, nowMs = App.now().getTime();
    const cd = (at, live) => { const [n, u] = leftLabel(at - nowMs); return `<div class="tn-cd"><b class="num">${esc(live ? n : n)}</b><span>${live ? (u ? u.replace("后", "") + "后下课" : "") : u}</span></div>`; };
    const far = top && top.kind !== "course" && top.level === "normal";
    if (!top || (far && this.nextCourse(ctx))) {
      const nc = this.nextCourse(ctx);
      if (nc) {
        const at = atOf(nc.day, nc.c.t0), isTm = nc.day !== M.dayKey(ctx.now), early = night || (isTm && h >= 21);
        return `<div class="tn${early ? " sleep" : ""}" style="--c:${nc.c.color}"><span class="tn-k">${early ? "早点睡" : "下一节"}</span>
          <div class="tn-t"><b>${esc(nc.c.name)}</b><small>${isTm ? "明天 " : ""}${esc(nc.c.t0)}${nc.c.location ? " · " + esc(nc.c.location) : ""}${nc.c.teacher ? " · " + esc(nc.c.teacher) : ""}</small></div>${cd(at)}</div>`;
      }
      if (night) return `<div class="tn sleep"><span class="tn-k">早点睡</span><div class="tn-t"><b>明天没有要赶的事</b><small>睡饱了脑子才转得快</small></div></div>`;
      return `<div class="tn idle"><span class="tn-k">空闲</span><div class="tn-t"><b>手头没有要赶的事</b><small>来一个番茄专注一下？</small></div><button class="btn primary sm" data-nx="pomo">🍅 开始专注</button></div>`;
    }
    const isCourse = top.kind === "course", live = top.level === "now";
    const c = isCourse ? (ctx.courses.find((x) => "course:" + x.name + x.t0 === top.key) || {}) : null;
    const at = isCourse ? atOf(top.day, live ? c.t1 || top.time : top.time) : atOf(top.day, top.time);
    const hot = top.level === "late" || top.level === "urgent" || live;
    const sleep = night && !hot && !(top.mins != null && top.mins < 6 * 60);
    const label = sleep ? "早点睡" : isCourse ? (live ? "正在上" : "下一节") : live ? "进行中" : top.level === "late" ? "过期了" : top.exam ? "考试" : top.type === "作业" ? "先做这个" : "接下来";
    const sub = [top.time || (top.day ? IslandCore.dayName(top.day, ctx.now) : ""), top.location ? "📍 " + top.location : ""].filter(Boolean).join(" · ");
    return `<div class="tn${hot ? " hot" : sleep ? " sleep" : ""}${isCourse ? " course" : ""}"${c && c.color ? ` style="--c:${c.color}"` : ""}${isCourse ? "" : ` data-k="${esc(top.key)}"`}>
      <span class="tn-k">${label}</span>
      <div class="tn-t"><b>${esc(top.title)}</b><small>${esc(sub)}</small></div>
      ${at && at > nowMs ? cd(at, live) : `<div class="tn-cd"><span>${esc(top.reason || "")}</span></div>`}
      ${isCourse ? "" : `<button class="chk" data-k="${esc(top.key)}" title="标记完成"></button>`}</div>`;
  },
  // 右边：一天的时间轴，课是色块，有时间点的事是小旗，竖线是现在；晚上 9 点后今天没事了就看明天
  lineHtml(ctx) {
    const now = ctx.now, t = M.dayKey(now), nm = now.getHours() * 60 + now.getMinutes();
    const itemsOn = (k) => ctx.items.filter((x) => x.day === k && !x.done && hm2m(x.time) != null);
    const lastToday = Math.max(-1, ...ctx.courses.map((c) => hm2m(c.t1 || c.t0) || 0), ...itemsOn(t).map((x) => hm2m(x.time)));
    const tomorrow = nm >= 21 * 60 && lastToday <= nm;
    const day = tomorrow ? shiftDay(t, 1) : t;
    const courses = (tomorrow ? ctx.coursesOn(day) : ctx.courses).filter((c) => hm2m(c.t0) != null);
    const items = itemsOn(day);
    const pts = [...courses.flatMap((c) => [hm2m(c.t0), hm2m(c.t1 || c.t0)]), ...items.map((x) => hm2m(x.time))];
    const a = Math.min(8 * 60, ...pts.map((m) => Math.floor(m / 60) * 60)), z = Math.max(22 * 60, ...pts.map((m) => Math.ceil(m / 60) * 60));
    const pct = (m) => ((Math.max(a, Math.min(z, m)) - a) / (z - a) * 100).toFixed(2);
    const live = !tomorrow;
    // 上面一条是课（色块），下面是有时间点的事（小卡片：时间 + 名字）。挨得近的事自动错开放到下一行，靠右的往左展开，不会被切掉
    const segs = courses.map((c) => {
      const s = hm2m(c.t0), e = hm2m(c.t1 || "") ?? s + 45, past = live && e <= nm, on = live && s <= nm && nm < e;
      return `<div class="tb-c${past ? " past" : ""}${on ? " on" : ""}" data-day="${day}" style="--c:${c.color};left:${pct(s)}%;width:${(pct(e) - pct(s)).toFixed(2)}%" title="${esc(c.t0 + "–" + (c.t1 || "") + " " + c.name + (c.location ? " · " + c.location : ""))}">
        <b>${esc(c.name)}</b><small>${esc(c.t0)}${c.location ? " · " + esc(c.location) : ""}</small>${on ? `<i style="width:${(((nm - s) / (e - s)) * 100).toFixed(1)}%"></i>` : ""}</div>`;
    }).join("");
    // 每张卡片大约占时间轴的 22%：靠左的往右占，靠右的往左占；和同一行已有的卡片重叠就放到下一行（最多 3 行）
    // 事的小卡片按真实宽度排行（layout()）：放不下时先保证作业（截止）和还没到的事有位置
    const rank = (x) => (x.type === "作业" ? 0 : 1) + (live && hm2m(x.time) < nm ? 2 : 0);
    const sorted = items.slice().sort((p, q) => rank(p) - rank(q) || hm2m(p.time) - hm2m(q.time));
    const pins = sorted.map((x) => {
      const m = hm2m(x.time), p = +pct(m), past = live && m < nm;
      const cls = ["tb-p", x.type === "作业" ? "hw" : "", past ? "past" : ""].filter(Boolean).join(" ");
      return `<button class="${cls}" data-k="${esc(x.key)}" style="left:${p}%;--c:var(--t-${x.type || "个人"}, var(--brand))" title="${esc(x.time + " " + x.title + (x.location ? " · " + x.location : ""))}"><span class="num">${esc(x.time)}</span><b>${esc(x.title)}</b>${x.type === "作业" ? "<em>截止</em>" : ""}</button>`;
    }).join("");
    const ticks = [];
    for (let m = a; m <= z; m += 60) ticks.push(`<i style="left:${pct(m)}%"${(m - a) % 120 ? ' class="minor"' : m === a ? ' class="e0"' : m === z ? ' class="e1"' : ""}>${(m - a) % 120 ? "" : m / 60 + ":00"}</i>`);
    const loose = ctx.items.filter((x) => x.day === day && !x.done && hm2m(x.time) == null).length;
    const empty = !courses.length && !items.length, note = M.dayNote(App.S.courses, day);
    const showNow = live && nm >= a && nm <= z;
    return `<div class="tb${tomorrow ? " tmr" : ""}">
      <div class="tb-h"><b>${tomorrow ? "明天" : "今天"}</b><span>${empty && !loose ? "没有课，也没有要做的事" : [courses.length ? courses.length + " 节课" : "", items.length ? items.length + " 件有时间点的事" : "", loose ? loose + " 件全天的事" : ""].filter(Boolean).join("，")}</span>${note ? `<span class="td-adj">🔁 ${esc(note)}</span>` : ""}
        <span class="tb-lg"><i class="c"></i>课<i class="p"></i>事<i class="h"></i>截止</span>
        ${!App.S.courses.courses || !App.S.courses.courses.length ? `<button class="btn ghost sm" data-go="week">导入课程表</button>` : ""}</div>
      <div class="tb-track${courses.length ? "" : " nocls"}" style="--rows:1">
        <div class="tb-grid">${ticks.map((t) => t.replace(/>[^<]*<\/i>$/, "></i>")).join("")}</div>
        ${showNow ? `<div class="tb-past" style="width:${pct(nm)}%"></div>` : ""}
        <div class="tb-lane-c">${segs || `<span class="tb-none">${tomorrow ? "明天没课" : "今天没课"}</span>`}</div>
        <div class="tb-lane-p">${pins || `<span class="tb-none">${loose ? `没有定了时间的事（${loose} 件全天的事在下面）` : "没有定了时间的事"}</span>`}<button class="tb-more" data-go="tasks" hidden></button></div>
        ${showNow ? `<em class="tb-now" style="left:${pct(nm)}%"></em>` : ""}
      </div>
      <div class="tb-ticks">${ticks.filter((t) => !t.includes("minor")).join("")}${showNow ? `<i class="now" style="left:${pct(nm)}%">${M.pad(now.getHours())}:${M.pad(now.getMinutes())}</i>` : ""}</div>
    </div>`;
  },

  // ---------- 要做的事 ----------
  // 3.3.3 会议、活动这类到点开始的事：一天之内的显示「还有多久开始 / 进行中」（规则在 island-core.js，和网页、小程序、App 一样）
  todo() {
    const now = App.now(), t = M.dayKey(now), el = $("#tdTodo", this.el);
    const live = M.sortItems(App.items().filter((x) => !x.hidden));
    const groups = [
      ["📌 置顶", live.filter((x) => x.mine && x.pin && !x.done)],   // 6.2 备忘录：置顶的一直在最上面
      ["过期没完成", live.filter((x) => overdue(x, now) && M.dayDiff(x.day, now) >= -14), "bad"],
      ["今天", live.filter((x) => x.day === t && !overdue(x, now) && !x.done)],
      ["明天", live.filter((x) => x.day && M.dayDiff(x.day, now) === 1 && !x.done)],
      ["接下来一周", live.filter((x) => x.day && M.dayDiff(x.day, now) >= 2 && M.dayDiff(x.day, now) <= 7 && !x.done)],
      ["今天完成的", live.filter((x) => x.done && (App.S.doneLog || {})[x.key] === t), "ok"],
    ];
    const total = groups.slice(1, 5).reduce((n, g) => n + g[1].length, 0);
    $("#tdTodoN", this.el).textContent = total ? `${total} 件` : "";
    const row = (x) => `<div class="td-row${x.done ? " done" : ""}${Insp.key === x.key ? " insp-sel" : ""}" data-k="${esc(x.key)}"><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}" title="${x.done ? "标记为没完成" : "完成"}"></button>
      <span class="td-tag" style="--c:${tc(x.type)}">${esc(x.mine && x.type !== "作业" ? "我的" : x.study ? "考核" : x.type)}</span>
      <span class="td-t">${x.local ? '<small title="只存在这台设备">🔒</small> ' : ""}${esc(x.title)}${x.list && x.list.length ? ` <small class="muted" title="清单">☑ ${x.list.filter((i) => i.d).length}/${x.list.length}</small>` : ""}${x.rep ? ` <small class="muted" title="重复">🔁 ${esc(MemoCore.repName(x.rep))}</small>` : ""}${CloudFiles.count(x.key) || attachList(x.key).length ? ' <small title="有附件">📎</small>' : ""}${Autodel.soon(x) ? ' <small title="快要自动删除了">🗑</small>' : ""}</span>
      ${x.location ? `<span class="td-l">${esc(x.location)}</span>` : ""}${startTag(x, now)}<span class="td-w${overdue(x, now) ? " late" : ""}">${esc(x.day === t ? (x.time ? x.time + (x.type === "作业" ? " 截止" : "") : "今天") : whenText(x, now))}</span></div>`;
    const html = groups.filter((g) => g[1].length).map((g) => `<div class="td-g ${g[2] || ""}"><span>${g[0]}</span><small class="num">${g[1].length}</small></div>` + g[1].slice(0, 12).map(row).join("") + (g[1].length > 12 ? `<div class="td-more" data-go="tasks">还有 ${g[1].length - 12} 件…</div>` : "")).join("");
    el.innerHTML = html || `<div class="empty"><b>🎉</b>最近一周没有要做的事<br>在上面一句话记事，或者按 Ctrl+N</div>`;
  },
  stats() {
    const S = App.S, now = App.now(), t = M.dayKey(now), log = S.doneLog || {}, pomo = S.pomo || {};
    const mk = M.dayKey(M.addDays(now, -M.weekday0(now)));
    const doneToday = Object.values(log).filter((d) => d === t).length;
    const doneWeek = Object.values(log).filter((d) => d >= mk && d <= t).length;
    const days = new Set(Object.values(log).concat(Object.keys(pomo).filter((k) => pomo[k] > 0)));
    let streak = 0; for (let d = days.has(t) ? now : M.addDays(now, -1); days.has(M.dayKey(d)); d = M.addDays(d, -1)) streak++;
    $("#tdStats", this.el).innerHTML = [["今天完成", doneToday, "件"], ["本周完成", doneWeek, "件"], ["今日专注", (S.focusMin || {})[t] || (pomo[t] || 0) * 25, "分"], ["连续学习", streak, "天"]]
      .map(([a, b, c]) => `<div><b class="num">${b}</b><small>${c}</small><span>${a}</span></div>`).join("");
  },
  week() {
    const now = App.now(), monday = M.addDays(now, -M.weekday0(now)), items = App.items().filter((x) => !x.hidden && !x.done);
    $("#tdWeek", this.el).innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = M.addDays(monday, i), k = M.dayKey(d), cs = M.coursesOn(App.S.courses, d).length, its = items.filter((x) => x.day === k), hw = its.filter((x) => x.type === "作业").length;
      return `<div class="${k === M.dayKey(now) ? "today" : ""}${k < M.dayKey(now) ? " past" : ""}" title="${dateCN(k)}：${cs} 节课，${its.length} 件事${M.dayNote(App.S.courses, k) ? "（" + M.dayNote(App.S.courses, k) + "）" : ""}"><span>${M.WEEK[d.getDay()]}</span><b class="num">${d.getDate()}</b><i>${cs ? cs + " 课" : "·"}</i>${its.length ? `<em class="${hw ? "hw" : ""}">${its.length}</em>` : "<em class='z'></em>"}</div>`;
    }).join("");
  },
  wall() {
    const posts = ((App.S.wall && App.S.wall.posts) || []).filter((p) => !p.hidden).slice().sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0)).slice(0, 3);
    $("#tdWall", this.el).innerHTML = posts.length ? posts.map((p) => `<div class="td-wl" data-go="wall"><b>${p.pinned_at ? "📌 " : p.is_notice ? "📣 " : ""}${esc(p.author_name || "")}</b><span>${esc(p.title ? p.title + "　" + p.body : p.body)}</span></div>`).join("") : `<div class="muted" style="font-size:12.5px;padding:4px 2px">班级墙还没有内容</div>`;
  },
  pomo(p) {
    const el = this.el && $("#tdPomo", this.el); if (!el) return;
    p = p || {};
    if (p.running) el.innerHTML = `<div class="tp on" data-go="focus"><span class="tp-dot"></span><div><b>${p.phase === "focus" ? "专注中" : "休息中"}${p.task ? " · " + esc(p.task) : ""}</b><small>点这里看计时</small></div><b class="num tp-t">${M.pad(Math.floor(p.left / 60))}:${M.pad(p.left % 60)}</b></div>`;
    else el.innerHTML = `<div class="tp"><span>🍅</span><div><b>专注一会儿</b><small>${App.S.settings.pomoFocus} 分钟，到点提醒你休息</small></div><button class="btn sm" data-nx="pomo">开始</button></div>`;
  },
  // 每日一句 + 今天心情怎么样（和网页版同一套句子，心情跟着账号同步）
  enc() {
    const el = $("#tdEnc", this.el), now = App.now(), h = now.getHours(), wd = now.getDay(), t = todayKey();
    const late = App.items().filter((x) => !x.hidden && overdue(x, now) && x.type === "作业").length;
    const pool = h >= 23 || h < 5 ? ENC.night : late ? ENC.go : wd === 0 || wd === 6 ? ENC.rest.concat(ENC.warm) : ENC.warm.concat(ENC.go);
    const k = t + ((App.S.me || {}).id || ""); let hash = 0; for (let i = 0; i < k.length; i++) hash = (hash * 31 + k.charCodeAt(i)) | 0;
    const [zh, en, emo] = pool[(Math.abs(hash) + (this.shift || 0)) % pool.length], m = (KV("mood_log_v1") || {})[t];
    const reply = m && MOOD_REPLY[m] ? MOOD_REPLY[m][Math.abs(hash) % MOOD_REPLY[m].length] : "";
    el.innerHTML = `<div class="te-q"><span class="te-e">${emo}</span><div><b>${esc(zh)}</b><small>${esc(en)}</small></div><button class="btn ghost sm iconbtn" data-enc-next title="换一句">↻</button></div>
      <div class="te-m">${m ? `<span>${MOODS.find((x) => x[0] === m)[1]} ${esc(reply)}</span><a data-mood-redo>改</a>` : `<span class="muted">今天心情怎么样？</span>${MOODS.map(([k2, e, n]) => `<button data-mood="${k2}" title="${n}">${e}</button>`).join("")}`}</div>`;
  },
  cd() {
    const list = countdowns().filter((c) => c.n >= 0), top = list.find((c) => c.pinned) || list[0];
    $("#tdCd", this.el).innerHTML = top ? `<div class="td-plate tc" data-cd style="--c:${top.color || "var(--brand)"}"><span class="tc-e">${esc(top.emoji || "📅")}</span><div><small>距离</small><b>${esc(top.title)}</b><small>${esc(dateCN(top.date))}</small></div><b class="num tc-n">${top.n === 0 ? "今天" : top.n}<small>${top.n ? "天" : ""}</small></b></div>` : "";
  },
  habits() {
    const el = $("#tdHb", this.el), hs = KV("habits_v1"), log = KV("habit_log_v1") || {}, t = todayKey();
    el.classList.toggle("hidden", !hs.length || App.fun().habits === false);
    if (!hs.length) return;
    const left = hs.filter((x) => !(log[x.id] || {})[t]).length;
    el.innerHTML = `<div class="sec"><b>今日打卡</b><small>${left ? `还有 ${left} 个` : "全部完成 🔥"}</small><span class="grow"></span><button class="btn ghost sm" data-go="growth">全部</button></div>
      <div class="td-hbs">${hs.map((x) => { const on = !!(log[x.id] || {})[t], st = habitStreak(x.id); return `<button class="td-hbi${on ? " on" : ""}" data-hb="${esc(x.id)}" title="${on ? "已打卡，点一下取消" : "打卡"}"><span>${esc(x.icon || "✅")}</span><b>${esc(x.name)}</b>${st ? `<small>🔥${st}</small>` : ""}</button>`; }).join("")}</div>`;
  },
  keys(e, typing) { if (!typing && e.key === "/") { $("#tdQuick", this.el).focus(); return true; } },
};

const ENC = {
  go: [["今天的努力，是明天的底气。", "Today's effort is tomorrow's confidence.", "💪"], ["每一步都算数，继续往前走。", "Every step counts, keep going.", "🚶"], ["坚持一下，再坚持一下。", "Hold on, just a little longer.", "🔥"], ["你的坚持，终将美好。", "Your persistence will pay off beautifully.", "🦋"], ["先完成，再完美。", "Done is better than perfect.", "✅"], ["一次只做一件事，做完就是胜利。", "One thing at a time — finishing is winning.", "🎯"], ["作业不会自己消失，但你可以让它消失。", "Homework won't vanish by itself — but you can make it.", "📝"], ["世界很大，你的可能性更大。", "The world is big, your possibilities are bigger.", "🌍"]],
  warm: [["你比想象中更强大。", "You are stronger than you think.", "🌟"], ["别急，花会开的。", "Be patient, the flowers will bloom.", "🌸"], ["你已经做得很好了。", "You're already doing great.", "✨"], ["慢慢来，比较快。", "Slow and steady wins the race.", "🐢"], ["光而不耀，静而不止。", "Bright but calm, quiet but unstoppable.", "☀️"], ["允许一切发生，然后继续走。", "Let things happen, then keep walking.", "🍃"], ["你已经走了很远了，别忘了为自己鼓掌。", "You've come so far — applaud yourself.", "👏"], ["日子还长，值得期待的还有很多。", "There's still so much to look forward to.", "🌈"], ["今天也是值得被期待的一天。", "Today is another day worth looking forward to.", "🌅"], ["偶尔停下来，也是在往前走。", "Pausing is also part of moving forward.", "☕"]],
  rest: [["累了就休息，但别忘了重新出发。", "Rest if tired, but don't forget to start again.", "🛏️"], ["周末快乐！给自己充充电吧。", "Happy weekend — time to recharge.", "🔋"], ["出去走走，晒晒太阳。", "Go outside and catch some sunshine.", "🌤️"]],
  night: [["夜深了，明天的事交给明天的你。", "It's late — leave tomorrow's work to tomorrow's you.", "🌙"], ["早点睡，睡饱了脑子才转得快。", "Sleep well — a rested brain works faster.", "😴"]],
};
const MOOD_REPLY = {
  great: ["开心的日子要记住！把好心情分一点给同桌吧 🎉", "今天状态满分，冲鸭！"], good: ["平平稳稳就是好日子 🙂", "保持住，今天也会顺顺利利。"],
  meh: ["一般般也没关系，做完一件小事就会好一点。", "听首喜欢的歌，再开始下一件事吧 🎧"], tired: ["累了就歇一会儿，喝口水、伸个懒腰 ☕", "今天早点睡，明天又是满血的你。"],
  down: ["抱抱你。难过的时候不用硬撑，找信任的朋友或老师聊聊 🤍", "今天不开心也没关系，明天会好一点的。需要的话，随时可以找人说说。"],
};
