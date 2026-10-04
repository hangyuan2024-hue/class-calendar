// 桌面小窗：今天的课、下节课倒计时、今天要做的事，一直浮在桌面最上面
"use strict";
const M = window.CCModel;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let S = null, pomo = null;
const tc = (t) => `var(--t-${M.TYPES.includes(t) ? t : "通知"})`;
function render() {
  if (!S) return;
  const now = new Date(), tk = M.dayKey(now), nm = now.getHours() * 60 + now.getMinutes();
  $("date").textContent = `${now.getMonth() + 1}月${now.getDate()}日 周${M.WEEK[now.getDay()]}`;
  const wk = M.weekOf((S.courses || {}).meta, now);
  $("sub").textContent = wk ? `第 ${wk} 周` : "";
  if (!S.loggedIn) { $("courses").innerHTML = '<div class="m-e">还没登录，点右上角打开主窗口登录</div>'; $("todo").innerHTML = ""; $("next").innerHTML = ""; return; }
  const cs = M.coursesOn(S.courses, now);
  const cur = cs.find((c) => nm >= M.toMin(c.tStart) && nm < M.toMin(c.tEnd)), nx = cs.find((c) => M.toMin(c.tStart) > nm);
  const left = (m) => (m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`);
  $("next").innerHTML = cur ? `<div class="m-next" style="--c:${cur.color}"><small>正在上 · 还剩 ${left(M.toMin(cur.tEnd) - nm)}</small><b>${esc(cur.name)}</b><span>${esc(cur.location || "")}</span></div>`
    : nx ? `<div class="m-next" style="--c:${nx.color}"><small>${left(M.toMin(nx.tStart) - nm)}后上课</small><b>${esc(nx.name)}</b><span>${nx.tStart} ${esc(nx.location || "")}</span></div>` : "";
  $("courses").innerHTML = cs.length ? cs.map((c) => `<div class="m-c${M.toMin(c.tEnd) <= nm ? " past" : ""}${c === cur ? " cur" : ""}" style="--c:${c.color}"><span class="mono">${c.tStart}</span><b>${esc(c.name)}</b><small>${esc(c.location || "")}</small></div>`).join("") : '<div class="m-e">今天没课 🎈</div>';
  const items = M.sortItems(M.allItems(S).filter((x) => !x.hidden && x.day && (x.day === tk || (!x.done && x.day < tk && M.dayDiff(x.day, now) >= -7))));
  $("todo").innerHTML = items.length ? items.map((x) => `<div class="m-t${x.done ? " done" : ""}"><button class="chk${x.done ? " on" : ""}" data-k="${esc(x.key)}"></button><i style="background:${tc(x.type)}"></i><span>${esc(x.title)}</span><small class="${!x.done && x.day < tk ? "late" : ""}">${x.day < tk ? M.relDay(x.day, now) : x.time || ""}</small></div>`).join("") : '<div class="m-e">今天没有要做的事 🎉</div>';
  drawPomo();
}
function drawPomo() {
  const el = $("pomo");
  if (pomo && pomo.running) el.innerHTML = `<div class="m-pomo"><span class="pm-dot"></span>${pomo.phase === "focus" ? "专注中" : "休息中"}${pomo.task ? " · " + esc(pomo.task) : ""}<b class="mono">${M.pad(Math.floor(pomo.left / 60))}:${M.pad(pomo.left % 60)}</b></div>`;
  else el.innerHTML = "";
}
document.addEventListener("click", (e) => {
  const c = e.target.closest(".chk[data-k]");
  if (c) { const done = !c.classList.contains("on"); c.classList.toggle("on", done); window.cc.call("done", c.dataset.k, done); }
});
$("open").onclick = () => window.cc.call("open:main");
$("close").onclick = () => window.cc.call("mini:toggle");
window.cc.on("state", (s) => { S = s; render(); });
window.cc.on("pomo", (p) => { pomo = p; drawPomo(); });
setInterval(render, 30000);
(async () => { S = await window.cc.call("state"); pomo = await window.cc.call("pomo:state"); render(); })();
