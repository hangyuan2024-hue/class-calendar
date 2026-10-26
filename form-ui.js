// 7.2 「记一件事」「发布班级事项」两个表单的样子（和小程序 1.18、安卓 App 一样的思路）：
//   记一件事：类型一排点选（普通 / 作业 / 会议 / 活动 / 通知），下面一句说清楚记到哪
//   发布班级事项：先选发什么（每种类型的提示不一样），写的时候下面实时显示「同学们看到的样子」
// 只改界面，保存还是 app.js 原来那一套（#fKind / #cType 这些输入框照旧在，只是藏起来）。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  if (!$("form") || !$("cform")) return;

  const css = `
  .fx-kinds{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}
  .fx-k{border:1px solid var(--line);background:var(--card);color:var(--sub);border-radius:999px;padding:5px 13px;font-size:13.5px;cursor:pointer;font-weight:600}
  .fx-k.on{background:var(--selected);border-color:var(--accent);color:var(--accent)}
  .fx-kh{font-size:12px;color:var(--sub);margin:0 0 10px}
  .cf-to{font-size:12.5px;color:var(--sub);margin:-4px 0 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .cf-to .sp{flex:1}
  .cf-types{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 12px}
  .cf-t{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:14px;padding:10px 4px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:13px;font-weight:600}
  .cf-t i{font-style:normal;font-size:20px;line-height:1}
  .cf-t.on{border-color:var(--cfc,var(--accent));background:color-mix(in srgb,var(--cfc,var(--accent)) 12%,var(--card));color:var(--cfc,var(--accent))}
  .cf-pvh{font-size:12.5px;color:var(--sub);margin:14px 0 6px;font-weight:600}
  .cf-pv{display:flex;gap:10px;border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--bg2)}
  .cf-pv .cf-bar{width:4px;border-radius:2px;background:var(--cfc,var(--accent));flex:none}
  .cf-pv .f1{flex:1;min-width:0}
  .cf-pv .tg{display:inline-block;font-size:11.5px;font-weight:700;color:var(--cfc,var(--accent));background:color-mix(in srgb,var(--cfc,var(--accent)) 14%,transparent);border-radius:6px;padding:1px 7px}
  .cf-pv .pop{font-size:11px;color:var(--red);margin-left:6px}
  .cf-pv .wh{float:right;font-size:12px;color:var(--sub)}
  .cf-pv .tt{font-weight:700;margin-top:6px;word-break:break-word}
  .cf-pv .ss{font-size:13px;color:var(--sub);margin-top:3px;white-space:pre-wrap;word-break:break-word}
  .cf-pv .ph{color:var(--muted-text)}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  // ---------- 记一件事：类型点选 ----------
  const KN = [["", "普通"], ["作业", "作业"], ["会议", "会议"], ["活动", "活动"], ["通知", "通知"]];
  const fk = $("fKind"), fkWrap = fk.closest("div");
  const kbox = document.createElement("div");
  kbox.innerHTML = `<div class="fx-kinds" role="radiogroup" aria-label="类型">${KN.map(([v, n]) => `<button type="button" class="fx-k" data-v="${v}" role="radio">${n}</button>`).join("")}</div><div class="fx-kh"></div>`;
  const titleRow = fk.closest(".row");
  titleRow.after(kbox);
  if (fkWrap) fkWrap.style.display = "none";
  const kindHint = () => {
    const v = fk.value;
    kbox.querySelectorAll(".fx-k").forEach((b) => { b.classList.toggle("on", b.dataset.v === v); b.setAttribute("aria-checked", b.dataset.v === v); });
    kbox.querySelector(".fx-kh").textContent = v === "作业" ? "会显示在作业页，只有你自己看得到" : v ? "记成「我的" + v + "」，只有你自己看得到" : "只有你自己看得到";
  };
  kbox.onclick = (e) => { const b = e.target.closest(".fx-k"); if (!b) return; fk.value = b.dataset.v; fk.dispatchEvent(new Event("change", { bubbles: true })); kindHint(); };
  fk.addEventListener("change", kindHint);

  // ---------- 发布班级事项 ----------
  const CT = [
    { n: "作业", ic: "📝", c: "var(--red)", ph: "科目，比如：高等数学", sph: "要做什么、交到哪，比如：第三章习题 1-15，交到学习通", when: "截止", lph: "可不填", pph: "比如：打印纸质版" },
    { n: "会议", ic: "👥", c: "var(--accent)", ph: "会议名称，比如：班委例会", sph: "议题、要谁参加", when: "开始", lph: "比如：A201", pph: "比如：笔记本、笔" },
    { n: "活动", ic: "🎉", c: "var(--green)", ph: "活动名称，比如：运动会报名", sph: "活动内容、怎么报名、注意事项", when: "开始", lph: "比如：东区操场", pph: "比如：学生证" },
    { n: "通知", ic: "📢", c: "var(--purple)", ph: "通知标题，比如：周五停课", sph: "通知的具体内容", when: "", lph: "可不填", pph: "可不填" },
  ];
  const ct = $("cType"), cform = $("cform");
  const typeWrap = ct.closest("div");
  if (typeWrap) typeWrap.style.display = "none";
  const to = document.createElement("div"); to.className = "cf-to";
  const tbox = document.createElement("div"); tbox.className = "cf-types";
  tbox.innerHTML = CT.map((t, i) => `<button type="button" class="cf-t" data-i="${i}" style="--cfc:${t.c}"><i>${t.ic}</i>${t.n}</button>`).join("");
  $("cformTitle").after(to, tbox);
  const pvh = document.createElement("div"); pvh.className = "cf-pvh"; pvh.textContent = "同学们看到的样子";
  const pv = document.createElement("div"); pv.className = "cf-pv";
  cform.querySelector(".btns").before(pvh, pv);
  const labText = (inp, t) => { const l = inp && inp.closest("label"); if (!l) return; const n = [...l.childNodes].find((x) => x.nodeType === 3); if (n) n.nodeValue = t + " "; };
  const md = (k) => { if (!k) return ""; const d = new Date(k + "T00:00:00"); return isNaN(d) ? k : d.getMonth() + 1 + "月" + d.getDate() + "日"; };
  function paintClass() {
    const i = Math.max(0, CT.findIndex((t) => t.n === ct.value)), t = CT[i];
    tbox.querySelectorAll(".cf-t").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
    $("cSubject").placeholder = t.ph; $("cSummary").placeholder = t.sph; $("cLoc").placeholder = t.lph; $("cPrep").placeholder = t.pph;
    labText($("cSubject"), t.n === "作业" ? "科目 / 标题" : "标题");
    labText($("cDate"), (t.when || "") + "日期"); labText($("cTime"), (t.when || "") + "时间（可不填）");
    labText($("cPrep"), t.n === "作业" ? "要交 / 要准备" : "要带 / 准备");
    let cls = ""; try { cls = (typeof currentClass !== "undefined" && currentClass && currentClass.name) || ""; } catch (e) {}
    const g = $("cGroup"), gName = g && !$("cGroupRow").classList.contains("hidden") && g.value ? g.options[g.selectedIndex].text.replace(/^👥\s*/, "") : "";
    const ai = !$("cId").value && typeof ingestAllowed === "function" && ingestAllowed();
    to.innerHTML = `<span>👥 ${esc(gName || (cls || "本班") + " · 全班同学都会看到")}</span><span class="sp"></span>${ai ? `<button type="button" class="small" data-ai>✨ 从群消息整理</button>` : ""}`;
    const day = $("cDate").value, tm = $("cTime").value, unsure = $("cConfirm").checked || !day;
    const sub = $("cSubject").value.trim(), sum = $("cSummary").value.trim(), loc = $("cLoc").value.trim(), prep = $("cPrep").value.trim();
    pv.style.setProperty("--cfc", t.c); tbox.style.setProperty("--cfc", t.c);
    pv.innerHTML = `<div class="cf-bar"></div><div class="f1">
      <span class="tg">${t.n}</span>${$("cPopup").checked ? `<span class="pop">📣 弹窗提醒</span>` : ""}<span class="wh">${day ? (t.when ? t.when + " " : "") + md(day) + (tm ? " " + tm : "") : "时间待定"}</span>
      <div class="tt">${unsure ? "⚠ " : ""}${sub ? esc(sub) : `<span class="ph">${esc(t.ph)}</span>`}</div>
      ${sum ? `<div class="ss">${esc(sum)}</div>` : ""}${loc || prep ? `<div class="ss">${loc ? "📍 " + esc(loc) : ""}${loc && prep ? "　" : ""}${prep ? "🎒 " + esc(prep) : ""}</div>` : ""}
      ${unsure ? `<div class="ss" style="color:var(--red)">⚠ 信息不完整，建议去群里核实${!day ? "（没填日期会自动标上）" : ""}</div>` : ""}</div>`;
  }
  tbox.onclick = (e) => { const b = e.target.closest(".cf-t"); if (!b) return; ct.value = CT[+b.dataset.i].n; ct.dispatchEvent(new Event("change", { bubbles: true })); paintClass(); $("cSubject").focus(); };
  to.onclick = (e) => { if (e.target.closest("[data-ai]") && typeof openIngest === "function") { $("cmodal").classList.remove("open"); openIngest(false); } };
  cform.addEventListener("input", paintClass); cform.addEventListener("change", paintClass);

  // 打开表单时跟着刷新
  const wrap = (name, after) => { const f = window[name]; if (typeof f !== "function") return; window[name] = function () { const r = f.apply(this, arguments); try { after(); } catch (e) { console.error(e); } setTimeout(after, 0); return r; }; };
  wrap("openForm", kindHint);
  wrap("openClassForm", paintClass);
  kindHint(); paintClass();
})();
