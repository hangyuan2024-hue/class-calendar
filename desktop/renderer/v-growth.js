// 成长：本周进度环、最近 14 天趋势、习惯打卡（连续天数、最近两周）、心情记录；打卡会记成长值上排行榜
"use strict";
const HABIT_EMO = ["📖", "🏃", "💧", "🧘", "✍️", "🎹", "😴", "🍎", "🗣️", "💪", "🧹", "💻"];
const HABIT_SUGG = [["📖", "阅读 30 分钟"], ["🗣️", "背 30 个单词"], ["🏃", "跑步 / 阳光跑"], ["😴", "12 点前睡觉"], ["💧", "喝够 8 杯水"], ["🧘", "冥想 10 分钟"]];
const MOODS = [["great", "😄", "超开心"], ["good", "🙂", "还不错"], ["meh", "😐", "一般般"], ["tired", "😮‍💨", "有点累"], ["down", "😢", "不开心"]];
function habitStreak(id) {
  const log = (KV("habit_log_v1") || {})[id] || {};
  let k = todayKey(), n = 0;
  if (!log[k]) k = shiftDay(k, -1);
  while (log[k]) { n++; k = shiftDay(k, -1); }
  return n;
}
function weekStats() {
  const now = App.now(), mon = M.dayKey(M.addDays(now, -M.weekday0(now))), sun = shiftDay(mon, 6), t = todayKey();
  const items = App.items().filter((x) => x.day && x.day >= mon && x.day <= sun && !x.hidden), hw = items.filter((x) => x.type === "作业");
  const habits = KV("habits_v1"), log = KV("habit_log_v1") || {};
  return { hwDone: hw.filter((x) => x.done).length, hwAll: hw.length, allDone: items.filter((x) => x.done).length, all: items.length,
    hDone: habits.filter((h) => (log[h.id] || {})[t]).length, hAll: habits.length };
}
App.views.growth = {
  title: "打卡", icon: "growth", emo: HABIT_EMO[0],
  count() { const h = KV("habits_v1"), log = KV("habit_log_v1") || {}, t = todayKey(); const n = h.filter((x) => !(log[x.id] || {})[t]).length; return App.fun().habits === false ? null : { n }; },
  mount(el) {
    el.innerHTML = `
      <div class="vhead"><div><h1>成长与打卡</h1><div class="sub">完成事项、习惯打卡、专注番茄都会攒成长值，班级排行榜上能看到</div></div><span class="grow"></span>
        <button class="btn" data-go="rank">${icon("rank")}排行榜</button><button class="btn" data-go="meta">${icon("meta")}元宇宙</button></div>
      <div class="vbody gr-body">
        <div class="gr-top"><div class="card gr-rings" id="grRings"></div><div class="card gr-trend"><div class="card-h">最近 14 天<span class="grow"></span><small id="grLg"></small></div><div id="grTrend"></div></div></div>
        <div class="gr-cols">
          <div class="card gr-habits"><div class="card-h">习惯打卡<span class="grow"></span><small>点「打卡」，每天一次</small></div><div id="grList"></div>
            <div class="gr-add"><div class="gr-emo" id="grEmo"></div><div class="row"><input class="input" id="grName" maxlength="20" placeholder="新习惯，比如：每天背 30 个单词"><button class="btn primary" id="grAdd">${icon("plus")}添加</button></div><div class="gr-sugg" id="grSugg"></div></div></div>
          <div class="card gr-mood"><div class="card-h">心情<span class="grow"></span><small>每天点一下，看看最近过得怎么样</small></div><div id="grMood"></div></div>
        </div>
      </div>`;
    el.addEventListener("click", async (e) => {
      const g = e.target.closest("[data-go]"); if (g) return App.go(g.dataset.go);
      const em = e.target.closest("[data-emo]"); if (em) { this.emo = em.dataset.emo; this.drawAdd(); return; }
      const sg = e.target.closest("[data-sugg]"); if (sg) { this.add(sg.dataset.sugg, sg.dataset.se); return; }
      const hb = e.target.closest("[data-habit]"); if (hb) { const on = await call("habit", hb.dataset.habit); if (on) { const h = KV("habits_v1").find((x) => x.id === hb.dataset.habit); const s = habitStreak(hb.dataset.habit) || 1; cheer("habit", [3, 7, 14, 21, 30].includes(s) ? `「${h.name}」连续 ${s} 天了！` : s > 1 ? `已经连续 ${s} 天` : "明天也来哦"); } return; }
      const dot = e.target.closest("[data-hd]"); if (dot) { await call("habit", dot.dataset.hid, dot.dataset.hd); return; }
      const del = e.target.closest("[data-hdel]");
      if (del) {
        const h = KV("habits_v1").find((x) => x.id === del.dataset.hdel); if (!h) return;
        if (!(await confirmBox(`删除「${h.name}」？`, "它的打卡记录也会一起删掉。", "删除", true))) return;
        const log = (KV("habit_log_v1") || {})[h.id] || {};
        await call("kv:batch", [["habits_v1", h.id, null], ...Object.keys(log).map((d) => ["habit_log_v1", [h.id, d], null])]);
        return;
      }
      const md = e.target.closest("[data-mood]"); if (md) { const t = todayKey(), cur = (KV("mood_log_v1") || {})[t]; kvSet("mood_log_v1", t, cur === md.dataset.mood ? null : md.dataset.mood); }
    });
    $("#grAdd", el).onclick = () => this.add($("#grName", el).value);
    $("#grName", el).onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) this.add($("#grName", el).value); };
  },
  async add(name, emo) {
    name = String(name || "").trim(); if (!name) return $("#grName", this.el).focus();
    if (KV("habits_v1").some((h) => h.name === name)) return toast("已经有这个习惯了");
    const id = "h" + Date.now();
    await kvSet("habits_v1", id, { id, name: name.slice(0, 20), icon: emo || this.emo });
    $("#grName", this.el).value = ""; toast("已添加：" + name);
  },
  drawAdd() {
    const el = this.el, habits = KV("habits_v1");
    $("#grEmo", el).innerHTML = HABIT_EMO.map((e) => `<button data-emo="${e}" class="${e === this.emo ? "on" : ""}">${e}</button>`).join("");
    $("#grSugg", el).innerHTML = HABIT_SUGG.filter(([, n]) => !habits.some((h) => h.name === n)).map(([e, n]) => `<button class="btn ghost sm" data-sugg="${esc(n)}" data-se="${e}">＋ ${e} ${esc(n)}</button>`).join("");
  },
  update() {
    const el = this.el, w = weekStats(), habits = KV("habits_v1"), log = KV("habit_log_v1") || {}, t = todayKey();
    const cell = (d, a, color, name) => `<div class="gr-ring">${ringSvg(d, a, 92, color)}<div><b>${name}</b><span>${d} / ${a}</span></div></div>`;
    $("#grRings", el).innerHTML = cell(w.hwDone, w.hwAll, "var(--bad)", "本周作业") + cell(w.allDone, w.all, "var(--brand)", "本周事项") + cell(w.hDone, w.hAll, "var(--warn)", "今日打卡");
    // 趋势：每天完成几件事、打了几次卡、专注几个番茄
    const days = Array.from({ length: 14 }, (_, i) => shiftDay(t, i - 13)), dl = App.S.doneLog || {}, pl = App.S.pomo || {};
    const series = [["完成事项", days.map((d) => Object.values(dl).filter((x) => x === d).length), "var(--brand)"], ["打卡", days.map((d) => habits.filter((hh) => (log[hh.id] || {})[d]).length), "var(--warn)"], ["番茄", days.map((d) => Number(pl[d]) || 0), "var(--bad)"]];
    $("#grLg", el).innerHTML = series.map(([n, , c]) => `<span class="lgd"><i style="background:${c}"></i>${n}</span>`).join("");
    const max = Math.max(4, ...series.flatMap((s) => s[1])), top = Math.ceil(max / 2) * 2, W = 640, H = 190, L = 26, R = 12, T = 10, B = 24;
    const x = (i) => L + (W - L - R) * i / 13, y = (v) => T + (H - T - B) * (1 - v / top);
    $("#grTrend", el).innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="trend">${[0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join("")}
      ${days.map((d, i) => (i % 2 === 1 || i === 13) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${i === 13 ? "今天" : +d.slice(5, 7) + "/" + +d.slice(8)}</text>` : "").join("")}
      ${series.map(([n, a, c]) => `<path d="${a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${a.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === 13 ? 4 : 2.5}" fill="${c}"><title>${days[i]} ${n} ${v}</title></circle>`).join("")}`).join("")}</svg>`;
    // 习惯
    const last = Array.from({ length: 14 }, (_, i) => shiftDay(t, i - 13));
    $("#grList", el).innerHTML = habits.length ? habits.map((hh) => {
      const lg = log[hh.id] || {}, st = habitStreak(hh.id), on = !!lg[t], total = Object.keys(lg).length;
      return `<div class="hb"><span class="hb-i">${esc(hh.icon || "✅")}</span><div class="hb-m"><b>${esc(hh.name)}${st ? `<span class="streak">🔥 连续 ${st} 天</span>` : ""}</b>
          <div class="hb-dots">${last.map((d) => `<i class="${lg[d] ? "on" : ""}${d === t ? " today" : ""}" data-hd="${d}" data-hid="${esc(hh.id)}" title="${d}${lg[d] ? " 已打卡（点一下取消）" : "（点一下补打卡）"}"></i>`).join("")}<small class="muted">共 ${total} 次</small></div></div>
        <button class="btn ${on ? "" : "primary"} hb-go" data-habit="${esc(hh.id)}">${on ? "✓ 已打卡" : "打卡"}</button><button class="btn ghost iconbtn sm" data-hdel="${esc(hh.id)}" title="删除这个习惯">${icon("trash")}</button></div>`;
    }).join("") : `<div class="empty"><b>🌱</b>还没有习惯。挑一个下面的建议，或者自己写一个。</div>`;
    this.drawAdd();
    // 心情：今天 + 最近 5 周
    const ml = KV("mood_log_v1") || {}, mt = ml[t];
    const start = M.addDays(M.fromKey(t), -M.weekday0(M.fromKey(t)) - 28);
    $("#grMood", el).innerHTML = `<div class="md-today"><span>今天心情怎么样？</span>${MOODS.map(([k, e, n]) => `<button data-mood="${k}" class="${mt === k ? "on" : ""}" title="${n}">${e}</button>`).join("")}</div>
      <div class="md-wd">${"一二三四五六日".split("").map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="md-cal">${Array.from({ length: 35 }, (_, i) => { const d = M.dayKey(M.addDays(start, i)), m = MOODS.find((x) => x[0] === ml[d]); return `<div class="${d === t ? "today" : ""}${d > t ? " fut" : ""}" title="${d}${m ? " " + m[2] : ""}">${m ? m[1] : `<small>${+d.slice(8)}</small>`}</div>`; }).join("")}</div>
      <div class="md-sum muted">${(() => { const c = {}; for (const [d, v] of Object.entries(ml)) if (d >= M.dayKey(start)) c[v] = (c[v] || 0) + 1; const tot = Object.values(c).reduce((a, b) => a + b, 0); return tot ? "最近 5 周：" + MOODS.filter(([k]) => c[k]).map(([k, e]) => `${e} ${c[k]} 天`).join("　") : "还没有心情记录"; })()}</div>`;
  },
};
