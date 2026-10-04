// 全局快捷键弹出的小框：一句话记一件事
"use strict";
const M = window.CCModel, P = window.CCParse;
const q = document.getElementById("q"), prev = document.getElementById("prev"), msg = document.getElementById("msg");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function draw() {
  const t = q.value.trim();
  if (!t) { prev.innerHTML = '<span class="muted">写上日子、时间、@地点，会自动认出来</span>'; return; }
  const p = P.parse(t, new Date());
  prev.innerHTML = `<b>${esc(p.subject || "…")}</b>` + (p.date ? `<span>📅 ${esc(M.relDay(p.date, new Date()))}（${p.date.slice(5).replace("-", "/")}）</span>` : '<span class="muted">没定日子</span>') + (p.time ? `<span>🕒 ${p.time}</span>` : "") + (p.location ? `<span>📍 ${esc(p.location)}</span>` : "");
}
q.addEventListener("input", draw);
q.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") { window.cc.call("quick:hide"); return; }
  if (e.key !== "Enter" || e.isComposing) return;
  if (!q.value.trim()) return;
  try {
    const rec = await window.cc.call("quick:add", q.value);
    msg.className = "ok"; msg.textContent = "✓ 已记下：" + rec.subject;
    q.value = ""; draw();
    setTimeout(() => { msg.textContent = ""; window.cc.call("quick:hide"); }, 700);
  } catch (err) { msg.className = "bad"; msg.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); }
});
window.cc.on("quick-open", () => { msg.textContent = ""; q.focus(); q.select(); draw(); });
draw();
