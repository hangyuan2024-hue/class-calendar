// 晨间简报：每天第一次用电脑时弹出来——今天的课、今天要交的和过期没交的作业、倒数日、要打卡的习惯
"use strict";
const M = window.CCModel;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tc = (t) => `var(--t-${M.TYPES.includes(t) ? t : "通知"})`;
let S = null;
function render() {
  if (!S) return;
  const now = new Date(), tk = M.dayKey(now), h = now.getHours(), me = S.me || {};
  $("hello").textContent = `${h < 11 ? "早上好" : h < 13 ? "中午好" : "下午好"}，${me.display_name || "同学"}`;
  const wk = M.weekOf((S.courses || {}).meta, now);
  $("sub").textContent = `${now.getMonth() + 1}月${now.getDate()}日 周${M.WEEK[now.getDay()]}${wk ? " · 第 " + wk + " 周" : ""}`;
  const cs = M.coursesOn(S.courses, now);
  const items = M.allItems(S).filter((x) => !x.hidden && !x.done);
  const today = M.sortItems(items.filter((x) => x.day === tk)), late = M.sortItems(items.filter((x) => x.day && x.day < tk && M.dayDiff(x.day, now) >= -7 && x.type === "作业"));
  const soon = M.sortItems(items.filter((x) => x.type === "作业" && x.day && M.dayDiff(x.day, now) >= 1 && M.dayDiff(x.day, now) <= 3));
  const cds = ((S.kv || {}).countdown_v1 || []).filter((c) => c && c.date && M.dayDiff(c.date, now) >= 0 && M.dayDiff(c.date, now) <= 30).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
  const habits = (S.kv || {}).habits_v1 || [], hl = (S.kv || {}).habit_log_v1 || {};
  const hleft = habits.filter((x) => !(hl[x.id] || {})[tk]);
  const it = (x, late2) => `<div class="m-t"><i style="background:${tc(x.type)}"></i><span>${esc(x.title)}</span><small class="${late2 ? "late" : ""}">${late2 ? M.relDay(x.day, now) : x.time || (x.day === tk ? "今天" : M.relDay(x.day, now))}</small></div>`;
  $("body").innerHTML = `
    ${cds.map((c) => `<div class="b-cd" style="--c:${c.color || "#3d6ff2"}">${esc(c.emoji || "📅")} 距离「${esc(c.title)}」<b>${M.dayDiff(c.date, now) || "就是今天"}</b>${M.dayDiff(c.date, now) ? " 天" : ""}</div>`).join("")}
    <div class="m-s">今天的课 <small>${cs.length} 节</small></div>
    ${cs.length ? cs.map((c) => `<div class="m-c" style="--c:${c.color}"><span class="mono">${c.tStart}</span><b>${esc(c.name)}</b><small>${esc(c.location || "")}</small></div>`).join("") : '<div class="m-e">今天没课 🎈</div>'}
    ${late.length ? `<div class="m-s late">过期没交 <small>${late.length}</small></div>${late.map((x) => it(x, true)).join("")}` : ""}
    <div class="m-s">今天要做 <small>${today.length}</small></div>
    ${today.length ? today.map((x) => it(x)).join("") : '<div class="m-e">今天没有要做的事 🎉</div>'}
    ${soon.length ? `<div class="m-s">3 天内要交</div>${soon.map((x) => it(x)).join("")}` : ""}
    ${hleft.length ? `<div class="m-s">今天还要打卡</div><div class="b-hb">${hleft.map((x) => `<span>${esc(x.icon || "✅")} ${esc(x.name)}</span>`).join("")}</div>` : ""}`;
}
$("open").onclick = () => { window.cc.call("open:main", "today"); window.cc.call("brief:close"); };
$("later").onclick = $("close").onclick = () => window.cc.call("brief:close");
window.cc.on("state", (s) => { S = s; render(); });
(async () => { S = await window.cc.call("state"); render(); })();
