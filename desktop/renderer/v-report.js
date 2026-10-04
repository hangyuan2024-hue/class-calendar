// 每周学习报告：完成了多少事、作业按时完成率、专注了多久、打卡、心情，和上一周比一比；
// 下周要交的作业、倒数日提前看。周日晚上右下角提醒；可以导出成 PDF 或图片发给爸妈 / 存起来
"use strict";
App.views.report = {
  title: "每周报告", icon: "report", off: 0,
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1 id="rpTitle">本周学习报告</h1><div class="sub" id="rpSub"></div></div><span class="grow"></span>
        <div class="row"><button class="btn iconbtn" id="rpPrev" title="上一周">${icon("left")}</button><button class="btn" id="rpNow">本周</button><button class="btn iconbtn" id="rpNext" title="下一周">${icon("right")}</button></div>
        <button class="btn" id="rpImg">${icon("image")}存成图片</button><button class="btn primary" id="rpPdf">${icon("export")}导出 PDF</button></div>
      <div class="vbody"><div class="rp-wrap" id="rpBox"></div></div>`;
    $("#rpPrev", el).onclick = () => { this.off--; this.update(); };
    $("#rpNext", el).onclick = () => { if (this.off < 0) { this.off++; this.update(); } };
    $("#rpNow", el).onclick = () => { this.off = 0; this.update(); };
    $("#rpPdf", el).onclick = () => call("export:pdf", this.printHtml(), "学习报告-" + this.range()[0]).then((f) => f && toast("已导出 PDF"));
    $("#rpImg", el).onclick = () => call("export:image", this.printHtml(true), "学习报告-" + this.range()[0], 900, 1300).then((f) => f && toast("已保存图片"));
  },
  range(off) { const now = App.now(), mon = M.addDays(now, -M.weekday0(now) + 7 * (off ?? this.off)); return [M.dayKey(mon), M.dayKey(M.addDays(mon, 6))]; },
  stats(off) {
    const [a, b] = this.range(off), S = App.S, dl = S.doneLog || {}, pl = S.pomo || {}, fm = S.focusMin || {}, habits = KV("habits_v1"), hl = KV("habit_log_v1") || {}, ml = KV("mood_log_v1") || {};
    const days = Array.from({ length: 7 }, (_, i) => shiftDay(a, i)), inW = (d) => d >= a && d <= b;
    const all = App.items().filter((x) => !x.hidden);
    const hw = all.filter((x) => x.type === "作业" && x.day && inW(x.day)), hwDone = hw.filter((x) => x.done);
    const ontime = hwDone.filter((x) => dl[x.key] && dl[x.key] <= x.day).length;
    const doneKeys = Object.keys(dl).filter((k) => inW(dl[k]));
    const byType = {}; for (const k of doneKeys) { const x = App.find(k); const t = x ? x.type : "其他"; byType[t] = (byType[t] || 0) + 1; }
    const perDay = days.map((d) => ({ d, done: doneKeys.filter((k) => dl[k] === d).length, pomo: +pl[d] || 0, min: +fm[d] || (+pl[d] || 0) * 25, hab: habits.filter((x) => (hl[x.id] || {})[d]).length }));
    const pomos = perDay.reduce((s, x) => s + x.pomo, 0), mins = perDay.reduce((s, x) => s + x.min, 0), checks = perDay.reduce((s, x) => s + x.hab, 0);
    const habitRows = habits.map((x) => ({ ...x, n: days.filter((d) => (hl[x.id] || {})[d]).length }));
    const moods = {}; for (const d of days) if (ml[d]) moods[ml[d]] = (moods[ml[d]] || 0) + 1;
    const late = hw.filter((x) => !x.done && x.day < todayKey());
    return { a, b, days, done: doneKeys.length, byType, hw: hw.length, hwDone: hwDone.length, ontime, perDay, pomos, mins, checks, habitRows, moods, late };
  },
  summary(s, p) {
    const out = [];
    if (s.hw) out.push(s.hwDone === s.hw ? `这周 ${s.hw} 项作业全部完成${s.ontime === s.hw ? "，而且都按时交了" : ""}，太棒了！` : `这周 ${s.hw} 项作业完成了 ${s.hwDone} 项${s.late.length ? `，还有 ${s.late.length} 项过期没交，记得补上` : ""}。`);
    if (s.done > p.done) out.push(`完成的事情比上周多了 ${s.done - p.done} 件。`); else if (s.done < p.done && p.done) out.push(`完成的事情比上周少了 ${p.done - s.done} 件，下周加油。`);
    if (s.mins) out.push(`一共专注了 ${s.mins >= 60 ? (s.mins / 60).toFixed(1) + " 小时" : s.mins + " 分钟"}${s.mins > p.mins && p.mins ? "，比上周更专注了" : ""}。`); else out.push("这周还没用番茄钟专注，试试每天 25 分钟？");
    const best = s.habitRows.slice().sort((x, y) => y.n - x.n)[0];
    if (best && best.n) out.push(`坚持得最好的习惯是「${best.name}」，打卡 ${best.n} 天。`);
    return out.join("");
  },
  update() {
    const el = this.el, s = this.stats(), p = this.stats(this.off - 1), now = App.now();
    $("#rpTitle", el).textContent = this.off === 0 ? "本周学习报告" : this.off === -1 ? "上周学习报告" : "学习报告";
    const md = (k) => { const d = M.fromKey(k); return `${d.getMonth() + 1}月${d.getDate()}日`; };
    $("#rpSub", el).textContent = `${md(s.a)} – ${md(s.b)}${this.off === 0 ? " · 这周还没过完，数字还会变" : ""}`;
    $("#rpNext", el).disabled = this.off >= 0; $("#rpNow", el).disabled = !this.off;
    const diff = (v, o) => (o === v ? `<small class="muted">和上周一样</small>` : `<small class="${v > o ? "up" : "down"}">${v > o ? "▲" : "▼"} ${Math.abs(v - o)}</small>`);
    const maxMin = Math.max(30, ...s.perDay.map((x) => x.min)), maxDone = Math.max(3, ...s.perDay.map((x) => x.done));
    const next = this.off === 0 ? App.items().filter((x) => !x.hidden && !x.done && x.type === "作业" && x.day && x.day > s.b && M.dayDiff(x.day, now) <= 13).sort((x, y) => x.day.localeCompare(y.day)) : [];
    const cds = this.off === 0 ? countdowns().filter((c) => c.n >= 0 && c.n <= 30) : [];
    $("#rpBox", el).innerHTML = `
      <div class="card rp-sum"><span>📊</span><p>${esc(this.summary(s, p))}</p></div>
      <div class="stats rp-stats">
        <div class="stat"><span>完成的事</span><b>${s.done}<small>件</small></b>${diff(s.done, p.done)}</div>
        <div class="stat"><span>作业完成</span><b>${s.hwDone}<small>/ ${s.hw}</small></b><small class="muted">按时 ${s.ontime} 项</small></div>
        <div class="stat"><span>专注</span><b>${s.mins >= 60 ? (s.mins / 60).toFixed(1) : s.mins}<small>${s.mins >= 60 ? "小时" : "分钟"}</small></b>${diff(s.pomos, p.pomos).replace(/(\d+)<\/small>$/, "$1 个番茄</small>")}</div>
        <div class="stat"><span>打卡</span><b>${s.checks}<small>次</small></b>${diff(s.checks, p.checks)}</div>
      </div>
      <div class="rp-cols">
        <div class="card"><div class="card-h">每天<span class="grow"></span><small><span class="lgd"><i style="background:var(--brand)"></i>完成</span><span class="lgd"><i style="background:var(--bad)"></i>专注分钟</span></small></div>
          <div class="rp-bars">${s.perDay.map((x) => `<div class="${x.d === todayKey() ? "today" : ""}"><div class="rp-b2"><i style="height:${Math.round(x.done / maxDone * 100)}%;background:var(--brand)" title="完成 ${x.done} 件"></i><i style="height:${Math.round(x.min / maxMin * 100)}%;background:var(--bad)" title="专注 ${x.min} 分钟"></i></div><span>周${M.WEEK[M.fromKey(x.d).getDay()]}</span><small>${x.done}/${x.min}′</small></div>`).join("")}</div></div>
        <div class="card"><div class="card-h">完成了什么</div><div class="rp-types">${Object.entries(s.byType).map(([t, n]) => `<div>${tagHtml(t)}<b>${n}</b></div>`).join("") || `<div class="muted">这周还没有完成记录</div>`}</div>
          <div class="card-h">习惯</div><div class="rp-hab">${s.habitRows.map((x) => `<div><span>${esc(x.icon || "✅")} ${esc(x.name)}</span><span class="rp-dots">${s.days.map((d) => `<i class="${(KV("habit_log_v1")[x.id] || {})[d] ? "on" : ""}"></i>`).join("")}</span><b>${x.n}/7</b></div>`).join("") || `<div class="muted">还没有习惯</div>`}</div>
          <div class="card-h">心情</div><div class="rp-mood">${MOODS.filter(([k]) => s.moods[k]).map(([k, e, n]) => `<span>${e} ${n} ${s.moods[k]} 天</span>`).join("") || `<span class="muted">这周没记心情</span>`}</div></div>
      </div>
      ${this.off === 0 ? `<div class="rp-cols">
        <div class="card"><div class="card-h">下周要交的作业<span class="grow"></span><small>${next.length} 项</small></div>${next.map((x) => `<div class="rp-li">${esc(x.title)}<small class="muted">${esc(whenText(x, now))}</small></div>`).join("") || `<div class="muted rp-li">下周还没有作业，好好休息</div>`}${s.late.length ? `<div class="card-h" style="color:var(--bad)">过期没交</div>${s.late.map((x) => `<div class="rp-li">${esc(x.title)}<small class="late">${esc(whenText(x, now))}</small></div>`).join("")}` : ""}</div>
        <div class="card"><div class="card-h">快到的日子</div>${cds.map((c) => `<div class="rp-li">${esc(c.emoji || "📅")} ${esc(c.title)}<small class="muted">${c.n ? c.n + " 天后" : "今天"}</small></div>`).join("") || `<div class="muted rp-li">没有倒数日。<a data-go-cd>添加一个</a></div>`}</div></div>` : ""}`;
    const g = $("[data-go-cd]", el); if (g) g.onclick = () => App.go("countdown", { add: true });
  },
  printHtml(image) {
    const s = this.stats(), p = this.stats(this.off - 1), me = App.S.me || {};
    const rows = s.perDay.map((x) => `<tr><td>周${M.WEEK[M.fromKey(x.d).getDay()]} ${x.d.slice(5)}</td><td>${x.done}</td><td>${x.pomo}</td><td>${x.min}</td><td>${x.hab}</td></tr>`).join("");
    return printDoc(`${me.display_name || ""}的学习报告`, `${s.a} – ${s.b}${App.className() ? " · " + App.className() : ""}`,
      `<div class="box">${esc(this.summary(s, p))}</div>
      <div class="kpi"><div><b>${s.done}</b>完成的事</div><div><b>${s.hwDone}/${s.hw}</b>作业完成</div><div><b>${s.mins}</b>专注分钟</div><div><b>${s.checks}</b>打卡次数</div></div>
      <table><thead><tr><th>日期</th><th>完成</th><th>番茄</th><th>专注分钟</th><th>打卡</th></tr></thead><tbody>${rows}</tbody></table>
      ${s.habitRows.length ? `<h3>习惯</h3><table><tbody>${s.habitRows.map((x) => `<tr><td>${esc(x.icon || "")} ${esc(x.name)}</td><td>${x.n} / 7 天</td></tr>`).join("")}</tbody></table>` : ""}`,
      `.box{background:#eef3ff;border-radius:10px;padding:12px 14px;margin-bottom:14px}.kpi{display:flex;gap:10px;margin-bottom:14px}.kpi div{flex:1;border:1px solid #e3e8f1;border-radius:10px;padding:10px;color:#55627a}.kpi b{display:block;font-size:24px;color:#1b2740}h3{margin:16px 0 6px}${image ? "body{padding:28px 32px;background:#fff}" : ""}`);
  },
};
