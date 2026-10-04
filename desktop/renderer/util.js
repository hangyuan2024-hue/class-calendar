// 捞捞课程表 电脑版 · 界面通用小工具（弹窗、菜单、提示、图标、事项编辑框）
"use strict";
const M = window.CCModel, P = window.CCParse;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const tc = (type) => `var(--t-${M.TYPES.includes(type) ? type : "通知"})`;
const tagHtml = (type) => `<span class="tag" style="--c:${tc(type)}">${esc(type)}</span>`;

// 全局状态（主进程推过来的一份数据）
const App = {
  S: null, view: "today", views: {}, _items: null, _itemsOf: null,
  items() { if (this._itemsOf !== this.S) { this._items = M.allItems(this.S || {}); this._itemsOf = this.S; } return this._items; },
  find(key) { return this.items().find((x) => x.key === key); },
  className() { const c = (this.S.classes || []).find((x) => x.id === this.S.cid); return c ? c.name : ""; },
  isTeacher() { const c = (this.S.classes || []).find((x) => x.id === this.S.cid); return !!(c && c.is_teacher); },
  now: () => new Date(),
};

// 调用主进程；出错就弹红色提示
async function call(ch, ...args) {
  try { return await window.cc.call(ch, ...args); }
  catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { bad: true }); throw e; }
}

// ---------- 图标 ----------
const ICON = {
  today: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
  week: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3M9 9v12M15 9v12M3 15h18"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
  month: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v3M16 2.5v3"/><circle cx="8" cy="13.5" r=".6"/><circle cx="12" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/><circle cx="8" cy="17" r=".6"/><circle cx="12" cy="17" r=".6"/>',
  wall: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 3 14.5z"/><path d="M8 8.5h8M8 12h5"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5M12 2.5V5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  pin: '<path d="M9 4h6l-1 5 4 3v2H6v-2l4-3z"/><path d="M12 14v7"/>', send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="12" y="11" width="7" height="7" rx="1.5"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>', ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};
const icon = (n, cls) => `<svg class="${cls || "ico"}" viewBox="0 0 24 24">${ICON[n] || ""}</svg>`;

// ---------- 提示 ----------
function toast(msg, opt = {}) {
  const el = h(`<div class="toast${opt.bad ? " bad" : ""}"><span>${esc(msg)}</span>${opt.action ? `<button>${esc(opt.action.label)}</button>` : ""}</div>`);
  if (opt.action) el.querySelector("button").onclick = () => { el.remove(); opt.action.fn(); };
  $("#toasts").append(el);
  setTimeout(() => el.remove(), opt.ms || (opt.action ? 6000 : 2600));
}

// ---------- 弹窗 ----------
let overlayClose = null;
function openOverlay(node, onClose) {
  const ov = $("#overlay"); closeOverlay();
  ov.innerHTML = '<div class="scrim"></div>'; ov.append(node); ov.classList.add("show");
  ov.firstChild.onclick = () => closeOverlay();
  overlayClose = onClose || null;
}
function closeOverlay() { const ov = $("#overlay"); if (!ov.classList.contains("show")) return; ov.classList.remove("show"); ov.innerHTML = ""; const f = overlayClose; overlayClose = null; if (f) f(); }
const overlayOpen = () => $("#overlay").classList.contains("show");

// 确认框：返回 true/false
function confirmBox(title, text, okText = "确定", danger) {
  return new Promise((res) => {
    let done = false;
    const d = h(`<div class="dialog" role="dialog"><h3>${esc(title)}</h3><div class="dbody">${text ? `<div class="muted">${esc(text)}</div>` : ""}</div><div class="dfoot"><button class="btn" data-a="no">取消</button><button class="btn ${danger ? "danger" : "primary"}" data-a="ok">${esc(okText)}</button></div></div>`);
    d.onclick = (e) => { const a = e.target.closest("[data-a]"); if (!a) return; done = true; res(a.dataset.a === "ok"); closeOverlay(); };
    openOverlay(d, () => { if (!done) res(false); });
    d.querySelector('[data-a="ok"]').focus();
  });
}

// ---------- 右键菜单 ----------
function menu(x, y, items) {
  $$(".menu").forEach((m) => m.remove());
  const el = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (it === "-") { el.append(h("<hr>")); continue; }
    if (!it) continue;
    const b = h(`<button class="${it.danger ? "danger" : ""}">${it.icon ? icon(it.icon) : ""}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</button>`);
    b.onclick = () => { el.remove(); it.fn(); };
    el.append(b);
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  setTimeout(() => document.addEventListener("mousedown", function off(e) { if (!el.contains(e.target)) { el.remove(); document.removeEventListener("mousedown", off); } }), 0);
}

// ---------- 日期小工具 ----------
function greet(d) { const hh = d.getHours(); return hh < 5 ? "夜深了" : hh < 11 ? "早上好" : hh < 13 ? "中午好" : hh < 18 ? "下午好" : "晚上好"; }
const dateCN = (k) => { const d = M.fromKey(k); return `${d.getMonth() + 1}月${d.getDate()}日 周${M.WEEK[d.getDay()]}`; };
function whenText(x, now) {
  if (!x.day) return "没定日子";
  return M.relDay(x.day, now) + (x.time ? " " + x.time : "");
}
function overdue(x, now) {
  if (!x.day || x.done) return false;
  const n = M.dayDiff(x.day, now);
  if (n < 0) return true;
  if (n === 0 && x.time) return M.toMin(x.time) < now.getHours() * 60 + now.getMinutes();
  return false;
}
function untilText(min) { if (min < 60) return `${min} 分钟`; const hh = Math.floor(min / 60), mm = min % 60; return `${hh} 小时${mm ? " " + mm + " 分" : ""}`; }

// ---------- 完成 / 删除（带撤销） ----------
async function toggleDone(key, done) {
  await call("done", key, done);
  if (done) { const x = App.find(key); toast(`已完成：${x ? x.title : ""}`, { action: { label: "撤销", fn: () => call("done", key, false) } }); }
}
async function deleteMine(key) {
  const x = App.find(key); if (!x || !x.mine) return;
  const backup = (App.S.mine || []).find((r) => r.id === key);
  await call("mine:delete", key);
  toast(`已删除：${x.title}`, { action: { label: "撤销", fn: () => call("mine:upsert", backup) } });
}
async function hideItem(key, hidden) {
  await call("mark", key, { hidden });
  if (hidden) toast("已隐藏，在「事项 → 已隐藏」里能找回", { action: { label: "撤销", fn: () => call("mark", key, { hidden: false }) } });
}

// ---------- 新建 / 编辑我的事项 ----------
function editItem(x, preset) {
  const isNew = !x; preset = preset || {};
  const v = x ? { subject: x.title, day: x.day, time: x.time, location: x.location, note: x.note } : { subject: "", day: preset.day || "", time: preset.time || "", location: "", note: "" };
  const d = h(`<form class="dialog" role="dialog">
    <h3>${isNew ? "记一件事" : "编辑事项"}</h3>
    <div class="dbody">
      <label class="field">要做什么<input name="subject" maxlength="200" placeholder="比如：交实验报告　（可以直接写「明天下午3点交实验报告 @B302」）" value="${esc(v.subject)}" required></label>
      <div class="row"><label class="field" style="flex:1.3">日期<input name="day" type="date" value="${esc(v.day)}"></label><label class="field" style="flex:1">时间<input name="time" type="time" value="${esc(v.time)}"></label><label class="field" style="flex:1.4">地点<input name="location" maxlength="200" value="${esc(v.location)}" placeholder="可不填"></label></div>
      <label class="field">备注<textarea name="note" rows="3" maxlength="2000" placeholder="可不填">${esc(v.note)}</textarea></label>
    </div>
    <div class="dfoot">${isNew ? '<span class="muted grow" style="font-size:12px">Enter 保存 · Esc 取消</span>' : '<button type="button" class="btn danger" data-a="del">' + icon("trash") + '删除</button><span class="grow"></span>'}<button type="button" class="btn" data-a="cancel">取消</button><button class="btn primary">保存</button></div>
  </form>`);
  const f = d.elements;
  // 新建时：标题里写了日期时间，就自动填到下面
  if (isNew) f.subject.addEventListener("input", () => {
    const p = P.parse(f.subject.value, App.now());
    f.subject.dataset.parsed = JSON.stringify(p);
    if (p.date && !f.day.dataset.touched) f.day.value = p.date;
    if (p.time && !f.time.dataset.touched) f.time.value = p.time;
    if (p.location && !f.location.dataset.touched) f.location.value = p.location;
  });
  for (const n of ["day", "time", "location"]) f[n].addEventListener("input", () => (f[n].dataset.touched = 1));
  d.onsubmit = async (e) => {
    e.preventDefault();
    let subject = f.subject.value.trim();
    if (isNew && f.subject.dataset.parsed) { const p = JSON.parse(f.subject.dataset.parsed); if (p.subject && (p.date || p.time || p.location)) subject = p.subject; }
    if (!subject) return f.subject.focus();
    const rec = { subject, event_time: f.day.value ? f.day.value + (f.time.value ? " " + f.time.value : "") : "", location: f.location.value.trim(), note: f.note.value.trim() };
    if (x) rec.id = x.key;
    await call("mine:upsert", rec);
    closeOverlay(); toast(isNew ? "已记下" : "已保存");
  };
  d.onclick = async (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "cancel") closeOverlay();
    if (a.dataset.a === "del") { closeOverlay(); deleteMine(x.key); }
  };
  openOverlay(d);
  f.subject.focus(); if (!isNew) f.subject.select();
}

// 菜单：一件事能做的操作
function itemMenu(e, x) {
  e.preventDefault();
  menu(e.clientX, e.clientY, [
    { label: x.done ? "标记为没完成" : "标记完成", icon: "tasks", fn: () => toggleDone(x.key, !x.done) },
    x.mine ? { label: "编辑", icon: "edit", fn: () => editItem(x) } : null,
    { label: "在事项里查看", icon: "eye", fn: () => App.go("tasks", { key: x.key }) },
    { label: "专注做这件事", icon: "focus", fn: () => App.go("focus", { task: x.title }) },
    "-",
    x.mine ? { label: "删除", icon: "trash", danger: true, fn: () => deleteMine(x.key) } : { label: x.hidden ? "取消隐藏" : "隐藏这条", icon: "eye", fn: () => hideItem(x.key, !x.hidden) },
  ]);
}

// 简单的 Markdown：加粗、列表、代码、换行（AI 回复用）
function miniMd(s) {
  const lines = esc(s).split("\n"); let out = "", list = null;
  const inline = (t) => t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const ln of lines) {
    const m = /^\s*(?:[-*•]|(\d+)[.、)])\s+(.*)$/.exec(ln);
    if (m) { const tag = m[1] ? "ol" : "ul"; if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; } out += `<li>${inline(m[2])}</li>`; continue; }
    if (list) { out += `</${list}>`; list = null; }
    const hd = /^#{1,4}\s+(.*)$/.exec(ln);
    out += hd ? `<p><b>${inline(hd[1])}</b></p>` : ln.trim() ? `<p>${inline(ln)}</p>` : "";
  }
  if (list) out += `</${list}>`;
  return out;
}
