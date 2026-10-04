// 倒数日：期末考试、四六级、生日、放假……还有几天一眼看到；提前 7 / 3 / 1 天右下角提醒；
// 首页、桌面小窗、托盘提示里都会显示最近的一个；跟着账号同步（countdown_v1）
"use strict";
const CD_COLORS = ["#3d6ff2", "#e5484d", "#17a673", "#f08c00", "#a259ff", "#14b8c4", "#ef5da8"];
const CD_SUGG = [["期末考试", "📝"], ["四六级考试", "🗣️"], ["放寒假", "❄️"], ["运动会", "🏃"], ["生日", "🎂"]];
function countdowns() { return KV("countdown_v1").filter((c) => c && c.date && c.title).map((c) => ({ ...c, n: M.dayDiff(c.date, App.now()) })).sort((a, b) => (a.n < 0) - (b.n < 0) || (a.n < 0 ? b.n - a.n : a.n - b.n)); }
App.views.countdown = {
  title: "倒数日", icon: "countdown",
  count() { const c = countdowns().find((x) => x.n >= 0); return c && c.n <= 3 ? { n: c.n || "今", hot: true } : null; },
  mount(el) {
    el.innerHTML = `<div class="vhead"><div><h1>倒数日</h1><div class="sub">重要的日子还有几天，提前 7 天、3 天、1 天提醒你；手机和网页上也能看到</div></div><span class="grow"></span><button class="btn primary" id="cdAdd">${icon("plus")}添加</button></div>
      <div class="vbody"><div class="cd-wrap" id="cdBox"></div></div>`;
    $("#cdAdd", el).onclick = () => this.edit(null);
    el.addEventListener("click", (e) => {
      const s = e.target.closest("[data-sugg]"); if (s) return this.edit(null, { title: s.dataset.sugg, emoji: s.dataset.e });
      const ex = e.target.closest("[data-exam]"); if (ex) { const x = App.find(ex.dataset.exam); if (x) this.edit(null, { title: x.title, date: x.day, emoji: "📝" }); return; }
      const c = e.target.closest("[data-cd]"); if (c) { const x = KV("countdown_v1").find((y) => y.id === c.dataset.cd); if (x) this.edit(x); }
    });
    el.addEventListener("contextmenu", (e) => {
      const c = e.target.closest("[data-cd]"); if (!c) return; e.preventDefault();
      const x = KV("countdown_v1").find((y) => y.id === c.dataset.cd); if (!x) return;
      menu(e.clientX, e.clientY, [{ label: "编辑", icon: "edit", fn: () => this.edit(x) }, { label: x.pinned ? "取消置顶" : "置顶到首页", icon: "pin", fn: () => kvSet("countdown_v1", x.id, { ...x, pinned: !x.pinned }) }, "-", { label: "删除", icon: "trash", danger: true, fn: () => this.del(x) }]);
    });
  },
  show(arg) { if (arg && arg.add) this.edit(null); },
  update() {
    const box = $("#cdBox", this.el), list = countdowns(), future = list.filter((c) => c.n >= 0), past = list.filter((c) => c.n < 0);
    const top = future.find((c) => c.pinned) || future[0];
    const exams = App.items().filter((x) => x.day && M.dayDiff(x.day, App.now()) > 0 && /考试|测验|期中|期末|答辩|比赛|竞赛/.test(x.title + x.summary) && !list.some((c) => c.title === x.title && c.date === x.day)).slice(0, 4);
    const card = (c) => `<div class="card cd${c.n < 0 ? " past" : ""}" data-cd="${esc(c.id)}" style="--c:${c.color || CD_COLORS[0]}" title="点一下编辑，右键更多"><div class="cd-t">${esc(c.emoji || "📅")} ${esc(c.title)}${c.pinned ? " 📌" : ""}</div>
      <div class="cd-n">${c.n === 0 ? "就是今天" : c.n > 0 ? `<b>${c.n}</b><small>天</small>` : `已经过去 <b>${-c.n}</b> 天`}</div><div class="cd-d muted">${esc(dateCN(c.date))}${c.note ? " · " + esc(c.note) : ""}</div></div>`;
    box.innerHTML = `${top ? `<div class="card cd-hero" style="--c:${top.color || CD_COLORS[0]}" data-cd="${esc(top.id)}"><div>${esc(top.emoji || "📅")} 距离 <b>${esc(top.title)}</b></div><div class="cd-big">${top.n === 0 ? "今天！" : `${top.n}<small> 天</small>`}</div><div class="muted">${esc(dateCN(top.date))}${top.n > 0 ? ` · 还有 ${Math.ceil(top.n / 7)} 周` : ""}</div></div>` : ""}
      ${future.length ? `<div class="cd-grid">${future.map(card).join("")}</div>` : `<div class="card empty"><b>⏳</b>还没有倒数日。<div class="cd-sugg">${CD_SUGG.map(([t, e]) => `<button class="btn sm" data-sugg="${t}" data-e="${e}">${e} ${t}</button>`).join("")}</div></div>`}
      ${exams.length ? `<div class="sec-h"><b>日历里的考试和比赛</b><span>点一下加成倒数日</span></div><div class="cd-sugg">${exams.map((x) => `<button class="btn" data-exam="${esc(x.key)}">📝 ${esc(x.title)} · ${esc(M.relDay(x.day, App.now()))}</button>`).join("")}</div>` : ""}
      ${past.length ? `<div class="sec-h"><b>已经过去的</b><span>${past.length} 个</span></div><div class="cd-grid">${past.map(card).join("")}</div>` : ""}`;
  },
  async edit(x, preset) {
    preset = preset || {};
    const v = await formBox(x ? "编辑倒数日" : "添加倒数日", [
      { name: "title", label: "什么日子", value: x ? x.title : preset.title || "", max: 30, placeholder: "比如：期末考试" },
      { name: "date", label: "日期", type: "date", value: x ? x.date : preset.date || "" },
      { name: "emoji", label: "图标", value: x ? x.emoji || "📅" : preset.emoji || "📅", max: 4 },
      { name: "color", label: "颜色", type: "select", value: x ? x.color || CD_COLORS[0] : CD_COLORS[0], options: CD_COLORS.map((c, i) => [c, ["蓝", "红", "绿", "橙", "紫", "青", "粉"][i]]) },
      { name: "note", label: "备注（可不填）", value: x ? x.note || "" : "", max: 60 },
    ], x ? "保存" : "添加", { check: (o) => (!o.title ? "写一下是什么日子" : !/^\d{4}-\d{2}-\d{2}$/.test(o.date) ? "选一个日期" : "") });
    if (!v) return;
    const id = x ? x.id : "cd" + Date.now();
    await kvSet("countdown_v1", id, { ...(x || {}), id, title: v.title, date: v.date, emoji: v.emoji, color: v.color, note: v.note });
    toast(x ? "已保存" : `已添加：距离「${v.title}」还有 ${M.dayDiff(v.date, App.now())} 天`);
  },
  async del(x) { if (await confirmBox(`删除「${x.title}」？`, "", "删除", true)) kvSet("countdown_v1", x.id, null); },
};
